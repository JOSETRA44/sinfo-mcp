import { KeySignature, Pitch } from '@sinfo/core';

/**
 * Estimacion de tonalidad por perfiles de Krumhansl-Schmuckler.
 *
 * La idea, que es de 1990 y sigue siendo competitiva: cada tonalidad tiene un
 * reparto caracteristico de las doce clases de altura —en do mayor suena mucho
 * do, bastante sol, poquisimo fa sostenido—. Se cuenta lo que hay y se compara
 * con las veinticuatro plantillas.
 *
 * Se pondera por DURACION y no por numero de notas. Una nota de adorno y una
 * redonda no dicen lo mismo sobre la tonalidad, y contar cabezas hace que un
 * pasaje cromatico rapido pese mas que la nota tenida que lo resuelve.
 */

/**
 * Perfiles de Albrecht y Shanahan (2013), no los originales de Krumhansl.
 *
 * Los de Krumhansl salieron de experimentos de percepcion con oyentes y
 * reparten demasiado peso entre notas ajenas a la escala. En concreto dan al
 * segundo grado rebajado un valor apreciable en modo menor, y eso hace que una
 * melodia en do mayor con fa naturales se confunda con mi menor, donde ese fa
 * deberia chirriar. Los de Albrecht y Shanahan estan derivados de un corpus
 * grande de musica real y dejan las notas extranas practicamente en cero, que
 * es lo que hace falta para distinguir tonalidades vecinas.
 */
const MAJOR_PROFILE = [
  0.238, 0.006, 0.111, 0.006, 0.137, 0.094, 0.016, 0.214, 0.009, 0.08, 0.008, 0.081,
] as const;

const MINOR_PROFILE = [
  0.22, 0.006, 0.104, 0.123, 0.019, 0.103, 0.012, 0.214, 0.062, 0.022, 0.061, 0.052,
] as const;

/** Tonicas por clase de altura, escritas como las escribiria un musico. */
const MAJOR_TONICS = [
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B',
] as const;

const MINOR_TONICS = [
  'C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B',
] as const;

export interface WeightedPitch {
  /** Altura MIDI. Solo importa su clase. */
  readonly midi: number;
  /** Cuanto pesa: normalmente la duracion en pulsos. */
  readonly weight: number;
}

export interface KeyEstimate {
  readonly key: KeySignature;
  /**
   * Correlacion con el perfil ganador, -1..1.
   *
   * Por debajo de 0,5 la estimacion es floja: musica muy cromatica, atonal, o
   * simplemente pocas notas. Conviene mirarlo antes de fiarse de la armadura.
   */
  readonly correlation: number;
  /** Margen sobre la segunda mejor candidata. Poco margen, decision fragil. */
  readonly margin: number;
}

/** Reparto de peso entre las doce clases de altura. */
export function pitchClassProfile(notes: readonly WeightedPitch[]): number[] {
  const profile = new Array<number>(12).fill(0);
  for (const note of notes) {
    const index = ((Math.round(note.midi) % 12) + 12) % 12;
    profile[index] = (profile[index] ?? 0) + Math.max(0, note.weight);
  }
  return profile;
}

/**
 * Tonalidad mas probable.
 *
 * Sin notas devuelve do mayor con correlacion cero: es el valor por defecto
 * del resto del sistema y no merece un error, porque una pista vacia es un
 * caso normal, no un fallo.
 */
export function estimateKey(notes: readonly WeightedPitch[]): KeyEstimate {
  const profile = pitchClassProfile(notes);
  const total = profile.reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return { key: KeySignature.of(Pitch.parse('C4'), 'major'), correlation: 0, margin: 0 };
  }

  const scored: { key: KeySignature; score: number }[] = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    scored.push({
      key: KeySignature.of(Pitch.parse(`${MAJOR_TONICS[tonic] ?? 'C'}4`), 'major'),
      score: correlate(rotate(profile, tonic), MAJOR_PROFILE),
    });
    scored.push({
      key: KeySignature.of(Pitch.parse(`${MINOR_TONICS[tonic] ?? 'C'}4`), 'minor'),
      score: correlate(rotate(profile, tonic), MINOR_PROFILE),
    });
  }
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];
  if (best === undefined) {
    return { key: KeySignature.of(Pitch.parse('C4'), 'major'), correlation: 0, margin: 0 };
  }
  return {
    key: best.key,
    correlation: best.score,
    margin: best.score - (second?.score ?? 0),
  };
}

// --------------------------------------------------------------- interiores

/** Gira el perfil para que `tonic` quede en la posicion cero. */
function rotate(profile: readonly number[], tonic: number): number[] {
  return Array.from({ length: 12 }, (_, i) => profile[(i + tonic) % 12] ?? 0);
}

/** Correlacion de Pearson. Devuelve 0 si alguna serie es constante. */
function correlate(observed: readonly number[], expected: readonly number[]): number {
  const n = observed.length;
  const meanObserved = observed.reduce((sum, v) => sum + v, 0) / n;
  const meanExpected = expected.reduce((sum, v) => sum + v, 0) / n;

  let covariance = 0;
  let varianceObserved = 0;
  let varianceExpected = 0;
  for (let i = 0; i < n; i += 1) {
    const a = (observed[i] ?? 0) - meanObserved;
    const b = (expected[i] ?? 0) - meanExpected;
    covariance += a * b;
    varianceObserved += a * a;
    varianceExpected += b * b;
  }
  const denominator = Math.sqrt(varianceObserved * varianceExpected);
  return denominator === 0 ? 0 : covariance / denominator;
}
