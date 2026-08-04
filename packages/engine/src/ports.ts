import type { Score } from '@sinfo/core';

/**
 * Puertos de salida.
 *
 * Los define la capa de aplicacion y los implementa @sinfo/render. La flecha
 * de dependencia va de render hacia engine, nunca al reves: el motor no sabe
 * que existe midi-file, ni verovio, ni ningun sintetizador. Cambiar de
 * libreria es cambiar un adaptador, no tocar la logica.
 */

export type ExportFormat =
  | 'midi'
  | 'musicxml'
  | 'abc'
  | 'lilypond'
  | 'wav'
  | 'mp3'
  | 'svg'
  | 'json';

export interface RenderedArtifact {
  readonly format: ExportFormat;
  /** Binario para midi/wav/mp3; texto codificado en UTF-8 para el resto. */
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly filename: string;
  /** Datos sueltos que el adaptador quiera reportar (duracion, compases...). */
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface MidiRenderOptions {
  /** Pulsos por negra. 480 cubre tresillos y quintillos de forma exacta. */
  readonly ppq?: number;
  /** Movimiento concreto; por defecto, todos concatenados. */
  readonly movementId?: string;
}

/** Convierte una partitura en un archivo MIDI estandar. */
export interface MidiRenderer {
  render(score: Score, options?: MidiRenderOptions): RenderedArtifact;
}

export interface ScoreRenderOptions {
  readonly movementId?: string;
  readonly format?: 'svg' | 'musicxml' | 'lilypond' | 'abc';
}

/** Convierte una partitura en notacion legible o grabada. */
export interface ScoreRenderer {
  render(score: Score, options?: ScoreRenderOptions): Promise<RenderedArtifact>;
}

export interface AudioRenderOptions {
  readonly movementId?: string;
  readonly format?: 'wav' | 'mp3';
  readonly sampleRate?: number;
  /** Ruta al SoundFont. Si falta, el adaptador usa el configurado por defecto. */
  readonly soundfontPath?: string;
}

/** Sintetiza la partitura a audio para que el agente pueda escucharla. */
export interface AudioRenderer {
  render(score: Score, options?: AudioRenderOptions): Promise<RenderedArtifact>;
}

/**
 * Conjunto de adaptadores que la aplicacion recibe inyectados.
 *
 * Todos opcionales salvo MIDI: el servidor debe poder arrancar aunque no haya
 * SoundFont instalado, ofreciendo lo que si puede hacer en vez de fallar
 * entero.
 */
export interface RenderPorts {
  readonly midi: MidiRenderer;
  readonly score?: ScoreRenderer;
  readonly audio?: AudioRenderer;
}
