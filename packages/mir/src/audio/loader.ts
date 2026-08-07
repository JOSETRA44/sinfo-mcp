import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { getInstrument } from '@sinfo/core';
import { ApplicationError } from '@sinfo/engine';
import type {
  LoadPerformanceOptions,
  PerformanceCapability,
  PerformanceLoader,
} from '@sinfo/engine';
import {
  type BeatGrid,
  type Performance,
  type PerformanceTrack,
  type RawNote,
  clipDuration,
  clipLevel,
  createGrid,
  gridFromTempo,
} from '@sinfo/perform';
import { StageCache } from '../sidecar/cache.js';
import { SidecarClient } from '../sidecar/client.js';
import { fetchAudio, looksLikeUrl, urlIngestEnabled } from './url.js';
import { decodeWav } from './wav.js';
import { segmentNotes } from './segment.js';
import { detectPitch } from './yin.js';

/** Formatos que se leen siempre, sin depender de nada instalado aparte. */
const NATIVE_EXTENSIONS = new Set(['.wav', '.wave']);

/**
 * Formatos comprimidos: necesitan que el sidecar los decodifique.
 *
 * Se aceptan en `accepts` aunque el sidecar pueda no estar, para poder dar un
 * error que explique QUE falta. Rechazarlos de plano produciria un "no
 * reconozco esta extension" que no ayuda a nadie a arreglarlo.
 */
const DECODABLE_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.ogg',
  '.oga',
  '.opus',
  '.m4a',
  '.aiff',
  '.aif',
  // Contenedores de las plataformas: YouTube entrega opus en webm o AAC en
  // m4a segun lo que haya. Los cubre PyAV en el sidecar.
  '.webm',
  '.mp4',
  '.mkv',
  '.aac',
  '.wma',
]);

const AUDIO_EXTENSIONS = new Set([...NATIVE_EXTENSIONS, ...DECODABLE_EXTENSIONS]);

/** Por debajo de este nivel eficaz, el archivo esta practicamente mudo. */
const SILENT_THRESHOLD = 0.001;

/**
 * Que instrumento representa cada pista separada.
 *
 * Demucs devuelve cuatro pistas y ninguna es un instrumento concreto: "other"
 * es todo lo que no es voz, bajo ni bateria, junto. Se le asigna piano no
 * porque suene un piano, sino porque es el instrumento de registro mas ancho
 * del catalogo y por tanto el que menos notas descarta por rango.
 */
const STEM_INSTRUMENTS: Readonly<Record<string, string>> = {
  vocals: 'tenor_voice',
  bass: 'bass_guitar',
  other: 'piano',
  guitar: 'guitar',
  piano: 'piano',
  drums: 'drums',
};

/** Tipos de voz por registro, de grave a aguda, para afinar la pista vocal. */
const VOICE_TYPES: readonly { id: string; median: number }[] = [
  { id: 'bass_voice', median: 45 },
  { id: 'tenor_voice', median: 52 },
  { id: 'alto_voice', median: 58 },
  { id: 'soprano', median: 65 },
];

/**
 * Transcripcion de audio MONOFONICO, sin modelos ni dependencias nativas.
 *
 * Lo que hace y lo que no conviene tenerlo claro. Con una linea sola —una voz,
 * un saxo, una flauta, un bajo— da un resultado utilizable. Con un acorde de
 * piano o una mezcla completa devuelve una sola nota por instante, y no por un
 * fallo: la deteccion polifonica es otro problema y necesita un modelo
 * entrenado, que es lo que aportara el sidecar.
 *
 * Decirlo en el mensaje de error importa mas que soportarlo a medias: una
 * transcripcion silenciosamente incompleta es peor que una negativa clara.
 */
export interface AudioLoaderOptions {
  /** Sidecar de Python. Si no esta, se usa el detector propio. */
  readonly sidecar?: SidecarClient | undefined;
  readonly cache?: StageCache | undefined;
}

export class AudioFileLoader implements PerformanceLoader {
  readonly capabilities: readonly PerformanceCapability[] = ['audio'];

