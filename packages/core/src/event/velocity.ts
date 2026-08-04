import { articulationEmphasis } from './articulation.js';
import { DYNAMICS, dynamicLevel, type Dynamic } from './dynamics.js';
import type { MusicalEvent } from './event.js';

/**
 * Traduccion de dinamica escrita a velocity MIDI.
 *
 * Esta es la frontera entre lo que dice la partitura y lo que se oye, y es la
 * pieza que mas se retoca segun como suene el resultado. Por eso la curva es
 * un PARAMETRO, no codigo fijo: se puede sustituir sin tocar el dominio ni
 * recompilar nada, y conviven varias en la misma partitura (una para cuerda,
 * otra para percusion).
 */

/** Rango valido de velocity MIDI. El 0 es "note off", no un pianissimo. */
export const MIN_VELOCITY = 1;
export const MAX_VELOCITY = 127;

/** Dinamica que se asume cuando la partitura no marca ninguna. */
export const DEFAULT_DYNAMIC: Dynamic = 'mf';

export function clampVelocity(value: number): number {
  return Math.max(MIN_VELOCITY, Math.min(MAX_VELOCITY, Math.round(value)));
}

/**
 * Convierte (dinamica, enfasis, ajuste) en velocity MIDI.
 *
 * - `dynamic`: una de las ocho marcas, de ppp a fff
 * - `emphasis`: escalones EXTRA que aportan las articulaciones
 *   (accent +1, marcato +2, el resto 0)
 * - `offset`: ajuste en unidades de velocity, normalmente por instrumento
 */
export type VelocityCurve = (dynamic: Dynamic, emphasis: number, offset: number) => number;

/**
 * Curva por defecto: tabla calibrada a mano, al estilo de los editores de
 * partitura. Los valores no son una rampa lineal porque el oido tampoco lo
 * es: hay mas separacion en los matices suaves, donde se distingue mejor.
 */
const CALIBRATED_TABLE = [20, 33, 49, 64, 80, 96, 112, 126] as const;

export const calibratedCurve: VelocityCurve = (dynamic, emphasis, offset) => {
  const level = Math.min(DYNAMICS.length - 1, dynamicLevel(dynamic) + emphasis);
  return clampVelocity(CALIBRATED_TABLE[level]! + offset);
};

/**
 * Curva alternativa de potencia, mas expresiva en los pianissimos.
 * Se elige pasandola en el contexto; no hay que tocar nada mas.
 */
export const exponentialCurve: VelocityCurve = (dynamic, emphasis, offset) => {
  const level = Math.min(DYNAMICS.length - 1, dynamicLevel(dynamic) + emphasis);
  return clampVelocity(MAX_VELOCITY * (level / (DYNAMICS.length - 1)) ** 1.5 + offset);
};

/** Rampa lineal simple. Util para depurar: la relacion es evidente. */
export const linearCurve: VelocityCurve = (dynamic, emphasis, offset) => {
  const level = Math.min(DYNAMICS.length - 1, dynamicLevel(dynamic) + emphasis);
  return clampVelocity(((level + 1) / DYNAMICS.length) * MAX_VELOCITY + offset);
};

export interface VelocityContext {
  /** Dinamica vigente por si el evento no trae la suya. */
  readonly prevailingDynamic?: Dynamic;
  /**
   * Desplazamiento por instrumento, en velocity. Compensa que un mismo `mf`
   * no rinde igual en un flautin que en un contrabajo.
   */
  readonly instrumentOffset?: number;
  /** Curva a aplicar. Por defecto, la calibrada. */
  readonly curve?: VelocityCurve;
}

/**
 * Velocity MIDI final de un evento.
 *
 * Si el evento trae `velocity` explicita esa manda y no se aplica ninguna
 * curva: lo que el compositor fija a mano no se reinterpreta.
 */
export function resolveVelocity(event: MusicalEvent, context: VelocityContext = {}): number {
  if (event.velocity !== undefined) return clampVelocity(event.velocity);

  const dynamic = event.dynamic ?? context.prevailingDynamic ?? DEFAULT_DYNAMIC;
  const emphasis = articulationEmphasis(event.articulations ?? []);
  const curve = context.curve ?? calibratedCurve;

  return curve(dynamic, emphasis, context.instrumentOffset ?? 0);
}
