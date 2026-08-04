import {
  classifyPitch,
  Duration,
  serializeVoice,
  soundingPitch,
  type Movement,
  type Score,
} from '@sinfo/core';
import { fail } from '../errors.js';

/**
 * Lectura de la partitura.
 *
 * La regla que gobierna todo este modulo: NUNCA se devuelve la obra entera.
 * Un movimiento sinfonico son decenas de miles de eventos y no cabe en el
 * contexto del modelo. Se devuelven resumenes, o fragmentos que el agente
 * pide explicitamente acotados por compases.
 */

/** Tope de compases por lectura. Evita devolver una obra entera por descuido. */
const MAX_MEASURES_PER_READ = 64;

export interface ReadPartInput {
  readonly partId: string;
  readonly voiceId?: string | undefined;
  /** Primer compas a leer, base 1. Por defecto el 1. */
  readonly fromMeasure?: number | undefined;
  /** Ultimo compas incluido. Por defecto, 8 compases desde el inicio. */
  readonly toMeasure?: number | undefined;
}

export interface ReadPartResult {
  readonly partId: string;
  readonly voiceId: string;
  readonly fromMeasure: number;
  readonly toMeasure: number;
  readonly notation: string;
  readonly eventCount: number;
  readonly truncated: boolean;
}

export function readPart(movement: Movement, input: ReadPartInput): ReadPartResult {
  const part = movement.part(input.partId);
  const voice = input.voiceId ? part.voice(input.voiceId) : part.mainVoice;

  const fromMeasure = input.fromMeasure ?? 1;
  const requestedTo = input.toMeasure ?? fromMeasure + 7;
  if (requestedTo < fromMeasure) {
    fail('INVALID_REQUEST', 'toMeasure no puede ser menor que fromMeasure', {
      fromMeasure,
      toMeasure: requestedTo,
    });
  }

  const toMeasure = Math.min(requestedTo, fromMeasure + MAX_MEASURES_PER_READ - 1);
  const from = movement.timeline.measureStart(fromMeasure);
  const to = movement.timeline.measureStart(toMeasure + 1);

  const slice = voice.between(from, to);
  const measureDuration = movement.timeline.timeSignatureAt(from).measureDuration;

  return {
    partId: part.id,
    voiceId: voice.id,
    fromMeasure,
    toMeasure,
    notation: serializeVoice(
      slice.map((entry) => entry.event),
      { measureDuration },
    ),
    eventCount: slice.length,
    truncated: toMeasure < requestedTo,
  };
}

export interface DescribeScoreResult {
  readonly summary: ReturnType<Score['summary']>;
  readonly durationSeconds: number;
  readonly history: readonly string[];
}

export function describeScore(score: Score, history: readonly string[]): DescribeScoreResult {
  return {
    summary: score.summary(),
    durationSeconds: estimateSeconds(score),
    // Solo lo reciente: el historial completo crece sin limite y aporta poco.
    history: history.slice(-12),
  };
}

/** Duracion aproximada en segundos, respetando los cambios de tempo. */
function estimateSeconds(score: Score): number {
  let total = 0;
  for (const movement of score.movements) {
    const changes = movement.timeline.tempoChanges;
    const end = movement.duration;

    for (const [index, change] of changes.entries()) {
      const segmentEnd = changes[index + 1]?.at ?? end;
      if (segmentEnd.lessThan(change.at)) continue;
      total += change.value.secondsFor(segmentEnd.minus(change.at));
    }
  }
  return Math.round(total * 10) / 10;
}

export interface RangeIssue {
  readonly partId: string;
  readonly measure: number;
  readonly written: string;
  readonly sounding: string;
  readonly verdict: string;
}

/**
 * Comprueba que cada parte se mantiene en el rango de su instrumento.
 *
 * Distingue lo imposible de lo incomodo: una nota fuera del rango fisico es
 * un error, una nota en el extremo de la tesitura es un aviso. Sin esa
 * distincion el agente o ignora las alertas o se autolimita de mas.
 */
export function checkRanges(movement: Movement, partId?: string): RangeIssue[] {
  const parts = partId ? [movement.part(partId)] : movement.parts;
  const issues: RangeIssue[] = [];

  for (const part of parts) {
    if (part.instrument.isPercussion) continue;

    for (const voice of part.voices) {
      for (const { position, event } of voice.positioned()) {
        for (const written of event.pitches) {
          const sounding = soundingPitch(part.instrument, written);
          const verdict = classifyPitch(part.instrument, sounding);
          if (verdict === 'comfortable') continue;

          issues.push({
            partId: part.id,
            measure: movement.timeline.measureNumberAt(position),
            written: written.name,
            sounding: sounding.name,
            verdict,
          });
        }
      }
    }
  }

  return issues;
}

export interface TimelineChange {
  readonly measure: number;
  readonly value: string;
}

export function describeTimeline(movement: Movement): {
  timeSignatures: TimelineChange[];
  tempos: TimelineChange[];
  keys: TimelineChange[];
} {
  const toChange = (at: Duration, value: string): TimelineChange => ({
    measure: movement.timeline.measureNumberAt(at),
    value,
  });

  return {
    timeSignatures: movement.timeline.timeSignatureChanges.map((entry) =>
      toChange(entry.at, entry.value.toString()),
    ),
    tempos: movement.timeline.tempoChanges.map((entry) =>
      toChange(entry.at, entry.value.toString()),
    ),
    keys: movement.timeline.keyChanges.map((entry) => toChange(entry.at, entry.value.name)),
  };
}
