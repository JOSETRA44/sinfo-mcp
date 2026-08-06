import type { Movement, Score } from '@sinfo/core';
import { fail } from './errors.js';
import {
  addMovement,
  addPart,
  createScore,
  listAvailableInstruments,
  type AddMovementInput,
  type AddPartInput,
  type CreateScoreInput,
} from './operations/structure.js';
import { exportScore, type ExportInput } from './operations/exporting.js';
import {
  addEnsemble,
  listEnsembles,
  listForms,
  listSections,
  planForm,
  type EnsembleAddInput,
  type PlanFormInput,
} from './operations/form.js';
import { orchestrate, type OrchestrateInput } from './operations/orchestrate.js';
import { listGrooves } from '@sinfo/generate';
import {
  counterpointAdd,
  melodyGenerate,
  motifCreate,
  motifDevelop,
  motifWrite,
  type CounterpointInput,
  type MelodyGenerateInput,
  type MotifCreateInput,
  type MotifDevelopInput,
  type MotifWriteInput,
} from './operations/generation.js';
import {
  analyzeHarmony,
  checkVoiceLeadingIn,
  harmonyProgression,
  type AnalyzeHarmonyInput,
  type CheckVoiceLeadingInput,
  type HarmonyProgressionInput,
} from './operations/harmony.js';
import {
  checkRanges,
  describeScore,
  describeTimeline,
  readPart,
  type ReadPartInput,
} from './operations/reading.js';
import { setTimeline, type SetTimelineInput } from './operations/timeline.js';
import { clearPart, writePart, type ClearPartInput, type WritePartInput } from './operations/writing.js';
import type { RenderPorts } from './ports.js';
import { InMemorySessionStore, recordAction, type SessionStore } from './session/session-store.js';

export interface ScoreServiceOptions {
  readonly store?: SessionStore;
  /** Generador de ids. Inyectable para que los tests sean deterministas. */
  readonly generateId?: () => string;
}

/**
 * Fachada de la capa de aplicacion.
 *
 * Resuelve la sesion, delega en la operacion correspondiente y anota lo hecho.
 * Deliberadamente delgada: la logica vive en `operations/`, que son funciones
 * puras sobre la partitura. Anadir una capacidad es escribir una funcion en el
 * modulo que le toca y un metodo de tres lineas aqui, no engordar una clase
 * que lo sabe todo.
 */
export class ScoreService {
  private readonly store: SessionStore;
  private readonly ports: RenderPorts;
  private readonly generateId: () => string;

  constructor(ports: RenderPorts, options: ScoreServiceOptions = {}) {
    this.ports = ports;
    this.store = options.store ?? new InMemorySessionStore();
    this.generateId = options.generateId ?? defaultIdGenerator();
  }

  // ------------------------------------------------------------- estructura

  create(input: CreateScoreInput) {
    const score = createScore(this.generateId(), input);
    const session = this.store.create(score);
    recordAction(session, `creada "${input.title}"`);

    return { scoreId: score.id, ...describeScore(score, session.history) };
  }

  addPart(scoreId: string, movementId: string | undefined, input: AddPartInput) {
    const { session, movement } = this.resolve(scoreId, movementId);
    const result = addPart(movement, input);
    recordAction(session, `parte "${result.partId}" (${result.instrument})`);
    return result;
  }

  addMovement(scoreId: string, input: AddMovementInput) {
    const session = this.store.get(scoreId);
    const result = addMovement(session.score, input);
    recordAction(session, `movimiento "${result.movementId}": ${result.title}`);
    return result;
  }

  // -------------------------------------------------------------- escritura

  write(scoreId: string, movementId: string | undefined, input: WritePartInput) {
    const { session, movement } = this.resolve(scoreId, movementId);
    const result = writePart(movement, input);
    recordAction(
      session,
      `escritos ${result.eventsWritten} eventos en "${result.partId}" (compases ${result.startMeasure}-${result.endMeasure})`,
    );
    return result;
  }

  clear(scoreId: string, movementId: string | undefined, input: ClearPartInput) {
    const { session, movement } = this.resolve(scoreId, movementId);
    const result = clearPart(movement, input);
    recordAction(session, `vaciada la parte "${input.partId}"`);
    return result;
  }

  setTimeline(scoreId: string, movementId: string | undefined, input: SetTimelineInput) {
    const { session, movement } = this.resolve(scoreId, movementId);
    const result = setTimeline(movement, input);
    recordAction(session, `compas ${result.atMeasure}: ${result.applied.join(', ')}`);
    return result;
  }

  // ------------------------------------------------------- forma y conjunto

  planForm(scoreId: string, movementId: string | undefined, input: PlanFormInput) {
    const { session, movement } = this.resolve(scoreId, movementId);
    const result = planForm(movement, input);
    recordAction(
      session,
      `forma ${result.form}: ${result.sections.length} secciones, ${result.totalMeasures} compases`,
    );
    return result;
  }

  sections(scoreId: string, movementId?: string) {
    const { movement } = this.resolve(scoreId, movementId);
    return listSections(movement);
  }

  addEnsemble(scoreId: string, movementId: string | undefined, input: EnsembleAddInput) {
    const { session, movement } = this.resolve(scoreId, movementId);
    const result = addEnsemble(movement, input);
    recordAction(session, `conjunto ${result.ensemble}: ${result.parts.length} partes`);
    return result;
  }

  ensembles() {
    return { ensembles: listEnsembles() };
  }

  forms() {
    return { forms: listForms() };
  }

  grooves() {
    return { grooves: listGrooves() };
  }

