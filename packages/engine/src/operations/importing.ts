import type { Score } from '@sinfo/core';
import { type Performance, noteCount } from '@sinfo/perform';
import { type ToScoreOptions, type TrackReport, performanceToScore } from '@sinfo/transcribe';

/**
 * Importacion: de interpretacion a sesion de partitura.
 *
 * La operacion es delgada porque todo el trabajo dificil vive en
 * `@sinfo/transcribe`, que es codigo puro y probado aparte. Aqui solo se le da
 * forma al resultado para el agente.
 */

export interface ImportSummary {
  readonly title: string;
  /** Tonalidad estimada y cuanto fiarse de ella. */
  readonly key: string;
  readonly keyCorrelation: number;
  /** Margen sobre la segunda candidata: poco margen, decision fragil. */
  readonly keyMargin: number;
  readonly timeSignature: string;
  readonly tempo: number;
  readonly measures: number;
  readonly notes: number;
  readonly parts: readonly TrackReport[];
  /**
   * Lo que el agente deberia mirar antes de dar por buena la transcripcion.
   *
   * Se devuelven en la respuesta y no en un registro aparte porque quien
   * transcribe necesita enterarse de las decisiones que se han tomado por el:
   * un compas supuesto o una anacrusa desplazada cambian la partitura entera.
   */
  readonly warnings: readonly string[];
}

export interface ImportOutcome {
  readonly score: Score;
  readonly summary: ImportSummary;
}

export function importPerformance(
  id: string,
  performance: Performance,
  options: ToScoreOptions = {},
): ImportOutcome {
  const result = performanceToScore(performance, { ...options, scoreId: id });
  const movement = result.score.first;

  return {
    score: result.score,
    summary: {
      title: result.score.metadata.title,
      key: result.key.key.name,
      keyCorrelation: round(result.key.correlation),
      keyMargin: round(result.key.margin),
      timeSignature: result.timeSignature.toString(),
      tempo: round(result.tempo),
      measures: movement.timeline.measureNumberAt(movement.duration),
      notes: noteCount(performance),
      parts: result.tracks,
      warnings: result.warnings,
    },
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
