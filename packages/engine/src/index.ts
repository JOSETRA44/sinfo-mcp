/**
 * @sinfo/engine — capa de aplicacion.
 *
 * Define los puertos de salida y orquesta los casos de uso. No conoce ninguna
 * libreria de formato ni el protocolo MCP: es el centro estable entre el
 * dominio y los adaptadores.
 *
 * Nota sobre los tipos `*Input`: sus propiedades opcionales se declaran como
 * `?: T | undefined`, mas laxo que el resto del proyecto. Es deliberado. Son
 * DTO que llegan de fuera ya validados, y en JSON "clave ausente" y "clave con
 * valor undefined" son la misma cosa; exigir la distincion obligaria a limpiar
 * el objeto en cada llamada sin ganar ninguna garantia real.
 */

export { ApplicationError, fail, type ApplicationErrorCode } from './errors.js';

export type {
  ArtifactSink,
  AudioRenderer,
  AudioRenderOptions,
  ExportFormat,
  MidiRenderer,
  MidiRenderOptions,
  RenderedArtifact,
  EnginePorts,
  LoadPerformanceOptions,
  PerformanceCapability,
  PerformanceLoader,
  SavedArtifact,
  ScoreRenderer,
  ScoreRenderOptions,
} from './ports.js';

export {
  InMemorySessionStore,
  recordAction,
  type InMemorySessionStoreOptions,
  type ScoreSession,
  type SessionStore,
} from './session/session-store.js';

export {
  addMovement,
  addPart,
  createScore,
  listAvailableInstruments,
  type AddMovementInput,
  type AddMovementResult,
  type AddPartInput,
  type AddPartResult,
  type CreateScoreInput,
} from './operations/structure.js';

export {
  clearPart,
  writePart,
  type ClearPartInput,
  type NotationMode,
  type WriteMode,
  type WritePartInput,
  type WritePartResult,
} from './operations/writing.js';

export {
  checkRanges,
  describeScore,
  describeTimeline,
  readPart,
  type DescribeScoreResult,
  type RangeIssue,
  type ReadPartInput,
  type ReadPartResult,
  type TimelineChange,
} from './operations/reading.js';

export { setTimeline, type SetTimelineInput, type SetTimelineResult } from './operations/timeline.js';

export {
  analyzeHarmony,
  checkVoiceLeadingIn,
  harmonyProgression,
  type AnalyzedChord,
  type AnalyzeHarmonyInput,
  type AnalyzeHarmonyResult,
  type CheckVoiceLeadingInput,
  type CheckVoiceLeadingResult,
  type HarmonyProgressionInput,
  type HarmonyProgressionResult,
  type RealizedChord,
} from './operations/harmony.js';

export {
  counterpointAdd,
  melodyGenerate,
  motifCreate,
  motifDevelop,
  motifWrite,
  type CounterpointInput,
  type CounterpointResultInfo,
  type MelodyGenerateInput,
  type MelodyGenerateResult,
  type MotifCreateInput,
  type MotifDevelopInput,
  type MotifInfo,
  type MotifStore,
  type MotifWriteInput,
  type Transformation,
  type TransformationOp,
} from './operations/generation.js';

export {
  addEnsemble,
  listEnsembles,
  listForms,
  listSections,
  planForm,
  type EnsembleAddInput,
  type EnsembleAddResult,
  type PlanFormInput,
  type PlanFormResult,
  type SectionListResult,
} from './operations/form.js';

export {
  orchestrate,
  type OrchestrateInput,
  type OrchestrateResult,
} from './operations/orchestrate.js';

export { exportScore, type ExportInput, type ExportResult } from './operations/exporting.js';

export { ScoreService, type ScoreServiceOptions } from './score-service.js';
