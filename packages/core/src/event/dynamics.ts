/**
 * Dinamica: la intensidad escrita en la partitura.
 *
 * Es una MARCA, no un numero. `mf` no significa "velocity 80": significa
 * "medio fuerte", y lo que eso vale en velocity depende del instrumento, del
 * contexto y de la articulacion. La traduccion a numeros vive en
 * `resolveVelocity`, aislada, para poder cambiarla sin tocar el dominio.
 */
export type Dynamic = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff';

export const DYNAMICS: readonly Dynamic[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];

/** Posicion en la escala de dinamicas, 0 = ppp. Util para crescendos. */
export function dynamicLevel(dynamic: Dynamic): number {
  return DYNAMICS.indexOf(dynamic);
}

/** Sube o baja `steps` escalones de dinamica, sin salirse del rango. */
export function shiftDynamic(dynamic: Dynamic, steps: number): Dynamic {
  const index = dynamicLevel(dynamic) + steps;
  const clamped = Math.max(0, Math.min(DYNAMICS.length - 1, index));
  return DYNAMICS[clamped]!;
}

/** true si `a` suena mas fuerte que `b`. */
export function isLouderThan(a: Dynamic, b: Dynamic): boolean {
  return dynamicLevel(a) > dynamicLevel(b);
}
