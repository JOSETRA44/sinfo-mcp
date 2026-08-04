import { Duration } from '../time/duration.js';
import { Interval } from '../pitch/interval.js';
import { Pitch } from '../pitch/pitch.js';
import type { Articulation } from './articulation.js';
import type { Dynamic } from './dynamics.js';

export type TiePosition = 'start' | 'continue' | 'stop';

/**
 * Un evento en una voz: nota, acorde o silencio.
 *
 * Los tres casos se unifican en `pitches`: vacio es silencio, uno es nota,
 * varios es acorde. Colapsarlos evita repetir en cada generador y cada
 * exportador la misma cadena de `if (esSilencio) ... else if (esAcorde) ...`.
 *
 * A diferencia de Pitch y Duration, que son clases porque tienen aritmetica
 * propia, el evento es DATO: un objeto congelado. En una sinfonia hay cientos
 * de miles, y no necesitan comportamiento.
 */
export interface MusicalEvent {
  /** Vacio = silencio. Una altura = nota. Varias = acorde. */
  readonly pitches: readonly Pitch[];
  /** Duracion ESCRITA. La articulacion no la modifica. */
  readonly duration: Duration;
  readonly dynamic?: Dynamic;
  readonly articulations?: readonly Articulation[];
  /** Velocity MIDI explicita 1..127; anula lo que se deduzca de la dinamica. */
  readonly velocity?: number;
  readonly tie?: TiePosition;
  readonly lyric?: string;
}

/** Quita `readonly` para poder construir el evento antes de congelarlo. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface EventOptions {
  readonly dynamic?: Dynamic;
  readonly articulations?: readonly Articulation[];
  readonly velocity?: number;
  readonly tie?: TiePosition;
  readonly lyric?: string;
}

// ----------------------------------------------------------------- fabricas

/** Nota simple. Acepta la altura como objeto o como texto (`"C4"`). */
export function note(
  pitch: Pitch | string,
  duration: Duration,
  options: EventOptions = {},
): MusicalEvent {
  const resolved = typeof pitch === 'string' ? Pitch.parse(pitch) : pitch;
  return makeEvent([resolved], duration, options);
}

/** Acorde: varias alturas simultaneas con la misma duracion. */
export function chord(
  pitches: readonly (Pitch | string)[],
  duration: Duration,
  options: EventOptions = {},
): MusicalEvent {
  const resolved = pitches.map((p) => (typeof p === 'string' ? Pitch.parse(p) : p));
  // Ordenar de grave a agudo hace deterministas la comparacion y la salida.
  resolved.sort((a, b) => a.compare(b));
  return makeEvent(resolved, duration, options);
}

/** Silencio. */
export function rest(duration: Duration): MusicalEvent {
  return makeEvent([], duration, {});
}

function makeEvent(
  pitches: readonly Pitch[],
  duration: Duration,
  options: EventOptions,
): MusicalEvent {
  // Se omiten las claves ausentes en vez de ponerlas en undefined: con
  // exactOptionalPropertyTypes no es lo mismo, y ademas alivia la
  // serializacion de partituras grandes.
  const event: Mutable<MusicalEvent> = { pitches: Object.freeze(pitches), duration };
  if (options.dynamic !== undefined) event.dynamic = options.dynamic;
  if (options.articulations !== undefined && options.articulations.length > 0) {
    event.articulations = Object.freeze([...options.articulations]);
  }
  if (options.velocity !== undefined) event.velocity = options.velocity;
  if (options.tie !== undefined) event.tie = options.tie;
  if (options.lyric !== undefined) event.lyric = options.lyric;
  return Object.freeze(event);
}

// ------------------------------------------------------------------ lectura

export function isRest(event: MusicalEvent): boolean {
  return event.pitches.length === 0;
}

export function isNote(event: MusicalEvent): boolean {
  return event.pitches.length === 1;
}

export function isChord(event: MusicalEvent): boolean {
  return event.pitches.length > 1;
}

/** Altura mas grave del evento, o null si es silencio. */
export function lowestPitch(event: MusicalEvent): Pitch | null {
  return event.pitches[0] ?? null;
}

/** Altura mas aguda del evento, o null si es silencio. */
export function highestPitch(event: MusicalEvent): Pitch | null {
  return event.pitches[event.pitches.length - 1] ?? null;
}

// --------------------------------------------------------------- operaciones

/** Transpone todas las alturas conservando la escritura. Los silencios pasan igual. */
export function transposeEvent(event: MusicalEvent, interval: Interval): MusicalEvent {
  if (isRest(event)) return event;
  return {
    ...event,
    pitches: Object.freeze(event.pitches.map((p) => p.transpose(interval))),
  };
}

/** Copia el evento con otra duracion. */
export function withDuration(event: MusicalEvent, duration: Duration): MusicalEvent {
  return Object.freeze({ ...event, duration });
}

/** Copia el evento con otras opciones; las claves ausentes no se tocan. */
export function withOptions(event: MusicalEvent, options: EventOptions): MusicalEvent {
  return makeEvent(event.pitches, event.duration, {
    ...stripUndefined(event),
    ...stripUndefined(options),
  });
}

function stripUndefined(source: EventOptions): EventOptions {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) result[key] = value;
  }
  return result as EventOptions;
}