  orchestrate(scoreId: string, movementId: string | undefined, input: OrchestrateInput) {
    const { session, movement } = this.resolve(scoreId, movementId);
    const result = orchestrate(movement, input);
    recordAction(
      session,
      `orquestado "${input.sourcePartId}" en ${result.assignments.length} partes (${result.style})`,
    );
    return result;
  }

  // ------------------------------------------------------------- generacion

  motifCreate(scoreId: string, input: MotifCreateInput) {
    const { session } = this.resolve(scoreId, undefined);
    const result = motifCreate(session.motifs, input);
    recordAction(session, `motivo "${result.motifId}": ${result.notation}`);
    return result;
  }

  motifDevelop(scoreId: string, movementId: string | undefined, input: MotifDevelopInput) {
    const { session, movement } = this.resolve(scoreId, movementId);
    const result = motifDevelop(session.motifs, movement, input);
    recordAction(
      session,
      `motivo "${result.motifId}" desde "${input.motifId}": ` +
        input.transformations.map((transformation) => transformation.op).join(', '),
    );
    return result;
  }

  motifWrite(scoreId: string, movementId: string | undefined, input: MotifWriteInput) {
    const { session, movement } = this.resolve(scoreId, movementId);
    const result = motifWrite(session.motifs, movement, input);
    recordAction(session, `motivo "${input.motifId}" escrito en "${result.partId}"`);
    return result;
  }

  motifList(scoreId: string) {
    const { session } = this.resolve(scoreId, undefined);
    return {
      motifs: [...session.motifs.entries()].map(([motifId, motif]) => ({
        motifId,
        notation: motif.notation,
        notes: motif.length,
        duration: motif.duration.toString(),
        derivation: motif.derivation,
      })),
    };
  }

  melodyGenerate(scoreId: string, movementId: string | undefined, input: MelodyGenerateInput) {
    const { session, movement } = this.resolve(scoreId, movementId);
    const result = melodyGenerate(session.motifs, movement, input);
    recordAction(session, `melodia "${result.motifId}" (semilla ${result.seed})`);
    return result;
  }

  counterpoint(scoreId: string, movementId: string | undefined, input: CounterpointInput) {
    const { session, movement } = this.resolve(scoreId, movementId);
    const result = counterpointAdd(movement, input);
    recordAction(
      session,
      `contrapunto de "${input.sourcePartId}" en "${result.writtenTo}" (semilla ${result.seed})`,
    );
    return result;
  }

  // ---------------------------------------------------------------- armonia

  harmony(scoreId: string, movementId: string | undefined, input: HarmonyProgressionInput) {
    const { session, movement } = this.resolve(scoreId, movementId);
    const result = harmonyProgression(movement, input);
    recordAction(session, `progresion ${input.progression.join('-')} en ${result.key}`);
    return result;
  }

  analyzeHarmony(scoreId: string, movementId: string | undefined, input: AnalyzeHarmonyInput) {
    const { movement } = this.resolve(scoreId, movementId);
    return analyzeHarmony(movement, input);
  }

  checkVoiceLeading(scoreId: string, movementId: string | undefined, input: CheckVoiceLeadingInput) {
    const { movement } = this.resolve(scoreId, movementId);
    return checkVoiceLeadingIn(movement, input);
  }

  // ---------------------------------------------------------------- lectura

  describe(scoreId: string) {
    const session = this.store.get(scoreId);
    return { scoreId, ...describeScore(session.score, session.history) };
  }

  read(scoreId: string, movementId: string | undefined, input: ReadPartInput) {
    const { movement } = this.resolve(scoreId, movementId);
    return readPart(movement, input);
  }

  timeline(scoreId: string, movementId?: string) {
    const { movement } = this.resolve(scoreId, movementId);
    return describeTimeline(movement);
  }

  checkRanges(scoreId: string, movementId?: string, partId?: string) {
    const { movement } = this.resolve(scoreId, movementId);
    const issues = checkRanges(movement, partId);
    return {
      checked: partId ?? 'todas las partes',
      issueCount: issues.length,
      // Un movimiento entero fuera de rango generaria miles de avisos
      // identicos; con dos docenas el agente ya sabe que corregir.
      issues: issues.slice(0, 24),
      truncated: issues.length > 24,
    };
  }

  list() {
    return this.store.list().map((session) => ({
      scoreId: session.score.id,
      title: session.score.metadata.title,
      movements: session.score.movementCount,
      events: session.score.eventCount,
      lastAccessedAt: new Date(session.lastAccessedAt).toISOString(),
    }));
  }

  close(scoreId: string) {
    return { closed: this.store.delete(scoreId) };
  }

  // ------------------------------------------------------------ exportacion

  async export(scoreId: string, input: ExportInput) {
    const session = this.store.get(scoreId);
    const result = await exportScore(session.score, this.ports, input);
    recordAction(session, `exportado a ${result.format}: ${result.path}`);
    return result;
  }

  instruments() {
    return listAvailableInstruments();
  }

  // ----------------------------------------------------------------- comun

  /**
   * Localiza la sesion y el movimiento sobre el que se va a operar.
   *
   * Si no se dice cual, se usa el primero: la mayoria de las piezas tienen uno
   * solo y no tiene sentido exigir el dato en cada llamada.
   */
  private resolve(
    scoreId: string,
    movementId: string | undefined,
  ): { session: ReturnType<SessionStore['get']>; score: Score; movement: Movement } {
    const session = this.store.get(scoreId);
    const movement = movementId ? session.score.movement(movementId) : session.score.first;
    return { session, score: session.score, movement };
  }
}

/** Ids cortos y legibles: `score-1`, `score-2`. Suficiente para una sesion. */
function defaultIdGenerator(): () => string {
  let counter = 0;
  return () => {
    counter++;
    return `score-${counter}`;
  };
}

export { fail };
