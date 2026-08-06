import {
  Duration,
  note,
  parseDurationToken,
  Pitch,
  rest,
  sumDurations,
  type MusicalEvent,
} from '@sinfo/core';
import type { Chord, Scale } from '@sinfo/theory';
import {
  DEFAULT_CONSTRAINTS,
  scoreCandidates,
  type MelodyConstraint,
  type MelodyContext,
} from './constraints.js';
import { Motif } from './motif.js';
import { Random } from './random.js';

/**
 * Generacion de melodia sobre una armonia.
 *
 * El algoritmo es un paseo restringido: en cada paso se listan las alturas
 * posibles, se puntuan con las restricciones y se elige una al azar segun esos
 * pesos. No es lo mas sofisticado que existe, pero tiene dos virtudes que
 * importan mas aqui: es explicable (se puede ver por que salio cada nota) y es
 * extensible (una regla nueva es una funcion mas).
 */

export type ContourShape = 'arch' | 'inverted-arch' | 'ascending' | 'descending' | 'wave' | 'flat';

export interface MelodyOptions {
  readonly scale: Scale;
  /** Acordes por unidad armonica, en orden. */
  readonly chords?: readonly Chord[] | undefined;
  /** Cuanto dura cada acorde. Por defecto, un compas de 4/4. */
  readonly chordDuration?: Duration | undefined;
  readonly lowest: Pitch;
  readonly highest: Pitch;
  readonly totalDuration: Duration;
  readonly contour?: ContourShape | undefined;
  /** Figuras disponibles como tokens de SinfoScript. */
  readonly rhythm?: readonly string[] | undefined;
  /** Probabilidad de que una figura sea silencio, de 0 a 1. */
  readonly restProbability?: number | undefined;
  /** Duracion del pulso, para saber que es tiempo fuerte. */
  readonly beatUnit?: Duration | undefined;
  readonly constraints?: readonly MelodyConstraint[] | undefined;
  readonly seed?: string | undefined;
  /** Altura de arranque. Si falta, la elige el generador. */
  readonly startPitch?: Pitch | undefined;
}

export interface MelodyDecision {
  readonly index: number;
  readonly pitch: string;
  readonly chord: string | null;
  readonly strongBeat: boolean;
  /** Cuantas alturas pasaron el filtro de restricciones. */
  readonly alternatives: number;
}

export interface MelodyResult {
  readonly motif: Motif;
  readonly seed: string;
  readonly notation: string;
  /** Por que se eligio cada nota, para poder ajustar el resultado. */
  readonly decisions: readonly MelodyDecision[];
}

const DEFAULT_RHYTHM = ['q', 'q', 'q', 'e', 'e', 'h'] as const;

export function generateMelody(options: MelodyOptions): MelodyResult {
  const seed = options.seed ?? 'melodia';
  const random = new Random(seed);
  // Ritmo y altura consumen flujos SEPARADOS: cambiar el algoritmo de alturas
  // no debe alterar el ritmo que ya se habia elegido.
  const rhythmRandom = random.fork('ritmo');
  const pitchRandom = random.fork('alturas');

  const beatUnit = options.beatUnit ?? Duration.QUARTER;
  const chordDuration = options.chordDuration ?? Duration.WHOLE;
  const durations = buildRhythm(rhythmRandom, options, beatUnit);

  const candidates = options.scale.between(options.lowest, options.highest);
  if (candidates.length === 0) {
    throw new Error(
      `La escala ${options.scale.name} no tiene ninguna nota entre ` +
        `${options.lowest.name} y ${options.highest.name}`,
    );
  }

  const events: MusicalEvent[] = [];
  const decisions: MelodyDecision[] = [];
  const history: Pitch[] = [];

  let position = Duration.ZERO;
  let previous: Pitch | null = options.startPitch ?? null;
  let beforePrevious: Pitch | null = null;

  for (const [index, duration] of durations.entries()) {
    if (options.restProbability !== undefined && rhythmRandom.bool(options.restProbability)) {
      events.push(rest(duration));
      position = position.plus(duration);
      continue;
    }

    const progress = position.value / Math.max(options.totalDuration.value, 1e-9);
    const context: MelodyContext = {
      scale: options.scale,
      chord: chordAt(options.chords, position, chordDuration),
      previous,
      beforePrevious,
      history,
      lowest: options.lowest,
      highest: options.highest,
      isStrongBeat: isStrongBeat(position, beatUnit),
      progress,
      isLast: index === durations.length - 1,
      target: contourTarget(options, progress),
      duration,
    };

    const scored = scoreCandidates(
      candidates,
      context,
      options.constraints ?? DEFAULT_CONSTRAINTS,
    );

    // Ninguna altura pasa el filtro: se relaja a solo el rango antes que
    // fallar. Una melodia imperfecta es util; una excepcion, no.
    const usable =
      scored.length > 0
        ? scored
        : candidates.map((pitch) => ({ pitch, weight: 1, breakdown: {} }));

    const chosen = pitchRandom.weighted(
      usable.map((entry) => ({ value: entry.pitch, weight: entry.weight })),
    );

    events.push(note(chosen, duration));
    decisions.push({
      index,
      pitch: chosen.name,
      chord: context.chord?.symbol ?? null,
      strongBeat: context.isStrongBeat,
      alternatives: usable.length,
    });

    beforePrevious = previous;
    previous = chosen;
    history.unshift(chosen);
    position = position.plus(duration);
  }

  const motif = Motif.of(events, [`melodia generada con semilla "${seed}"`]);
  return { motif, seed, notation: motif.notation, decisions };
}

