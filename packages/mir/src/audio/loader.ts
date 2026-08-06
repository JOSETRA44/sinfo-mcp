import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
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
  type RawNote,
  clipDuration,
  clipLevel,
  createGrid,
  gridFromTempo,
} from '@sinfo/perform';
import { StageCache } from '../sidecar/cache.js';
import { SidecarClient } from '../sidecar/client.js';
import { decodeWav } from './wav.js';
import { segmentNotes } from './segment.js';
import { detectPitch } from './yin.js';

/** Extensiones que este cargador reconoce. */
const AUDIO_EXTENSIONS = new Set(['.wav', '.wave']);

/** Por debajo de este nivel eficaz, el archivo esta practicamente mudo. */
const SILENT_THRESHOLD = 0.001;

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
    return AUDIO_EXTENSIONS.has(extname(path).toLowerCase());
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

  async load(path: string, options: LoadPerformanceOptions = {}): Promise<Performance> {
    const extension = extname(path).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(extension)) {
      throw new ApplicationError(
        'FORMAT_UNAVAILABLE',
        `Solo se lee audio WAV sin comprimir, y "${basename(path)}" no lo es. Los formatos ` +
          'comprimidos (MP3, OGG, FLAC) necesitan un decodificador nativo, que este proyecto ' +
          'evita a proposito. Conviertelo antes a WAV.',
        { path, extension },
      );
    }

    let data: Uint8Array;
    try {
      data = new Uint8Array(await readFile(path));
    } catch (error) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        `No se pudo leer "${path}": ${error instanceof Error ? error.message : String(error)}`,
        { path },
      );
    }

    const name = options.name ?? basename(path);
    const clip = decodeWav(data, name);

    if (clipLevel(clip) < SILENT_THRESHOLD) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        `"${name}" esta mudo o casi. Comprueba que el archivo tiene senal antes de transcribirlo.`,
        { path, level: clipLevel(clip) },
      );
    }

    // Que motor hay disponible se decide aqui y no en la configuracion: el
    // sidecar mejora el resultado cuando esta, y su ausencia no debe impedir
    // transcribir, solo acotar lo que se puede transcribir.
    const stages = await this.sidecar.availableStages();

    const polyphonic = stages.includes('notes');
    const notes = polyphonic
      ? await this.notesViaSidecar(path, options.instrumentId)
      : segmentNotes(detectPitch(clip, rangeFor(options.instrumentId)));

    const seconds = clipDuration(clip);
    const grid = await this.buildGrid(path, options.bpm, seconds, stages.includes('beats'));

    return {
      tracks: [
        {
          id: 'audio',
          name,
          ...(options.instrumentId === undefined ? {} : { instrumentId: options.instrumentId }),
          notes,
        },
      ],
      ...(grid === undefined ? {} : { grid }),
      source: { kind: 'audio', name, model: polyphonic ? 'basic_pitch' : 'yin' },
    };
  }

  /** Transcripcion polifonica delegada, cacheada por contenido del archivo. */
  private async notesViaSidecar(path: string, instrumentId: string | undefined): Promise<RawNote[]> {
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
