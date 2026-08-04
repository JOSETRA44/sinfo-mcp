import type { Dynamic } from '../event/dynamics.js';
import { rest, type MusicalEvent } from '../event/event.js';
import {
  analyzeDuration,
  splitIntoWritable,
  type DurationShape,
} from '../notation/duration-token.js';
import type { KeySignature } from '../pitch/key-signature.js';
import { Duration } from '../time/duration.js';
import type { Tempo } from '../time/tempo.js';
import type { TimeSignature } from '../time/time-signature.js';
import type { Timeline } from './timeline.js';
import type { Voice } from './voice.js';

/**
 * Reparto del flujo de eventos en compases.
 *
 * El dominio guarda cada voz como una secuencia continua, sin barras: es lo
 * que permite insertar y transformar musica sin rehacer la division cada vez.
 * Pero una partitura necesita barras, y una nota que cruza una barra hay que
 * PARTIRLA en dos figuras unidas por ligadura, porque la notacion no tiene
 * ningun simbolo que atraviese un compas.
 *
 * Ese reparto es delicado y lo necesitan por igual MusicXML, LilyPond y ABC,
 * asi que vive aqui una sola vez y no en cada exportador.
 */

export interface NotatedEvent {
  /** El evento con la duracion ya recortada a lo que cabe escrito. */
  readonly event: MusicalEvent;
  /** Figura, puntillos y grupo irregular, listos para el exportador. */
  readonly shape: DurationShape;
  /** Posicion absoluta desde el inicio del movimiento. */
  readonly position: Duration;
  /** Viene ligada de la figura anterior. */
  readonly tiedFromPrevious: boolean;
  /** Sigue ligada a la figura siguiente. */
  readonly tiedToNext: boolean;
  /** Dinamica vigente, ya arrastrada desde la ultima marca. */
  readonly dynamic: Dynamic | undefined;
  /** Silencio que ocupa el compas entero: se escribe con el simbolo especial. */
  readonly isFullMeasureRest: boolean;
}

export interface MeasureSlice {
  /** Numero de compas, empezando en 1. */
  readonly number: number;
  readonly start: Duration;
  readonly timeSignature: TimeSignature;
  readonly keySignature: KeySignature;
  readonly tempo: Tempo;
  /** true si el valor cambia justo en este compas y hay que reimprimirlo. */
  readonly timeSignatureChanged: boolean;
  readonly keyChanged: boolean;
  readonly tempoChanged: boolean;
  readonly events: readonly NotatedEvent[];
}

export interface SplitOptions {
  /**
   * Longitud total a cubrir. Sirve para que todas las partes tengan el mismo
   * numero de compases aunque una acabe antes: en una partitura, si los
   * violines siguen tocando, el fagot calla con silencios, no desaparece.
   */
  readonly totalDuration?: Duration;
}

export function splitIntoMeasures(
  voice: Voice,
  timeline: Timeline,
  options: SplitOptions = {},
): MeasureSlice[] {
  const total = maxDuration(voice.duration, options.totalDuration ?? Duration.ZERO);
  if (total.isZero) return [];

  const starts = timeline.measureStarts(total);
  // Se completa el ultimo compas con silencios. Un compas a medias es notacion
  // valida solo cuando forma pareja con una anacrusa; en cualquier otro caso
  // una partitura lo rellena. Ademas deja un invariante util: TODO compas suma
  // exactamente su indicacion, y eso se puede comprobar.
  const lastStart = starts.at(-1)!;
  const paddedTotal = lastStart.plus(timeline.timeSignatureAt(lastStart).measureDuration);
  const notated = notateEvents(voice, timeline, starts, paddedTotal);

  return starts.map((start, index) => {
    const number = index + 1;
    const end = starts[index + 1] ?? paddedTotal;
    const timeSignature = timeline.timeSignatureAt(start);
    const events = notated.filter(
      (item) => !item.position.lessThan(start) && item.position.lessThan(end),
    );

    return {
      number,
      start,
      timeSignature,
      keySignature: timeline.keyAt(start),
      tempo: timeline.tempoAt(start),
      // En el primer compas se imprime todo; despues, solo lo que cambia.
      timeSignatureChanged: number === 1 || changesAt(timeline.timeSignatureChanges, start),
      keyChanged: number === 1 || changesAt(timeline.keyChanges, start),
      tempoChanged: number === 1 || changesAt(timeline.tempoChanges, start),
      events,
    };
  });
}

