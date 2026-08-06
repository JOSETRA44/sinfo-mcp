import { Duration, type Movement, type MusicalEvent, type Pitch } from '@sinfo/core';
import {
  assignRoles,
  checkBalance,
  fitToRange,
  materialFor,
  randomSeed,
  type OrchestrationCandidate,
  type OrchestrationStyle,
} from '@sinfo/generate';
import { KeySignature } from '@sinfo/core';
import { RomanNumeral, type Chord } from '@sinfo/theory';
import { fail } from '../errors.js';

/**
 * Orquestacion de un pasaje.
 *
 * Toma una linea melodica ya escrita, opcionalmente una progresion armonica, y
 * lo reparte entre las partes del conjunto: quien lleva la melodia, quien la
 * armonia y quien el bajo, cada uno en el registro que le queda comodo y con
 * la transposicion de su instrumento ya aplicada.
 */

export interface OrchestrateInput {
  /** Parte de la que sale el material melodico. */
  readonly sourcePartId: string;
  readonly sourceVoiceId?: string | undefined;
  /** Partes destino. Si se omite, todas menos la de origen y la percusion. */
  readonly targetPartIds?: readonly string[] | undefined;
  readonly progression?: readonly string[] | undefined;
  readonly key?: string | undefined;
  readonly style?: string | undefined;
  readonly fromMeasure?: number | undefined;
  readonly toMeasure?: number | undefined;
  readonly maxMelodyDoublings?: number | undefined;
  readonly seed?: string | undefined;
  /** Vacia las partes destino antes de escribir. */
  readonly replace?: boolean | undefined;
}

export interface OrchestrateResult {
  readonly seed: string;
  readonly style: string;
  readonly assignments: readonly {
    partId: string;
    instrument: string;
    role: string;
    octaveShift: number;
    events: number;
    outOfRange: number;
  }[];
  readonly balance: {
    weights: Readonly<Record<string, number>>;
    issues: readonly string[];
  };
  readonly sourceMeasures: number;
}

const STYLES = new Set<OrchestrationStyle>([
  'tutti',
  'melodia-acompanamiento',
  'coral',
  'camara',
]);

export function orchestrate(movement: Movement, input: OrchestrateInput): OrchestrateResult {
  const source = movement.part(input.sourcePartId);
  const sourceVoice = input.sourceVoiceId
    ? source.voice(input.sourceVoiceId)
    : source.mainVoice;

  if (sourceVoice.isEmpty) {
    fail('INVALID_REQUEST', `La parte "${input.sourcePartId}" no tiene musica que orquestar`, {
      sourcePartId: input.sourcePartId,
    });
  }

  const style = parseStyle(input.style);
  const seed = input.seed ?? randomSeed();

  const from = movement.timeline.measureStart(input.fromMeasure ?? 1);
  const to = movement.timeline.measureStart((input.toMeasure ?? movement.measureCount) + 1);
  const melody = sourceVoice.between(from, to).map((entry) => entry.event);

  if (melody.length === 0) {
    fail('INVALID_REQUEST', 'El rango de compases pedido no contiene musica', {
      fromMeasure: input.fromMeasure ?? 1,
      toMeasure: input.toMeasure ?? movement.measureCount,
    });
  }

  const chords = resolveChords(movement, input);
  const candidates = resolveTargets(movement, input);
  if (candidates.length === 0) {
    fail('INVALID_REQUEST', 'No hay partes destino donde orquestar', {
      available: [...movement.partIds],
    });
  }

  const roles = assignRoles(candidates, {
    style,
    seed,
    ...(melodyRangeOf(melody) !== null ? { melodyRange: melodyRangeOf(melody)! } : {}),
    ...(input.maxMelodyDoublings !== undefined
      ? { maxMelodyDoublings: input.maxMelodyDoublings }
      : {}),
  });

  const assignments = roles.map((assignment) => {
    const part = movement.part(assignment.partId);
    const voice = part.mainVoice;
    if (input.replace ?? false) voice.clear();

    const material = materialFor(
      assignment.role,
      melody,
      chords,
      assignment.instrument,
      assignment.chordDegree ?? 0,
    );

    // El ajuste de registro va SIEMPRE al final: es el que convierte alturas
    // sonantes en escritas, y hacerlo antes dejaria el material a medio
    // transponer para los instrumentos transpositores.
    const fit = fitToRange(material, assignment.instrument);
    voice.padTo(from);
    voice.append(...fit.events);

    return {
      partId: assignment.partId,
      instrument: assignment.instrument.id,
      role: assignment.role,
      octaveShift: fit.octaveShift,
      events: fit.events.length,
      outOfRange: fit.outOfRange,
    };
  });

  const balance = checkBalance(roles);
  return {
    seed,
    style,
    assignments,
    balance: { weights: balance.weights, issues: balance.issues },
    sourceMeasures: movement.timeline.measureStarts(
      melody.reduce((total, event) => total.plus(event.duration), Duration.ZERO),
    ).length,
  };
}

function parseStyle(style: string | undefined): OrchestrationStyle {
  if (style === undefined) return 'melodia-acompanamiento';
  if (!STYLES.has(style as OrchestrationStyle)) {
    fail('INVALID_REQUEST', `Estilo de orquestacion desconocido: "${style}"`, {
      style,
      available: [...STYLES],
    });
  }
  return style as OrchestrationStyle;
}

function resolveChords(movement: Movement, input: OrchestrateInput): Chord[] {
  if (!input.progression || input.progression.length === 0) return [];
  const key =
    input.key !== undefined
      ? KeySignature.parse(input.key)
      : movement.timeline.keyAt(Duration.ZERO);
  return input.progression.map((symbol) => RomanNumeral.parse(symbol, key).realize(key));
}

/**
 * Partes destino.
 *
 * Por defecto todas menos la de origen y la percusion sin altura: orquestar
 * una melodia sobre una bateria no significa nada, y el agente no deberia
 * tener que excluirla a mano cada vez.
 */
function resolveTargets(movement: Movement, input: OrchestrateInput): OrchestrationCandidate[] {
  const ids =
    input.targetPartIds ??
    movement.partIds.filter(
      (id) => id !== input.sourcePartId && !movement.part(id).instrument.isPercussion,
    );

  return ids.map((partId) => ({ partId, instrument: movement.part(partId).instrument }));
}

function melodyRangeOf(
  events: readonly MusicalEvent[],
): { lowest: Pitch; highest: Pitch } | null {
  const pitches = events.flatMap((event) => [...event.pitches]);
  if (pitches.length === 0) return null;

  const sorted = [...pitches].sort((a, b) => a.compare(b));
  return { lowest: sorted[0]!, highest: sorted[sorted.length - 1]! };
}
