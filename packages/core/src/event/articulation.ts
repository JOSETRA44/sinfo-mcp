/**
 * Articulacion: como se ataca y se sostiene la nota.
 *
 * Dos grupos con efectos distintos al sonar:
 * - los que cambian la DURACION real (staccato acorta, tenuto sostiene)
 * - los que cambian la INTENSIDAD (accent, marcato)
 * Un mismo evento puede llevar de los dos (staccato + accent es normal).
 */
export type Articulation =
  | 'staccato'
  | 'staccatissimo'
  | 'tenuto'
  | 'accent'
  | 'marcato'
  | 'legato'
  | 'portato'
  | 'fermata';

/**
 * Fraccion de la duracion escrita que la nota suena realmente.
 *
 * Es solo la interpretacion al sintetizar: la duracion ESCRITA no cambia
 * nunca, porque la partitura debe seguir mostrando lo que el compositor puso.
 */
export const ARTICULATION_LENGTH: Readonly<Record<Articulation, number>> = {
  staccatissimo: 0.25,
  staccato: 0.5,
  portato: 0.75,
  legato: 1.0,
  tenuto: 1.0,
  accent: 0.9,
  marcato: 0.8,
  fermata: 1.5,
};

/** Cuantos escalones de dinamica anade cada articulacion. */
export const ARTICULATION_EMPHASIS: Readonly<Record<Articulation, number>> = {
  staccatissimo: 0,
  staccato: 0,
  portato: 0,
  legato: 0,
  tenuto: 0,
  accent: 1,
  marcato: 2,
  fermata: 0,
};

/** Multiplicador de duracion resultante de combinar varias articulaciones. */
export function articulationLengthFactor(articulations: readonly Articulation[]): number {
  // La mas corta manda: staccato + accent suena staccato.
  return articulations.reduce(
    (factor, articulation) => Math.min(factor, ARTICULATION_LENGTH[articulation]),
    1,
  );
}

/** Escalones de dinamica que suman las articulaciones presentes. */
export function articulationEmphasis(articulations: readonly Articulation[]): number {
  return articulations.reduce(
    (total, articulation) => total + ARTICULATION_EMPHASIS[articulation],
    0,
  );
}
