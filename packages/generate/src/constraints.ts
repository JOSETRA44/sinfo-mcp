import type { Duration, Pitch } from '@sinfo/core';
import type { Chord, Scale } from '@sinfo/theory';

/**
 * Restricciones melodicas como funciones puntuables.
 *
 * En vez de una funcion gigante que decide la nota siguiente con veinte `if`
 * anidados, cada criterio es una restriccion independiente que puntua a los
 * candidatos. Anadir un criterio nuevo es escribir una funcion y sumarla a una
 * lista; quitarlo es borrarla. Ninguna sabe de las demas.
 *
 * Convencion de la puntuacion:
 *   0        prohibido, el candidato se descarta
 *   1        neutro
 *   mayor    preferido
 *   entre 0 y 1  desaconsejado pero posible
 *
 * Las puntuaciones se MULTIPLICAN, asi que un solo cero veta al candidato por
 * mucho que el resto lo prefiera. Es lo que se quiere: el rango del
 * instrumento no se negocia con el gusto por el grado conjunto.
 */

export interface MelodyContext {
  readonly scale: Scale;
  /** Acorde vigente en este instante. */
  readonly chord: Chord | null;
  /** Nota anterior, o null al empezar. */
  readonly previous: Pitch | null;
  /** Nota antes de la anterior; hace falta para resolver saltos. */
  readonly beforePrevious: Pitch | null;
  /** Alturas ya emitidas, de la mas reciente hacia atras. */
  readonly history: readonly Pitch[];
  readonly lowest: Pitch;
  readonly highest: Pitch;
  /** true si la nota cae en tiempo fuerte. */
  readonly isStrongBeat: boolean;
  /** Posicion dentro de la frase, de 0 a 1. */
  readonly progress: number;
  /** true si es la ultima nota de la frase. */
  readonly isLast: boolean;
  /** Altura hacia la que tiende el contorno en este punto, si la hay. */
  readonly target: Pitch | null;
  readonly duration: Duration;
}

export interface MelodyConstraint {
  readonly name: string;
  score(candidate: Pitch, context: MelodyContext): number;
}

/** El rango del instrumento no se negocia. */
export const withinRange: MelodyConstraint = {
  name: 'rango',
  score: (candidate, { lowest, highest }) =>
    candidate.midi >= lowest.midi && candidate.midi <= highest.midi ? 1 : 0,
};

/**
 * En tiempo fuerte, nota del acorde.
 *
 * Es lo que hace que una melodia SUENE a la armonia que la sostiene en vez de
 * flotar por encima. En tiempo debil las notas ajenas son bienvenidas: son las
 * notas de paso y los bordados que dan vida a la linea.
 */
export const chordToneOnStrongBeat: MelodyConstraint = {
  name: 'nota-del-acorde-en-tiempo-fuerte',
  score: (candidate, { chord, isStrongBeat }) => {
    if (!chord) return 1;
    const belongs = chord.contains(candidate);
    if (isStrongBeat) return belongs ? 3 : 0.15;
    return belongs ? 1.2 : 1;
  },
};

/**
 * Preferencia por el grado conjunto.
 *
 * Una melodia hecha de saltos es dificil de cantar y de recordar. La segunda
 * es lo normal, la tercera es comoda, y a partir de la sexta hay que tener un
 * motivo. La octava se admite porque es un gesto expresivo reconocible.
 */
export const preferStepwise: MelodyConstraint = {
  name: 'grado-conjunto',
  score: (candidate, { previous }) => {
    if (!previous) return 1;
    const leap = Math.abs(candidate.midi - previous.midi);
    if (leap === 0) return 0.3;
    if (leap <= 2) return 3;
    if (leap <= 4) return 1.6;
    if (leap <= 7) return 0.9;
    if (leap <= 9) return 0.4;
    if (leap === 12) return 0.3;
    return 0.05;
  },
};

/**
 * Tras un salto, la melodia vuelve por grado conjunto en sentido contrario.
 *
 * Es la regla que evita las melodias en zigzag: un salto abre un hueco y el
 * oido espera que se rellene. Sin esto, un generador encadena saltos y produce
 * lineas que ningun instrumentista frasearia.
 */
export const resolveLeaps: MelodyConstraint = {
  name: 'resolucion-de-salto',
  score: (candidate, { previous, beforePrevious }) => {
    if (!previous || !beforePrevious) return 1;

    const lastLeap = previous.midi - beforePrevious.midi;
    if (Math.abs(lastLeap) < 5) return 1;

    const nextStep = candidate.midi - previous.midi;
    const isOpposite = Math.sign(nextStep) === -Math.sign(lastLeap);
    const isStep = Math.abs(nextStep) <= 2;

    if (isOpposite && isStep) return 3;
    if (isOpposite) return 1.2;
    // Seguir saltando en la misma direccion despues de un salto grande.
    return Math.abs(nextStep) > 4 ? 0.15 : 0.7;
  },
};

