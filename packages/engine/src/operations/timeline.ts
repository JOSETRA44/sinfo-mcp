import { KeySignature, Tempo, TimeSignature, type Movement } from '@sinfo/core';
import { fail } from '../errors.js';

/**
 * Cambios de compas, tempo y tonalidad.
 *
 * Se piden por NUMERO DE COMPAS, no por posicion absoluta: es como lo piensa
 * quien compone ("a partir del 33 pasamos a 6/8") y evita que el agente tenga
 * que convertir a fracciones de redonda, cuenta que hace mal.
 */

export interface SetTimelineInput {
  readonly atMeasure?: number | undefined;
  readonly timeSignature?: string | undefined;
  readonly tempo?: number | undefined;
  readonly tempoMarking?: string | undefined;
  readonly key?: string | undefined;
}

export interface SetTimelineResult {
  readonly atMeasure: number;
  readonly applied: readonly string[];
}

export function setTimeline(movement: Movement, input: SetTimelineInput): SetTimelineResult {
  const atMeasure = input.atMeasure ?? 1;
  if (!Number.isInteger(atMeasure) || atMeasure < 1) {
    fail('INVALID_REQUEST', 'atMeasure debe ser un entero mayor o igual que 1', { atMeasure });
  }

  const position = movement.timeline.measureStart(atMeasure);
  const applied: string[] = [];

  if (input.timeSignature !== undefined) {
    const value = TimeSignature.parse(input.timeSignature);
    movement.timeline.setTimeSignature(position, value);
    applied.push(`compas ${value.toString()}`);
  }

  if (input.tempo !== undefined || input.tempoMarking !== undefined) {
    const value =
      input.tempo !== undefined ? Tempo.of(input.tempo) : Tempo.fromMarking(input.tempoMarking!);
    movement.timeline.setTempo(position, value);
    applied.push(`tempo ${value.toString()}`);
  }

  if (input.key !== undefined) {
    const value = KeySignature.parse(input.key);
    movement.timeline.setKey(position, value);
    applied.push(`tonalidad ${value.name}`);
  }

  if (applied.length === 0) {
    fail('INVALID_REQUEST', 'No se indico ningun cambio (timeSignature, tempo o key)', {
      atMeasure,
    });
  }

  return { atMeasure, applied };
}
