/**
 * @sinfo/theory — teoria musical.
 *
 * Escalas, acordes, armonia funcional y reglas de conduccion de voces,
 * construidos sobre los tipos de @sinfo/core y sin dependencias externas.
 *
 * El plan original preveia apoyarse en `tonal`. Se descarto al escribirlo:
 * `tonal` trabaja con cadenas de texto ("C#4", "Cmaj7") y nuestro dominio con
 * objetos que conservan la ortografia. Cada conversion de ida y vuelta es un
 * sitio donde Do sostenido puede volver convertido en Re bemol, que es
 * justamente el error que toda la arquitectura evita. Un acorde es una tonica
 * mas un patron de intervalos: sale mas corto construirlo que traducirlo.
 */

export {
  Chord,
  CHORD_QUALITIES,
  identifyChord,
  type ChordMatch,
  type ChordQuality,
} from './chord.js';

export { Scale, SCALE_TYPES, type ScaleType } from './scale.js';

export {
  analyzeChord,
  classifyCadence,
  RomanNumeral,
  type CadenceResult,
  type CadenceType,
  type HarmonicAnalysis,
  type HarmonicFunction,
} from './roman.js';

export {
  extractVerticalities,
  sonorityAt,
  type LabeledVoice,
  type Verticality,
} from './verticality.js';

export {
  analyzeVoiceLeading,
  checkVoiceLeading,
  summarizeIssues,
  type Severity,
  type VoiceLeadingIssue,
  type VoiceLeadingOptions,
  type VoiceLeadingRule,
  type VoiceLeadingSummary,
} from './voice-leading.js';