/** Evita repetir la misma altura una y otra vez. */
export const avoidRepetition: MelodyConstraint = {
  name: 'sin-repeticion',
  score: (candidate, { history }) => {
    const recent = history.slice(0, 4);
    const repeats = recent.filter((pitch) => pitch.midi === candidate.midi).length;
    if (repeats === 0) return 1;
    return 1 / (1 + repeats * 2);
  },
};

/**
 * Lleva la melodia hacia donde marca el contorno.
 *
 * Actua sobre la DIRECCION, no solo sobre la cercania. Una version que solo
 * premiara estar cerca del objetivo no funcionaba: como el grado conjunto
 * puntua alto, todos los pasos cortos empataban y la linea divagaba por el
 * centro del rango. Premiando el paso que ACERCA al objetivo, el contorno
 * decide entre subir y bajar sin pelearse con la preferencia por el grado
 * conjunto, que sigue decidiendo el tamano del paso.
 */
export const followContour: MelodyConstraint = {
  name: 'contorno',
  score: (candidate, { target, previous }) => {
    if (!target) return 1;

    const proximity = 1 + 1.5 / (1 + Math.abs(candidate.midi - target.midi) / 3);
    if (!previous) return proximity;

    const before = Math.abs(previous.midi - target.midi);
    const after = Math.abs(candidate.midi - target.midi);
    // Ya se esta donde toca: quedarse cerca vale tanto como acercarse.
    if (before <= 1) return proximity;

    const direction = after < before ? 2.2 : after > before ? 0.45 : 1;
    return proximity * direction;
  },
};

/**
 * Evita los intervalos aumentados, muy dificiles de entonar.
 * La segunda aumentada de la menor armonica es el caso tipico.
 */
export const avoidAugmentedIntervals: MelodyConstraint = {
  name: 'sin-intervalos-aumentados',
  score: (candidate, { previous }) => {
    if (!previous) return 1;
    const interval = previous.intervalTo(candidate);
    if (!interval.quality.startsWith('A')) return 1;
    return Math.abs(interval.chromatic) > 2 ? 0.05 : 1;
  },
};

/**
 * La frase termina en una nota estable, mejor en la tonica.
 *
 * Se apoya en `isLast`, no en un umbral sobre el progreso. Con umbral no
 * funcionaba: una redonda final empieza en el 87% de una frase de ocho, nunca
 * llegaba al 92% y la regla no llegaba a aplicarse. Saber cual es la ultima
 * nota es un dato exacto y no depende de la duracion que le toque.
 */
export const closeOnStableTone: MelodyConstraint = {
  name: 'cierre-estable',
  score: (candidate, { isLast, progress, chord, scale }) => {
    if (!isLast && progress < 0.9) return 1;

    const weight = isLast ? 1 : 0.4;
    if (candidate.pitchClass === scale.tonic.pitchClass) return 1 + 5 * weight;
    if (chord?.contains(candidate)) return 1 + 2 * weight;
    const degree = scale.degreeOf(candidate);
    if (degree === 3 || degree === 5) return 1 + 1.5 * weight;
    return isLast ? 0.15 : 0.6;
  },
};

/** Conjunto por defecto, en el orden en que se leen mejor. */
export const DEFAULT_CONSTRAINTS: readonly MelodyConstraint[] = [
  withinRange,
  chordToneOnStrongBeat,
  preferStepwise,
  resolveLeaps,
  avoidRepetition,
  followContour,
  avoidAugmentedIntervals,
  closeOnStableTone,
];

export interface ScoredCandidate {
  readonly pitch: Pitch;
  readonly weight: number;
  /** Puntuacion de cada restriccion, para poder explicar la eleccion. */
  readonly breakdown: Readonly<Record<string, number>>;
}

/**
 * Puntua todos los candidatos multiplicando las restricciones.
 *
 * Se devuelve tambien el desglose porque un generador que no sabe explicar por
 * que eligio una nota es imposible de ajustar: cuando la melodia sale mal, hay
 * que poder ver que restriccion la empujo ahi.
 */
export function scoreCandidates(
  candidates: readonly Pitch[],
  context: MelodyContext,
  constraints: readonly MelodyConstraint[] = DEFAULT_CONSTRAINTS,
): ScoredCandidate[] {
  const scored: ScoredCandidate[] = [];

  for (const pitch of candidates) {
    const breakdown: Record<string, number> = {};
    let weight = 1;

    for (const constraint of constraints) {
      const value = constraint.score(pitch, context);
      breakdown[constraint.name] = value;
      weight *= value;
      if (weight === 0) break;
    }

    if (weight > 0) scored.push({ pitch, weight, breakdown });
  }

  return scored;
}
