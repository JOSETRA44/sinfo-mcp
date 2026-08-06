/**
 * @sinfo/transcribe — la mitad simbolica.
 *
 * Convierte una interpretacion (`@sinfo/perform`) en notacion exacta. Sin
 * modelos, sin red, sin aleatoriedad: los mismos datos dan siempre el mismo
 * resultado y todo se puede probar con tests.
 *
 * Es aqui donde se gana o se pierde la partida. Que un modelo acierte las
 * notas no sirve de nada si luego se escriben como fusas ligadas a tresillos.
 */

export type { QuantizeOptions, QuantizeResult, QuantizedNote } from './quantize.js';
export { DEFAULT_SUBDIVISIONS, quantize } from './quantize.js';

export type { KeyEstimate, WeightedPitch } from './key-estimate.js';
export { estimateKey, pitchClassProfile } from './key-estimate.js';

export type { MelodicDirection } from './spell.js';
export { spellPitch, spellSequence, tonalCenter } from './spell.js';

export type { NoteGroup, SeparateOptions } from './voices.js';
export { separateVoices } from './voices.js';

export type { ToScoreOptions, ToScoreResult, TrackReport } from './to-score.js';
export { performanceToScore } from './to-score.js';