  private readonly sidecar: SidecarClient;
  private readonly cache: StageCache;

  constructor(options: AudioLoaderOptions = {}) {
    this.sidecar = options.sidecar ?? new SidecarClient();
    this.cache = options.cache ?? new StageCache();
  }

  accepts(path: string): boolean {
    // Las URL se aceptan siempre para poder explicar que hay que activarlas.
    // Rechazarlas de plano daria un "extension desconocida" desconcertante.
    return looksLikeUrl(path) || AUDIO_EXTENSIONS.has(extname(path).toLowerCase());
  }

  async status(): Promise<Readonly<Record<string, unknown>>> {
    const info = await this.sidecar.describe();
    const stages = (info?.capabilities ?? []).filter((entry) => entry.available).map((e) => e.name);

    return {
      kind: 'audio',
      extensions: [...AUDIO_EXTENSIONS],
      available: true,
      engine: stages.includes('notes') ? 'basic_pitch' : 'yin',
      polyphonic: stages.includes('notes'),
      beatTracking: stages.includes('beats'),
      limitation: stages.includes('notes')
        ? undefined
        : 'Sin sidecar el detector es monofonico: una linea sola si, acordes y mezclas no.',
      urlIngest: {
        enabled: urlIngestEnabled(),
        available: stages.includes('fetch'),
        ...(urlIngestEnabled()
          ? {}
          : { enableWith: 'SINFO_ALLOW_URL=1', note: 'Apagada por defecto a proposito.' }),
      },
      sidecar:
        info === null
          ? {
              installed: false,
              install: "uv tool install 'sinfo-mir[all]'",
              note: 'Aporta transcripcion polifonica, seguimiento de pulso y separacion de pistas.',
            }
          : {
              installed: true,
              version: info.version,
              python: info.python,
              capabilities: info.capabilities,
            },
      cache: await this.cache.stats(),
    };
  }

  async load(source: string, options: LoadPerformanceOptions = {}): Promise<Performance> {
    // Una URL se convierte en un archivo local y a partir de ahi el resto de
    // la cadena no distingue de donde vino.
    let path = source;
    let downloadedTitle: string | undefined;
    if (looksLikeUrl(source)) {
      const fetched = await fetchAudio(source, this.sidecar, this.cache);
      path = fetched.path;
      downloadedTitle = fetched.title;
    }

    const extension = extname(path).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(extension)) {
      throw new ApplicationError(
        'FORMAT_UNAVAILABLE',
        `No se reconoce el formato de "${basename(path)}" (${extension || 'sin extension'}). ` +
          `Se leen ${[...AUDIO_EXTENSIONS].join(', ')}.`,
        { path, extension },
      );
    }

    const stages = await this.sidecar.availableStages();
    const name = options.name ?? downloadedTitle ?? basename(path);

    // Los comprimidos pasan antes por el sidecar. El WAV resultante se cachea,
    // asi que decodificar una cancion larga se paga una sola vez.
    const wavPath =
      NATIVE_EXTENSIONS.has(extension) || !stages.includes('decode')
        ? path
        : await this.decodeViaSidecar(path);

    if (!NATIVE_EXTENSIONS.has(extension) && wavPath === path) {
      throw new ApplicationError(
        'FORMAT_UNAVAILABLE',
        `"${basename(path)}" esta comprimido y hace falta el sidecar para decodificarlo. ` +
          "Instalalo con `uv tool install 'sinfo-mir[all]'`, o convierte el archivo a WAV.",
        { path, extension },
      );
    }

