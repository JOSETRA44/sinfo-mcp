import {
  getInstrument,
  KeySignature,
  listInstruments,
  Score,
  Tempo,
  TimeSignature,
  type Movement,
  type Score as ScoreType,
} from '@sinfo/core';
import { fail } from '../errors.js';

/**
 * Operaciones de estructura: crear la obra, sus movimientos y sus partes.
 *
 * Son funciones puras sobre la partitura, sin saber nada de sesiones ni de
 * MCP. Eso las hace comprobables sin levantar un servidor y reutilizables
 * desde cualquier otra entrada (una CLI, un test, un lote).
 */

export interface CreateScoreInput {
  readonly title: string;
  readonly composer?: string | undefined;
  readonly timeSignature?: string | undefined;
  readonly tempo?: number | undefined;
  readonly key?: string | undefined;
  /** Partes iniciales, como ids del catalogo de instrumentos. */
  readonly instruments?: readonly string[] | undefined;
}

export function createScore(id: string, input: CreateScoreInput): ScoreType {
  const score = new Score(id, {
    title: input.title,
    ...(input.composer !== undefined ? { composer: input.composer } : {}),
  });

  applyInitialTimeline(score.first, input);

  for (const instrumentId of input.instruments ?? []) {
    addPart(score.first, { instrumentId });
  }

  return score;
}

function applyInitialTimeline(movement: Movement, input: CreateScoreInput): void {
  const { timeline } = movement;
  const start = timeline.timeSignatureChanges[0]!.at;

  if (input.timeSignature !== undefined) {
    timeline.setTimeSignature(start, TimeSignature.parse(input.timeSignature));
  }
  if (input.tempo !== undefined) {
    timeline.setTempo(start, Tempo.of(input.tempo));
  }
  if (input.key !== undefined) {
    timeline.setKey(start, KeySignature.parse(input.key));
  }
}

export interface AddPartInput {
  readonly instrumentId: string;
  /** Si falta, se deriva del instrumento evitando colisiones. */
  readonly partId?: string | undefined;
  readonly name?: string | undefined;
}

export interface AddPartResult {
  readonly partId: string;
  readonly name: string;
  readonly instrument: string;
  readonly range: string;
  readonly clef: string;
  readonly transposing: boolean;
}

export function addPart(movement: Movement, input: AddPartInput): AddPartResult {
  const instrument = getInstrument(input.instrumentId);
  if (!instrument) {
    fail('INVALID_REQUEST', `Instrumento desconocido: "${input.instrumentId}"`, {
      instrumentId: input.instrumentId,
      available: listInstruments().map((candidate) => candidate.id),
    });
  }

  const partId = input.partId ?? uniquePartId(movement, instrument.id);
  const part = movement.addPart(partId, instrument, input.name);

  return {
    partId: part.id,
    name: part.name,
    instrument: instrument.id,
    range: `${instrument.range.lowest.name}-${instrument.range.highest.name}`,
    clef: instrument.clef,
    transposing: instrument.transposition.chromatic !== 0,
  };
}

/**
 * Deriva un id libre a partir del instrumento: `violin`, `violin2`, `violin3`.
 *
 * Sin esto, anadir dos violines obligaria al agente a inventar ids y a
 * acordarse de cuales ya uso, que es justo el tipo de contabilidad que un
 * modelo hace mal.
 */
function uniquePartId(movement: Movement, base: string): string {
  if (!movement.hasPart(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base}${suffix}`;
    if (!movement.hasPart(candidate)) return candidate;
  }
  return fail('INVALID_REQUEST', `Demasiadas partes de "${base}"`, { base });
}

export interface AddMovementInput {
  readonly title: string;
  readonly movementId?: string | undefined;
  readonly marking?: string | undefined;
  readonly timeSignature?: string | undefined;
  readonly tempo?: number | undefined;
  readonly key?: string | undefined;
  /** Copia las partes del movimiento anterior; lo normal en una sinfonia. */
  readonly inheritParts?: boolean | undefined;
}

export interface AddMovementResult {
  readonly movementId: string;
  readonly title: string;
  readonly parts: readonly string[];
}

export function addMovement(score: ScoreType, input: AddMovementInput): AddMovementResult {
  const previous = score.movements.at(-1);
  const movementId = input.movementId ?? `m${score.movementCount + 1}`;
  const movement = score.addMovement(movementId, input.title);

  if (input.marking !== undefined) movement.marking = input.marking;
  applyInitialTimeline(movement, input);

  // Por defecto se heredan las partes: una sinfonia mantiene la misma
  // plantilla en los cuatro movimientos, y volver a declararla cada vez es
  // trabajo repetido que ademas se presta a que se descuadren los ids.
  if ((input.inheritParts ?? true) && previous) {
    for (const part of previous.parts) {
      movement.addPart(part.id, part.instrument, part.name);
    }
  }

  return { movementId: movement.id, title: movement.title, parts: [...movement.partIds] };
}

export function listAvailableInstruments(): readonly AddPartResult[] {
  return listInstruments().map((instrument) => ({
    partId: instrument.id,
    name: instrument.name,
    instrument: instrument.id,
    range: `${instrument.range.lowest.name}-${instrument.range.highest.name}`,
    clef: instrument.clef,
    transposing: instrument.transposition.chromatic !== 0,
  }));
}
