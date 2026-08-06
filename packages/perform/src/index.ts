/**
 * @sinfo/perform — la interpretacion cruda.
 *
 * Este paquete no sabe nada de partituras y no debe aprenderlo. Solo define
 * la forma que tiene lo que sale de un transcriptor: notas con tiempos en
 * segundos y una rejilla de pulso.
 *
 * Mantenerlo asi de tonto es lo que hace sustituible la mitad estadistica.
 * Un modelo nuevo, otra herramienta, un archivo MIDI o alguien escribiendo
 * JSON a mano producen todos lo mismo, y el cuantizador no distingue.
 */

export type {
  Performance,
  PerformanceSource,
  PerformanceTrack,
  RawNote,
} from './performance.js';

export {
  allNotes,
  averageConfidence,
  centsOffset,
  nearestMidi,
  noteCount,
  noteDuration,
  performanceDuration,
  rawNote,
  sortPerformance,
} from './performance.js';

export type { AudioClip } from './audio.js';
export { audioClip, clipDuration, clipLevel } from './audio.js';

export type { BeatGrid } from './grid.js';

export {
  averageTempo,
  beatsPerBar,
  beatToSeconds,
  createGrid,
  gridFromTempo,
  secondsToBeat,
  tempoStability,
} from './grid.js';