    let data: Uint8Array;
    try {
      data = new Uint8Array(await readFile(wavPath));
    } catch (error) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        `No se pudo leer "${wavPath}": ${error instanceof Error ? error.message : String(error)}`,
        { path },
      );
    }

    const clip = decodeWav(data, name);

    if (clipLevel(clip) < SILENT_THRESHOLD) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        `"${name}" esta mudo o casi. Comprueba que el archivo tiene senal antes de transcribirlo.`,
        { path, level: clipLevel(clip) },
      );
    }

    // Que motor se usa se decide aqui y no en la configuracion: el sidecar
    // mejora el resultado cuando esta, y su ausencia no debe impedir
    // transcribir, solo acotar lo que se puede transcribir.
    const polyphonic = stages.includes('notes');
    const seconds = clipDuration(clip);

    // Todas las etapas trabajan sobre el WAV ya decodificado, no sobre el
    // original. Los modelos leen con las mismas librerias que fallaban con los
    // contenedores de las plataformas, asi que darles el original volveria a
    // estrellarse justo despues de haber resuelto el problema.
    const grid = await this.buildGrid(wavPath, options.bpm, seconds, stages.includes('beats'));

    const separating =
      options.separateStems === true && polyphonic && stages.includes('separate');

    const tracks = separating
      ? await this.tracksFromStems(wavPath, options.instrumentId)
      : [
          {
            id: 'audio',
            name,
            ...(options.instrumentId === undefined ? {} : { instrumentId: options.instrumentId }),
            notes: polyphonic
              ? await this.notesViaSidecar(wavPath, options.instrumentId)
              : segmentNotes(detectPitch(clip, rangeFor(options.instrumentId))),
          },
        ];

    return {
      tracks,
      ...(grid === undefined ? {} : { grid }),
      source: {
        kind: 'audio',
        name,
        model: separating ? 'htdemucs+basic_pitch' : polyphonic ? 'basic_pitch' : 'yin',
      },
    };
  }

  /**
   * Separa la mezcla y transcribe cada pista por su cuenta.
   *
   * La bateria se salta a proposito. Un detector de alturas sobre percusion
   * devuelve alturas sin sentido —no las hay— y escribirlas produce una parte
   * que parece musica y no lo es. El ritmo de la bateria ya esta recogido en
   * la rejilla de pulso, que es donde tiene sentido.
   */
  private async tracksFromStems(
    path: string,
    override: string | undefined,
  ): Promise<PerformanceTrack[]> {
    const stems = await this.separateViaSidecar(path);
    const tracks: PerformanceTrack[] = [];

    for (const [stem, stemPath] of Object.entries(stems)) {
      if (stem === 'drums') continue;

      const declared = override ?? STEM_INSTRUMENTS[stem] ?? 'piano';
      const notes = await this.notesViaSidecar(stemPath, declared);
      if (notes.length === 0) continue;

      // La voz se afina despues de oirla: el catalogo tiene cuatro registros
      // vocales y elegir el que de verdad encaja hace que la correccion de
      // octavas trabaje con el rango correcto en vez de con uno supuesto.
      const instrumentId =
        override ?? (stem === 'vocals' ? pickVoiceType(notes) : (STEM_INSTRUMENTS[stem] ?? 'piano'));

      tracks.push({ id: stem, name: stem, instrumentId, notes });
    }

    return tracks;
  }

  /** Separacion en pistas, cacheada: es la etapa mas cara de toda la cadena. */
  private async separateViaSidecar(path: string): Promise<Record<string, string>> {
    const key = await this.cache.keyFor(path, 'separate', { model: 'htdemucs' });
    const directory = await this.cache.directoryFor(key);

    const result = await this.cache.through(key, async () => {
      return (await this.sidecar.invoke([
        'separate',
        '--input',
        path,
        '--out',
        directory,
      ])) as { stems?: Record<string, string> };
    });

    const stems = result.stems ?? {};
    // Si alguien vacio la carpeta de cache pero quedo el JSON, se recalcula.
    if (Object.values(stems).some((file) => !existsSync(file))) {
      const fresh = (await this.sidecar.invoke([
        'separate',
        '--input',
        path,
        '--out',
        directory,
      ])) as { stems?: Record<string, string> };
      await this.cache.write(key, fresh);
      return fresh.stems ?? {};
    }
    return stems;
  }

  /**
   * Decodifica un formato comprimido a WAV, cacheando el resultado.
   *
   * Se devuelve la ruta del original si el sidecar falla, para que quien
   * llama pueda distinguir "no se pudo" de "no hacia falta" y explicarlo.
   */
  private async decodeViaSidecar(path: string): Promise<string> {
    const key = await this.cache.keyFor(path, 'decode');
    const target = join(await this.cache.directoryFor(key), 'audio.wav');
    if (existsSync(target)) return target;

    try {
      await this.sidecar.invoke(['decode', '--input', path, '--out', target]);
      return target;
    } catch {
      return path;
    }
  }

  /** Transcripcion polifonica delegada, cacheada por contenido del archivo. */
  private async notesViaSidecar(path: string, instrumentId: string | undefined): Promise<RawNote[]> {
    // Se probó a acotar el rango de busqueda DENTRO del modelo, pasandole las
    // frecuencias del instrumento. Parecia obviamente mejor que filtrar
    // despues —una octava erronea que cae dentro del rango fisico ya no se
    // puede distinguir a posteriori— y el banco de pruebas dijo lo contrario:
    // con el piano, cuyo registro va de 13 Hz a 2 kHz, basic-pitch pasaba a
    // devolver CERO notas. El acotado se queda disponible en el sidecar
    // (--min-freq, --max-freq) pero no se usa por defecto hasta entender por
    // que rompe con registros anchos.
    const key = await this.cache.keyFor(path, 'notes', { instrument: instrumentId ?? null });
    const result = await this.cache.through(key, async () => {
      const args = ['notes', '--input', path];
      if (instrumentId !== undefined) args.push('--instrument', instrumentId);
      return (await this.sidecar.invoke(args)) as { notes?: RawNote[] };
    });
    return result.notes ?? [];
  }

  /**
   * Rejilla de pulso, por orden de fiabilidad.
   *
   * Lo que declara la persona manda sobre lo que detecta un modelo: si alguien
   * sabe que grabo a 96, ese dato es mejor que cualquier estimacion. Solo si
   * no lo dice se recurre al seguidor de pulso, y si tampoco lo hay se deja
   * sin rejilla para que el ensamblador avise de que va a suponer una.
   */
  private async buildGrid(
    path: string,
    bpm: number | undefined,
    seconds: number,
    canTrack: boolean,
  ): Promise<BeatGrid | undefined> {
    if (bpm !== undefined) return gridFromTempo(bpm, seconds);
    if (!canTrack) return undefined;

    const key = await this.cache.keyFor(path, 'beats');
    const result = await this.cache.through(key, async () => {
      return (await this.sidecar.invoke(['beats', '--input', path])) as {
        beats?: number[];
        downbeats?: number[];
      };
    });

    const beats = result.beats ?? [];
    if (beats.length < 2) return undefined;
    return createGrid(beats, result.downbeats ?? []);
  }
}

