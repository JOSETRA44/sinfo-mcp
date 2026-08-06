import { basename, extname } from 'node:path';
import { ApplicationError } from '@sinfo/engine';
import type {
  LoadPerformanceOptions,
  PerformanceCapability,
  PerformanceLoader,
} from '@sinfo/engine';
import type { Performance } from '@sinfo/perform';
import { AudioFileLoader } from './audio/loader.js';
import { MidiFileLoader } from './loader.js';

/**
 * Despacha al cargador que sepa leer cada archivo.
 *
 * Es lo que hace que anadir una fuente nueva —el sidecar de audio, un lector
 * de MusicXML— no obligue a tocar ni el motor ni las herramientas: se suma un
 * cargador a la lista y sus capacidades aparecen solas.
 */
export class FileLoader implements PerformanceLoader {
  private readonly loaders: readonly PerformanceLoader[];

  constructor(loaders?: readonly PerformanceLoader[]) {
    this.loaders = loaders ?? [new MidiFileLoader(), new AudioFileLoader()];
  }

  get capabilities(): readonly PerformanceCapability[] {
    return [...new Set(this.loaders.flatMap((loader) => loader.capabilities))];
  }

  accepts(path: string): boolean {
    return this.loaders.some((loader) => loader.accepts(path));
  }

  async load(path: string, options: LoadPerformanceOptions = {}): Promise<Performance> {
    const loader = this.loaders.find((candidate) => candidate.accepts(path));
    if (loader === undefined) {
      throw new ApplicationError(
        'FORMAT_UNAVAILABLE',
        `No hay ningun lector para "${basename(path)}" (${extname(path) || 'sin extension'}). ` +
          'Se leen archivos MIDI (.mid, .midi) y audio WAV sin comprimir (.wav). Los formatos ' +
          'comprimidos hay que convertirlos antes.',
        { path, capabilities: this.capabilities },
      );
    }
    return loader.load(path, options);
  }
}
