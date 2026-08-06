/**
 * @sinfo/mir — adaptadores de ENTRADA.
 *
 * Hermano de `@sinfo/render`: uno saca artefactos de la partitura, este mete
 * material en ella. Ambos implementan puertos que declara `@sinfo/engine`, y
 * ninguno de los dos conoce al otro.
 *
 * Hoy solo lee MIDI, que es la fuente donde no hay nada que estimar. La
 * transcripcion de audio entra por aqui mismo mas adelante, produciendo el
 * mismo `Performance` — que es justamente el motivo de que exista esa costura.
 */

export type { ReadMidiOptions } from './midi/reader.js';
export { readMidi } from './midi/reader.js';

export { MidiFileLoader } from './loader.js';
export { FileLoader } from './file-loader.js';

export { AudioFileLoader } from './audio/loader.js';
export { decodeWav, WavDecodeError } from './audio/wav.js';
export type { PitchPoint, YinOptions } from './audio/yin.js';
export { detectPitch } from './audio/yin.js';
export type { SegmentOptions } from './audio/segment.js';
export { frequencyToMidi, segmentNotes } from './audio/segment.js';
