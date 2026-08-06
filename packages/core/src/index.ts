/**
 * @sinfo/core — modelo de dominio musical.
 *
 * Cero dependencias de npm, por regla y comprobado en CI (ver
 * .dependency-cruiser.cjs). Todo lo que necesite una libreria externa vive
 * detras de una interfaz en @sinfo/theory o @sinfo/render.
 *
 * Reparto de mutabilidad:
 * - VALORES inmutables y congelados: Pitch, Interval, Duration, TimeSignature,
 *   Tempo, KeySignature, MusicalEvent.
 * - ENTIDADES mutables con metodos explicitos: Voice, Part, Movement, Score.
 *   Copiar una sinfonia entera en cada nota anadida seria cuadratico.
 */

export { DomainError, invalid, type DomainErrorCode } from './errors.js';

// -------------------------------------------------------------------- tiempo
export { Duration, sumDurations } from './time/duration.js';
export { TimeSignature } from './time/time-signature.js';
export { Tempo } from './time/tempo.js';

// -------------------------------------------------------------------- altura
export { Pitch, type Step } from './pitch/pitch.js';
export { Interval } from './pitch/interval.js';
export { KeySignature, type Mode } from './pitch/key-signature.js';

// -------------------------------------------------------------------- evento
export {
  chord,
  highestPitch,
  isChord,
  isNote,
  isRest,
  lowestPitch,
  note,
  rest,
  transposeEvent,
  withDuration,
  withOptions,
  type EventOptions,
  type MusicalEvent,
  type TiePosition,
} from './event/event.js';
export {
  DYNAMICS,
  dynamicLevel,
  isLouderThan,
  shiftDynamic,
  type Dynamic,
} from './event/dynamics.js';
export {
  ARTICULATION_EMPHASIS,
  ARTICULATION_LENGTH,
  articulationEmphasis,
  articulationLengthFactor,
  type Articulation,
} from './event/articulation.js';
export {
  calibratedCurve,
  clampVelocity,
  exponentialCurve,
  linearCurve,
  resolveVelocity,
  DEFAULT_DYNAMIC,
  MAX_VELOCITY,
  MIN_VELOCITY,
  type VelocityContext,
  type VelocityCurve,
} from './event/velocity.js';

// --------------------------------------------------------------- instrumento
export {
  classifyPitch,
  getInstrument,
  INSTRUMENTS,
  listInstruments,
  soundingPitch,
  writtenPitch,
  type Clef,
  type Instrument,
  type InstrumentFamily,
  type RangeVerdict,
} from './instrument/instrument.js';
export {
  ENSEMBLE_PRESETS,
  INSTRUMENT_SPECS,
  type EnsemblePreset,
  type InstrumentSpec,
} from './instrument/catalog.js';

// ----------------------------------------------------------------- notacion
export {
  parseVoice,
  serializeVoice,
  validateBarlines,
  type BarlineIssue,
  type ParsedVoice,
  type SerializeOptions,
} from './notation/sinfoscript.js';
export {
  analyzeDuration,
  formatDurationToken,
  isWritableDuration,
  splitIntoWritable,
  parseDurationToken,
  type DurationShape,
  type TupletShape,
} from './notation/duration-token.js';
export {
  parseGrid,
  parseGridStep,
  PERCUSSION_MAP,
  type GridLane,
  type GridOptions,
  type ParsedGrid,
} from './notation/grid.js';
export { stripComment, stripComments } from './notation/comments.js';

// ---------------------------------------------------------------- estructura
export { Timeline, type TimedValue } from './structure/timeline.js';
export { restsBetween } from './structure/rests.js';
export {
  splitIntoMeasures,
  type MeasureSlice,
  type NotatedEvent,
  type SplitOptions,
} from './structure/measures.js';
export { Voice, type PositionedEvent } from './structure/voice.js';
export { DEFAULT_VOICE_ID, Part } from './structure/part.js';
export { Movement } from './structure/movement.js';
export {
  distributeMeasures,
  FormPlan,
  FORM_TEMPLATES,
  type FormTemplate,
  type Section,
  type SectionInput,
  type SectionRole,
} from './structure/section.js';
export { Score, type ScoreMetadata, type ScoreSummary } from './structure/score.js';