/**
 * Reparte la duracion total en figuras.
 *
 * La ultima se recorta para cuadrar exactamente con el total: es preferible
 * una figura algo distinta de la elegida a que la frase se pase de largo y
 * descuadre los compases siguientes.
 */
function buildRhythm(
  random: Random,
  options: MelodyOptions,
  beatUnit: Duration,
): Duration[] {
  const pool = (options.rhythm ?? DEFAULT_RHYTHM).map((token) => parseDurationToken(token));
  if (pool.length === 0) return [options.totalDuration];

  const durations: Duration[] = [];
  let remaining = options.totalDuration;

  for (let guard = 0; guard < 10_000 && remaining.greaterThan(Duration.ZERO); guard++) {
    const candidates = pool.filter((duration) => !duration.greaterThan(remaining));
    if (candidates.length === 0) {
      durations.push(remaining);
      break;
    }
    const chosen = random.pick(candidates);
    durations.push(chosen);
    remaining = remaining.minus(chosen);
  }

  return durations.length > 0 ? durations : [beatUnit];
}

/** Acorde vigente en esa posicion, si hay progresion. */
function chordAt(
  chords: readonly Chord[] | undefined,
  position: Duration,
  chordDuration: Duration,
): Chord | null {
  if (!chords || chords.length === 0) return null;
  const index = Math.floor(position.value / chordDuration.value);
  return chords[Math.min(index, chords.length - 1)] ?? null;
}

/**
 * Tiempo fuerte: la posicion cae en un multiplo entero del pulso.
 *
 * Aproximacion suficiente y barata. Distinguir primer tiempo de tercero
 * exigiria conocer el compas, y el generador trabaja sobre frases que pueden
 * no empezar en barra.
 */
function isStrongBeat(position: Duration, beatUnit: Duration): boolean {
  const beats = position.value / beatUnit.value;
  return Math.abs(beats - Math.round(beats)) < 1e-9;
}

/**
 * Altura hacia la que tiende la melodia en cada punto de la frase.
 *
 * El contorno es lo que convierte una sucesion de notas correctas en una
 * FRASE: sin el, el paseo restringido divaga por el centro del rango y todas
 * las melodias suenan igual de planas.
 */
function contourTarget(options: MelodyOptions, progress: number): Pitch | null {
  const shape = options.contour;
  if (!shape || shape === 'flat') return null;

  const low = options.lowest.midi;
  const high = options.highest.midi;
  const span = high - low;

  const height = ((): number => {
    switch (shape) {
      case 'arch':
        return Math.sin(progress * Math.PI);
      case 'inverted-arch':
        return 1 - Math.sin(progress * Math.PI);
      case 'ascending':
        return progress;
      case 'descending':
        return 1 - progress;
      case 'wave':
        return 0.5 + 0.5 * Math.sin(progress * Math.PI * 4);
      default:
        return 0.5;
    }
  })();

  // Se usa el tercio central del rango como zona de trabajo: apuntar a los
  // extremos empujaria la melodia contra los limites del instrumento.
  const midi = Math.round(low + span * 0.2 + height * span * 0.6);
  return Pitch.fromMidi(Math.max(0, Math.min(127, midi)));
}

/** Duracion total de una lista de eventos. Util para comprobar cuadres. */
export function totalDurationOf(events: readonly MusicalEvent[]): Duration {
  return sumDurations(events.map((event) => event.duration));
}
