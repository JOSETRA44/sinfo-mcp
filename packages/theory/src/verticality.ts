import { Duration, type Pitch, type Voice } from '@sinfo/core';

/**
 * Un corte vertical de la textura: que suena en cada voz en un instante dado.
 *
 * Es el objeto sobre el que trabaja todo el analisis armonico y de conduccion
 * de voces. La partitura se guarda por VOCES (cada una su hilo horizontal),
 * pero la armonia se lee por COLUMNAS, y alguien tiene que hacer esa
 * transposicion. Aqui, una vez.
 */
export interface Verticality {
  readonly position: Duration;
  /** Una entrada por voz, en el mismo orden que se pasaron. null = calla. */
  readonly pitches: readonly (Pitch | null)[];
  /** true si alguna voz ataca justo aqui (no viene sonando de antes). */
  readonly hasOnset: boolean;
}

export interface LabeledVoice {
  readonly label: string;
  readonly voice: Voice;
}

/**
 * Corta las voces en verticalidades.
 *
 * Se corta en cada ATAQUE de cualquier voz, no en una rejilla fija. Con
 * rejilla habria que elegir una resolucion, y cualquiera que se elija parte mal
 * algun ritmo: los tresillos no caen en una rejilla binaria y las notas largas
 * generan cientos de columnas identicas. Con los ataques reales, el numero de
 * columnas es exactamente el numero de cambios que hay en la musica.
 */
export function extractVerticalities(voices: readonly LabeledVoice[]): Verticality[] {
  if (voices.length === 0) return [];

  const onsets = collectOnsets(voices);
  return onsets.map((position) => ({
    position,
    pitches: voices.map(({ voice }) => soundingPitchAt(voice, position)),
    hasOnset: true,
  }));
}

/** Instantes en que ataca alguna voz, ordenados y sin repetir. */
function collectOnsets(voices: readonly LabeledVoice[]): Duration[] {
  const seen = new Map<string, Duration>();

  for (const { voice } of voices) {
    for (const { position } of voice.positioned()) {
      seen.set(position.toString(), position);
    }
  }

  return [...seen.values()].sort((a, b) => a.compare(b));
}

/**
 * Altura que suena en esa voz en ese instante.
 *
 * Devuelve la nota mas AGUDA cuando hay un acorde: en el analisis de
 * conduccion de voces, una voz que toca varias notas a la vez no es una voz
 * sino varias, y quedarse con la superior es la convencion habitual para no
 * inventar movimientos que nadie escribio.
 */
function soundingPitchAt(voice: Voice, position: Duration): Pitch | null {
  const found = voice.eventAt(position);
  if (!found || found.event.pitches.length === 0) return null;
  return found.event.pitches[found.event.pitches.length - 1]!;
}

/**
 * Todas las alturas que suenan en un instante, incluidas las de los acordes.
 * Es lo que necesita el analisis armonico, que si quiere el acorde completo.
 */
export function sonorityAt(
  voices: readonly LabeledVoice[],
  position: Duration,
): Pitch[] {
  const pitches: Pitch[] = [];
  for (const { voice } of voices) {
    const found = voice.eventAt(position);
    if (found) pitches.push(...found.event.pitches);
  }
  return pitches.sort((a, b) => a.compare(b));
}
