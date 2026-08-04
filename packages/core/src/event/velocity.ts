import {
  articulationEmphasis,
  type Articulation,
} from './articulation.js';
import { DYNAMICS, dynamicLevel, type Dynamic } from './dynamics.js';
import type { MusicalEvent } from './event.js';

/**
 * Traduccion de dinamica escrita a velocity MIDI.
 *
 * Esta es la frontera entre lo que dice la partitura y lo que se oye. Vive
 * aislada en su propio modulo, con una sola funcion publica, precisamente
 * porque es la pieza que mas se va a retocar segun como suene el resultado:
 * cambiarla no debe obligar a tocar el dominio.
 */

/** Rango valido de velocity MIDI. El 0 es "note off", no un pianissimo. */
export const MIN_VELOCITY = 1;
export const MAX_VELOCITY = 127;

/** Dinamica que se asume cuando la partitura no marca ninguna. */
export const DEFAULT_DYNAMIC: Dynamic = 'mf';

export interface VelocityContext {
  /** Dinamica vigente por si el evento no trae la suya. */
  readonly prevailingDynamic?: Dynamic;
  /**
   * Desplazamiento por instrumento, en velocity. Permite compensar que un
   * mismo `mf` no rinde igual en un flautin que en un contrabajo.
   */
  readonly instrumentOffset?: number;
}

export function clampVelocity(value: number): number {
  return Math.max(MIN_VELOCITY, Math.min(MAX_VELOCITY, Math.round(value)));
}

/**
 * Velocity MIDI final de un evento.
 *
 * Prioridad: si el evento trae `velocity` explicita, esa manda y no se toca
 * nada mas. Si no, hay que deducirla de la dinamica y las articulaciones.
 *
 * Piezas ya disponibles para el calculo:
 * - `DYNAMICS`         array ordenado ppp..fff (8 escalones, indices 0..7)
 * - `dynamicLevel(d)`  indice 0..7 de una dinamica
 * - `articulationEmphasis(arts)`  escalones EXTRA que suman accent (+1) y
 *                                 marcato (+2); 0 para el resto
 * - `clampVelocity(n)` recorta a 1..127 y redondea
 * - `context.instrumentOffset`    ajuste por instrumento, puede ser negativo
 *
 * TODO(usuario): implementar el cuerpo. Ver la explicacion de las opciones
 * en el mensaje del chat.
 */
export function resolveVelocity(
  event: MusicalEvent,
  context: VelocityContext = {},
): number {
  if (event.velocity !== undefined) return clampVelocity(event.velocity);

  const dynamic = event.dynamic ?? context.prevailingDynamic ?? DEFAULT_DYNAMIC;
  const emphasis = articulationEmphasis(event.articulations ?? []);
  const offset = context.instrumentOffset ?? 0;

  return mapDynamicToVelocity(dynamic, emphasis, offset);
}

/**
 * Convierte (dinamica, enfasis, ajuste) en un numero 1..127.
 *
 * TODO(usuario): este es el cuerpo a escribir. `dynamic` es una de las 8
 * marcas, `emphasis` son escalones extra por articulacion, `offset` es el
 * ajuste por instrumento en unidades de velocity.
 */
function mapDynamicToVelocity(
  dynamic: Dynamic,
  emphasis: number,
  offset: number,
): number {
  void DYNAMICS;
  void dynamicLevel;
  void dynamic;
  void emphasis;
  void offset;
  throw new Error('mapDynamicToVelocity sin implementar');
}

export type { Articulation, Dynamic };
