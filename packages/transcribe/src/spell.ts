import { type KeySignature, Pitch } from '@sinfo/core';

/**
 * Ortografia de alteraciones: de numero MIDI a altura escrita.
 *
 * Un transcriptor devuelve 61. Eso puede ser do sostenido o re bemol, y la
 * diferencia no es cosmetica: elegir mal convierte una sensible en una novena
 * bemol y hace ilegible el analisis armonico posterior.
 *
 * Casi todos los correctores del mundo —ps13, Temperley— deciden mirando solo
 * la sucesion de alturas. Nosotros tenemos la tonalidad, asi que podemos hacer
 * lo que hace un musico: situar la nota en el circulo de quintas y quedarnos
 * con la grafia mas cercana al centro tonal.
 */

/** Posicion de cada grado en el circulo de quintas, con do en el origen. */
const STEP_FIFTHS: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: -1,
  G: 1,
  A: 3,
  B: 5,
};

/** Semitonos sobre do de cada grado sin alterar. */
const STEP_SEMITONE: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

/** Alteraciones que se consideran. Mas alla de dos, la grafia deja de ayudar. */
const ALTERS = [-2, -1, 0, 1, 2] as const;

/** Cuanto castiga una doble alteracion frente a una simple. */
const DOUBLE_ACCIDENTAL_PENALTY = 3;

/**
 * Cuando dos grafias quedan asi de igualadas, decide el movimiento melodico.
 * Una quinta de diferencia es el margen tipico entre las dos candidatas de una
 * nota cromatica, asi que el umbral tiene que ser holgado para llegar a actuar.
 */
const TIE_MARGIN = 1.01;

/** Direccion hacia la nota siguiente. */
export type MelodicDirection = 1 | 0 | -1;

/**
 * Centro tonal en el circulo de quintas: la media de las notas que la
 * tonalidad da por propias.
 *
 * No vale usar la tonica. En do mayor la tonica esta en 0, y fa sostenido (6)
 * y sol bemol (-6) quedarian a la misma distancia: empate perpetuo en todas
 * las notas cromaticas. El conjunto diatonico va de -1 a 5, asi que su centro
 * real es 2, y desde ahi fa sostenido gana como debe.
 *
 * En modo menor entra ademas la sensible alterada —sol sostenido en la
 * menor—, que desplaza el centro hacia el lado de los sostenidos. Sin ella,
 * la sensible de cualquier pieza en menor se escribiria como bemol.
 */
export function tonalCenter(key: KeySignature): number {
  const diatonic: number[] = [];
  for (let i = -1; i <= 5; i += 1) diatonic.push(key.fifths + i);
  if (key.mode === 'minor') diatonic.push(key.fifths + 8);
  return diatonic.reduce((sum, value) => sum + value, 0) / diatonic.length;
}

/**
 * Escribe una altura MIDI segun la tonalidad.
 *
 * `direction` desempata las notas cromaticas por el camino que lleva la
 * melodia, que es la regla que usan los musicos: lo que sube se escribe con
 * sostenido y lo que baja con bemol. Un sol sostenido que resuelve en la y un
 * la bemol que cae a sol son la misma tecla y distinta nota.
 */
export function spellPitch(midi: number, key: KeySignature, direction: MelodicDirection = 0): Pitch {
  const rounded = Math.round(midi);
  const pitchClass = ((rounded % 12) + 12) % 12;
  const center = tonalCenter(key);

  const candidates: { pitch: Pitch; fifths: number; cost: number }[] = [];
  for (const step of STEPS) {
    const semitone = STEP_SEMITONE[step] ?? 0;
    for (const alter of ALTERS) {
      if ((((semitone + alter) % 12) + 12) % 12 !== pitchClass) continue;
      const octave = (rounded - semitone - alter) / 12 - 1;
      if (!Number.isInteger(octave)) continue;
      const fifths = (STEP_FIFTHS[step] ?? 0) + 7 * alter;
      candidates.push({
        pitch: Pitch.of(step, alter, octave),
        fifths,
        cost: Math.abs(fifths - center) + (Math.abs(alter) >= 2 ? DOUBLE_ACCIDENTAL_PENALTY : 0),
      });
    }
  }

  candidates.sort((a, b) => a.cost - b.cost);
  const best = candidates[0];
  if (best === undefined) {
    // Toda clase de altura tiene al menos una grafia con alteracion simple,
    // asi que esto no deberia ocurrir; la reserva evita propagar undefined.
    return Pitch.fromMidi(rounded);
  }

  const runnerUp = candidates[1];
  if (direction !== 0 && runnerUp !== undefined && runnerUp.cost - best.cost < TIE_MARGIN) {
    // Subiendo gana el lado de los sostenidos (mas quintas); bajando, el de
    // los bemoles. Es la unica pista fiable cuando la tonalidad no decide.
    const preferred = direction > 0
      ? (best.fifths >= runnerUp.fifths ? best : runnerUp)
      : (best.fifths <= runnerUp.fifths ? best : runnerUp);
    return preferred.pitch;
  }
  return best.pitch;
}

/**
 * Escribe una secuencia deduciendo la direccion de cada nota por la siguiente.
 *
 * Se mira la nota posterior y no la anterior porque lo que define a una
 * alteracion cromatica es hacia donde resuelve, no de donde viene.
 */
export function spellSequence(midis: readonly number[], key: KeySignature): Pitch[] {
  return midis.map((midi, index) => {
    const next = midis[index + 1];
    const direction: MelodicDirection =
      next === undefined || Math.round(next) === Math.round(midi)
        ? 0
        : next > midi
          ? 1
          : -1;
    return spellPitch(midi, key, direction);
  });
}
