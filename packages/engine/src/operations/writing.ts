import {
  DomainError,
  Duration,
  parseGrid,
  parseVoice,
  restsBetween,
  validateBarlines,
  type Movement,
  type MusicalEvent,
  type Part,
} from '@sinfo/core';
import { fail } from '../errors.js';

/**
 * Escritura de musica en una parte.
 *
 * Aqui es donde el agente vuelca notas, asi que es donde mas caro sale un
 * error silencioso. La operacion valida ANTES de escribir y no deja la
 * partitura a medias si algo falla.
 */

export type NotationMode = 'sinfoscript' | 'grid';
export type WriteMode = 'append' | 'replace';

export interface WritePartInput {
  readonly partId: string;
  readonly notation: string;
  readonly mode?: WriteMode | undefined;
  readonly format?: NotationMode | undefined;
  readonly voiceId?: string | undefined;
  /** Compas donde empezar (base 1). Rellena con silencios si hace falta. */
  readonly atMeasure?: number | undefined;
  /**
   * Rechaza la escritura si los compases marcados con `|` no cuadran.
   * Activo por defecto: escribir mal los tiempos es el fallo mas frecuente
   * de un modelo componiendo, y detectarlo tarde cuesta mucho mas.
   */
  readonly strictBarlines?: boolean | undefined;
}

export interface WritePartResult {
  readonly partId: string;
  readonly voiceId: string;
  readonly eventsWritten: number;
  readonly durationWritten: string;
  readonly startMeasure: number;
  readonly endMeasure: number;
  readonly totalMeasures: number;
  readonly warnings: readonly string[];
}

export function writePart(movement: Movement, input: WritePartInput): WritePartResult {
  const part = movement.part(input.partId);
  const voice = input.voiceId ? part.ensureVoice(input.voiceId) : part.mainVoice;
  const format = input.format ?? detectFormat(input.notation);

  const { events, warnings } = parseNotation(input, movement, format);

  if (events.length === 0) {
    fail('NOTATION_ERROR', 'La notacion no contiene ningun evento', {
      partId: input.partId,
      format,
    });
  }

  if ((input.mode ?? 'append') === 'replace') voice.clear();

  const startPosition = resolveStartPosition(movement, voice.duration, input.atMeasure);
  // Rellenar hasta la posicion pedida mantiene alineadas las partes que
  // entran tarde: sin esto, una trompa que empieza en el compas 9 sonaria
  // desde el compas 1. Los silencios van partidos por compas, como los
  // escribiria un copista, no como un unico simbolo imposible.
  voice.append(...restsBetween(movement.timeline, voice.duration, startPosition));

  const before = voice.duration;
  voice.append(...events);

  const written = voice.duration.minus(before);
  return {
    partId: part.id,
    voiceId: voice.id,
    eventsWritten: events.length,
    durationWritten: written.toString(),
    startMeasure: movement.timeline.measureNumberAt(startPosition),
    endMeasure: movement.timeline.measureStarts(voice.duration).length,
    totalMeasures: movement.measureCount,
    warnings,
  };
}

interface ParsedNotation {
  readonly events: readonly MusicalEvent[];
  readonly warnings: readonly string[];
}

function parseNotation(
  input: WritePartInput,
  movement: Movement,
  format: NotationMode,
): ParsedNotation {
  try {
    if (format === 'grid') {
      return { events: parseGrid(input.notation).events, warnings: [] };
    }

    const parsed = parseVoice(input.notation);
    const measureDuration = movement.timeline
      .timeSignatureAt(Duration.ZERO)
      .measureDuration;
    const issues = validateBarlines(parsed, measureDuration);

    if (issues.length > 0 && (input.strictBarlines ?? true)) {
      fail('NOTATION_ERROR', issues.map((issue) => issue.message).join('; '), {
        partId: input.partId,
        issues,
        hint:
          'Revisa los tiempos de cada compas, o pasa strictBarlines:false si el ' +
          'descuadre es intencionado (anacrusa, cambio de compas).',
      });
    }

    return {
      events: parsed.events,
      warnings: issues.map((issue) => issue.message),
    };
  } catch (error) {
    // Un error de dominio aqui es notacion mal escrita, no un fallo interno:
    // se reetiqueta para que el agente sepa que lo puede corregir el mismo.
    if (error instanceof DomainError) {
      fail('NOTATION_ERROR', error.message, { partId: input.partId, ...error.details });
    }
    throw error;
  }
}

/**
 * Adivina el formato para no obligar al agente a declararlo.
 *
 * Una rejilla tiene filas de `x` y `.`; SinfoScript tiene barras `/` entre
 * altura y figura. Son lo bastante distintos como para no confundirse.
 */
function detectFormat(notation: string): NotationMode {
  const hasSlashDurations = /[a-gA-Gr]\S*\/[whqestx]/.test(notation);
  if (hasSlashDurations) return 'sinfoscript';

  const hasGridRows = /^\s*\S+\s+[xXo.\-|]{2,}\s*$/m.test(notation);
  return hasGridRows ? 'grid' : 'sinfoscript';
}

function resolveStartPosition(
  movement: Movement,
  currentEnd: Duration,
  atMeasure: number | undefined,
): Duration {
  if (atMeasure === undefined) return currentEnd;
  if (!Number.isInteger(atMeasure) || atMeasure < 1) {
    fail('INVALID_REQUEST', 'atMeasure debe ser un entero mayor o igual que 1', { atMeasure });
  }
  return movement.timeline.measureStart(atMeasure);
}

export interface ClearPartInput {
  readonly partId: string;
  readonly voiceId?: string | undefined;
}

export function clearPart(movement: Movement, input: ClearPartInput): { cleared: number } {
  const part: Part = movement.part(input.partId);
  if (input.voiceId !== undefined) {
    const voice = part.voice(input.voiceId);
    const cleared = voice.length;
    voice.clear();
    return { cleared };
  }

  let cleared = 0;
  for (const voice of part.voices) {
    cleared += voice.length;
    voice.clear();
  }
  return { cleared };
}