/**
 * Convierte los eventos de la voz en figuras escribibles, partidas por barra
 * de compas y encadenadas con ligaduras.
 */
function notateEvents(
  voice: Voice,
  timeline: Timeline,
  starts: readonly Duration[],
  total: Duration,
): NotatedEvent[] {
  const result: NotatedEvent[] = [];
  let dynamic: Dynamic | undefined;
  /** El evento anterior dejo una ligadura abierta. */
  let tiePending = false;

  for (const { position, event } of voice.positioned()) {
    if (event.dynamic !== undefined) dynamic = event.dynamic;

    const pieces = splitAcrossMeasures(position, event.duration, starts);
    const pitched = event.pitches.length > 0;
    let offset = position;

    for (const [index, piece] of pieces.entries()) {
      const isFirst = index === 0;
      const isLast = index === pieces.length - 1;

      result.push(
        makeNotated({
          event,
          duration: piece,
          position: offset,
          dynamic,
          // Solo la primera figura hereda la ligadura que dejo el evento
          // anterior; las demas vienen ligadas del trozo que las precede.
          tiedFromPrevious: pitched && (isFirst ? tiePending : true),
          tiedToNext: pitched && (isLast ? event.tie === 'start' : true),
          timeSignature: timeline.timeSignatureAt(offset),
        }),
      );
      offset = offset.plus(piece);
    }

    tiePending = pitched && event.tie === 'start';
  }

  // La voz puede acabar antes que la obra: se completa con silencios para que
  // la parte no se quede con menos compases que las demas.
  const written = voice.duration;
  if (written.lessThan(total)) {
    let offset = written;
    for (const piece of splitAcrossMeasures(written, total.minus(written), starts)) {
      result.push(
        makeNotated({
          event: rest(piece),
          duration: piece,
          position: offset,
          dynamic: undefined,
          tiedFromPrevious: false,
          tiedToNext: false,
          timeSignature: timeline.timeSignatureAt(offset),
        }),
      );
      offset = offset.plus(piece);
    }
  }

  return result;
}

interface NotatedInput {
  readonly event: MusicalEvent;
  readonly duration: Duration;
  readonly position: Duration;
  readonly dynamic: Dynamic | undefined;
  readonly tiedFromPrevious: boolean;
  readonly tiedToNext: boolean;
  readonly timeSignature: TimeSignature;
}

function makeNotated(input: NotatedInput): NotatedEvent {
  const shape = analyzeDuration(input.duration) ?? {
    // No deberia ocurrir: splitAcrossMeasures ya devuelve solo figuras
    // escribibles. Si ocurriera, se escribe como negra antes que romper el
    // archivo entero: una figura mal es recuperable, un XML invalido no.
    base: 'q',
    noteType: 'quarter',
    dots: 0,
    tuplet: null,
  };

  return {
    event: { ...input.event, duration: input.duration },
    shape,
    position: input.position,
    tiedFromPrevious: input.tiedFromPrevious,
    tiedToNext: input.tiedToNext,
    dynamic: input.dynamic,
    isFullMeasureRest:
      input.event.pitches.length === 0 &&
      input.duration.equals(input.timeSignature.measureDuration),
  };
}

/**
 * Parte una duracion en trozos que ni cruzan barra de compas ni exceden lo que
 * una figura puede representar.
 */
function splitAcrossMeasures(
  position: Duration,
  duration: Duration,
  starts: readonly Duration[],
): Duration[] {
  const end = position.plus(duration);
  const pieces: Duration[] = [];
  let cursor = position;

  for (let guard = 0; guard < 10_000 && cursor.lessThan(end); guard++) {
    // Siguiente barra estrictamente por delante del cursor.
    const barline = starts.find((start) => start.greaterThan(cursor));
    const chunkEnd = barline !== undefined && barline.lessThan(end) ? barline : end;

    // Dentro del compas, la duracion todavia puede no caber en una figura
    // (una nota de 5/16 son negra y semicorchea atadas).
    pieces.push(...splitIntoWritable(chunkEnd.minus(cursor)));
    cursor = chunkEnd;
  }

  return pieces.length > 0 ? pieces : [duration];
}

function changesAt(
  entries: readonly { at: Duration }[],
  position: Duration,
): boolean {
  return entries.some((entry) => entry.at.equals(position));
}

function maxDuration(a: Duration, b: Duration): Duration {
  return a.greaterThan(b) ? a : b;
}
