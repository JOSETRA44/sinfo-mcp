import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { ApplicationError } from '@sinfo/engine';
import type {
  LoadPerformanceOptions,
  PerformanceCapability,
  PerformanceLoader,
} from '@sinfo/engine';
import type { Performance } from '@sinfo/perform';
import { readMidi } from './midi/reader.js';

/** Extensiones que este cargador reconoce. */
const MIDI_EXTENSIONS = new Set(['.mid', '.midi', '.smf']);

/**
 * Cargador de archivos MIDI.
 *
 * Declara `capabilities` por el mismo motivo que los adaptadores de salida
 * declaran `formats`: cuando manana haya un cargador de audio compartiendo
 * puerto, hace falta poder decir "eso no lo se leer" en vez de intentarlo y
 * devolver cualquier cosa.
 */
export class MidiFileLoader implements PerformanceLoader {
  readonly capabilities: readonly PerformanceCapability[] = ['midi'];

  accepts(path: string): boolean {
    return MIDI_EXTENSIONS.has(extname(path).toLowerCase());
  }

  async status(): Promise<Readonly<Record<string, unknown>>> {
    return {
      kind: 'midi',
      extensions: [...MIDI_EXTENSIONS],
      available: true,
      note: 'Siempre disponible: no depende de nada instalado aparte.',
    };
  }

  async load(path: string, options: LoadPerformanceOptions = {}): Promise<Performance> {
    const extension = extname(path).toLowerCase();
    if (!MIDI_EXTENSIONS.has(extension)) {
      throw new ApplicationError(
        'FORMAT_UNAVAILABLE',
        `Solo se leen archivos MIDI (${[...MIDI_EXTENSIONS].join(', ')}), y "${path}" no lo es. ` +
          'La transcripcion de audio todavia no esta montada.',
        { path, extension, capabilities: this.capabilities },
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

    try {
      return readMidi(data, { name: options.name ?? basename(path) });
    } catch (error) {
      // Un MIDI corrupto o de un formato exotico no debe salir como un fallo
      // interno sin contexto: el agente necesita saber que el problema esta en
      // el archivo, no en la herramienta.
      throw new ApplicationError(
        'NOTATION_ERROR',
        `"${basename(path)}" no se pudo interpretar como MIDI estandar: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        { path },
      );
    }
  }
}
