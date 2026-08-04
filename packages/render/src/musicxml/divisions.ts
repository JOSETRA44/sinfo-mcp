import type { Duration } from '@sinfo/core';

/**
 * MusicXML mide las duraciones en enteros: `<divisions>` dice cuantas unidades
 * vale una negra, y cada nota declara su duracion en esas unidades.
 *
 * El valor no puede elegirse a ojo. Si no es multiplo de los denominadores que
 * aparecen en la obra, los tresillos y quintillos caen en fracciones de unidad
 * y el editor cuadra los compases como puede: notas desplazadas, silencios
 * fantasma, barras descolocadas. Se calcula el minimo comun multiplo de todos
 * los denominadores presentes, con lo que TODA duracion sale entera exacta.
 */

/** Tope de seguridad. Con septillos y quintillos juntos el mcm se dispara. */
const MAX_DIVISIONS = 30_240;

export function computeDivisions(durations: Iterable<Duration>): number {
  let result = 4;
  for (const duration of durations) {
    if (duration.num === 0) continue;
    result = lcm(result, duration.den);
    if (result > MAX_DIVISIONS) return MAX_DIVISIONS;
  }
  return result;
}

/** Duracion expresada en unidades de `divisions`. */
export function toDivisions(duration: Duration, divisions: number): number {
  return Math.round((duration.num * 4 * divisions) / duration.den);
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a === 0 ? 1 : a;
}
