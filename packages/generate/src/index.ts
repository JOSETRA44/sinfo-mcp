/**
 * @sinfo/generate — generacion de material musical.
 *
 * Motivos y sus transformaciones, melodia sobre armonia y contrapunto. Toda
 * la aleatoriedad pasa por `Random`, que es determinista: la misma semilla da
 * exactamente la misma musica, en cualquier maquina. Sin eso, un agente no
 * puede iterar sobre lo que compuso.
 */

export { Random, randomSeed } from './random.js';
export { Motif } from './motif.js';

export {
  DEFAULT_CONSTRAINTS,
  scoreCandidates,
  avoidAugmentedIntervals,
  avoidRepetition,
  chordToneOnStrongBeat,
  closeOnStableTone,
  followContour,
  preferStepwise,
  resolveLeaps,
  withinRange,
  type MelodyConstraint,
  type MelodyContext,
  type ScoredCandidate,
} from './constraints.js';

export {
  generateMelody,
  totalDurationOf,
  type ContourShape,
  type MelodyDecision,
  type MelodyOptions,
  type MelodyResult,
} from './melody.js';

export {
  generateCounterpoint,
  type CounterpointOptions,
  type CounterpointResult,
  type Species,
} from './counterpoint.js';

export {
  assignRoles,
  checkBalance,
  distributeChord,
  fitToRange,
  materialFor,
  type AssignRolesOptions,
  type BalanceReport,
  type OrchestrationCandidate,
  type OrchestrationStyle,
  type RangeFit,
  type RoleAssignment,
  type TextureRole,
} from './orchestration.js';

export {
  getGroove,
  GROOVE_PRESETS,
  humanize,
  listGrooves,
  type GrooveProfile,
  type HumanizeOptions,
  type PerformedNote,
} from './groove.js';
