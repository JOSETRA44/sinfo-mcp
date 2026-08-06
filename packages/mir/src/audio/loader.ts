import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { getInstrument } from '@sinfo/core';
import { ApplicationError } from '@sinfo/engine';
import type {
  LoadPerformanceOptions,
  PerformanceCapability,
  PerformanceLoader,
} from '@sinfo/engine';
import { type Performance, clipDuration, clipLevel, gridFromTempo } from '@sinfo/perform';
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
export class AudioFileLoader implements PerformanceLoader {
  readonly capabilities: readonly PerformanceCapability[] = ['audio'];

  accepts(path: string): boolean {
    return AUDIO_EXTENSIONS.has(extname(path).toLowerCase());
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

    // El instrumento declarado acota la busqueda al registro que de verdad
    // puede sonar. Es la restriccion musical que un detector generico no
    // tiene, y elimina de raiz los errores de octava fuera de rango.
    const range = rangeFor(options.instrumentId);
    const points = detectPitch(clip, range);
    const notes = segmentNotes(points);

    const seconds = clipDuration(clip);
    return {
      tracks: [
        {
          id: 'audio',
          name,
          ...(options.instrumentId === undefined ? {} : { instrumentId: options.instrumentId }),
          notes,
        },
      ],
      // Sin tempo declarado no se inventa una rejilla aqui: mas abajo el
      // ensamblador avisa de que ha supuesto una, y ese aviso es informacion
      // que el agente necesita ver.
      ...(options.bpm === undefined ? {} : { grid: gridFromTempo(options.bpm, seconds) }),
      source: { kind: 'audio', name, model: 'yin' },
    };
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