/**
 * Elige el registro vocal que mejor encaja con lo que se ha detectado.
 *
 * Se usa la MEDIANA y no la media: una nota suelta muy aguda —un grito, un
 * falsete de adorno, un armonico que se colo— desplazaria la media lo bastante
 * como para clasificar de soprano a un baritono.
 */
function pickVoiceType(notes: readonly RawNote[]): string {
  if (notes.length === 0) return 'tenor_voice';
  const sorted = notes.map((note) => note.midi).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 52;

  let best = VOICE_TYPES[0]?.id ?? 'tenor_voice';
  let closest = Number.POSITIVE_INFINITY;
  for (const type of VOICE_TYPES) {
    const distance = Math.abs(type.median - median);
    if (distance < closest) {
      closest = distance;
      best = type.id;
    }
  }
  return best;
}

/** Margen de busqueda a partir del rango sonante del instrumento declarado. */
function rangeFor(instrumentId: string | undefined): { minFrequency?: number; maxFrequency?: number } {
  if (instrumentId === undefined) return {};
  const instrument = getInstrument(instrumentId);
  if (!instrument) return {};

  // Un tono de margen por cada lado: el rango del catalogo es el comodo, y un
  // interprete lo pasa de vez en cuando sin que eso sea un error.
  return {
    minFrequency: instrument.range.lowest.frequency() / 1.13,
    maxFrequency: instrument.range.highest.frequency() * 1.13,
  };
}
