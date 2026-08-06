import type { RawNote } from '@sinfo/perform';
import type { PitchPoint } from './yin.js';

/**
 * De curva de tono a notas.
 *
 * El detector entrega una altura cada pocos milisegundos; una partitura
 * necesita notas con principio y final. Traducir lo uno en lo otro es decidir
 * donde acaba una nota y empieza la siguiente, y hay tres formas de que eso
 * ocurra: que el sonido se calle, que la altura salte, o que el interprete
 * vuelva a atacar la MISMA nota.
 *
 * El tercer caso es el que se olvida siempre. Sin detectar el reataque, dos
 * negras repetidas del mismo tono salen como una blanca, y el ritmo se
 * desmorona a partir de ahi.
 */

export interface SegmentOptions {
  /** Periodicidad minima para dar por buena una ventana. */
  readonly minConfidence?: number | undefined;
  /** Duracion minima de una nota, en segundos. Por debajo, se descarta. */
  readonly minDurationSeconds?: number | undefined;
  /**
   * Cuanto puede alejarse una ventana de la altura de la nota, en semitonos,
   * antes de considerarse otra nota. Holgado a proposito: un vibrato de opera
   * pasa del semitono y sigue siendo una sola nota.
   */
  readonly pitchTolerance?: number | undefined;
  /**
   * Cuanto tiene que subir el nivel de golpe para leerse como un reataque.
   * Es una razon, no una diferencia: 1.8 significa casi el doble de golpe.
   */
  readonly onsetRise?: number | undefined;
}

const DEFAULTS = {
  minConfidence: 0.5,
  minDurationSeconds: 0.05,
  pitchTolerance: 0.7,
  onsetRise: 1.8,
} as const;

export function segmentNotes(
  points: readonly PitchPoint[],
  options: SegmentOptions = {},
): RawNote[] {
  const minConfidence = options.minConfidence ?? DEFAULTS.minConfidence;
  const minDuration = options.minDurationSeconds ?? DEFAULTS.minDurationSeconds;
  const tolerance = options.pitchTolerance ?? DEFAULTS.pitchTolerance;
  const onsetRise = options.onsetRise ?? DEFAULTS.onsetRise;

  if (points.length < 2) return [];
  const step = estimateStep(points);

  const notes: RawNote[] = [];
  let current: PitchPoint[] = [];

  const flush = (endTime: number): void => {
    const note = toNote(current, endTime, minDuration, peakLevel(points));
    if (note !== null) notes.push(note);
    current = [];
  };

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (point === undefined) continue;

    const voiced =
      point.frequency !== null && point.frequency > 0 && point.confidence >= minConfidence;
    if (!voiced) {
      if (current.length > 0) flush(point.time);
      continue;
    }

    const midi = frequencyToMidi(point.frequency ?? 440);
    if (current.length === 0) {
      current.push(point);
      continue;
    }

    const reference = medianMidi(current);
    const jumped = Math.abs(midi - reference) > tolerance;
    const reattacked = isReattack(points, i, onsetRise);

    if (jumped || reattacked) {
      flush(point.time);
    }
    current.push(point);
  }

  if (current.length > 0) {
    const last = points[points.length - 1];
    flush((last?.time ?? 0) + step);
  }

  return notes;
}

// --------------------------------------------------------------- interiores

/** Semitonos MIDI a partir de la frecuencia, con la4 = 440 = 69. */
export function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

/**
 * Reataque: el nivel sube de golpe respecto a las ventanas anteriores.
 *
 * Se compara con el minimo reciente y no con la ventana justo anterior porque
 * el ataque de una nota dura varias ventanas: mirando solo la contigua, la
 * subida queda repartida y nunca llega a superar el umbral.
 */
function isReattack(points: readonly PitchPoint[], index: number, rise: number): boolean {
  const current = points[index]?.level ?? 0;
  if (index < 3 || current <= 0) return false;

  let recentMinimum = Number.POSITIVE_INFINITY;
  for (let i = Math.max(0, index - 3); i < index; i += 1) {
    recentMinimum = Math.min(recentMinimum, points[i]?.level ?? 0);
  }
  if (!Number.isFinite(recentMinimum) || recentMinimum <= 0) return false;

  return current / recentMinimum >= rise;
}

/**
 * Altura de la nota por MEDIANA de sus ventanas.
 *
 * La media se la lleva cualquier ventana suelta mal medida, y sobre todo el
 * portamento de entrada: casi todos los instrumentos y voces llegan a la nota
 * desde abajo, y promediar ese barrido deja la nota calada.
 */
function medianMidi(points: readonly PitchPoint[]): number {
  const values = points
    .map((point) => (point.frequency === null ? null : frequencyToMidi(point.frequency)))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (values.length === 0) return 60;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2
    : (values[middle] ?? 0);
}

function toNote(
  points: readonly PitchPoint[],
  endTime: number,
  minDuration: number,
  peak: number,
): RawNote | null {
  const first = points[0];
  if (first === undefined) return null;

  const onset = first.time;
  if (endTime - onset < minDuration) return null;

  const level = Math.max(...points.map((point) => point.level));
  return {
    onset,
    offset: endTime,
    midi: medianMidi(points),
    velocity: levelToVelocity(level, peak),
    confidence: points.reduce((sum, point) => sum + point.confidence, 0) / points.length,
  };
}

/**
 * Nivel eficaz a velocity MIDI, en decibelios.
 *
 * En escala lineal casi todo se amontona abajo, porque el oido es
 * logaritmico: un pasaje entero saldria entre 10 y 30 de velocity. Con 40 dB
 * de recorrido, un piano y un forte quedan donde deben.
 */
function levelToVelocity(level: number, peak: number): number {
  if (level <= 0 || peak <= 0) return 64;
  const decibels = 20 * Math.log10(level / peak);
  const normalized = Math.max(0, Math.min(1, (decibels + 40) / 40));
  return Math.max(1, Math.min(127, Math.round(1 + normalized * 126)));
}

function peakLevel(points: readonly PitchPoint[]): number {
  let peak = 0;
  for (const point of points) peak = Math.max(peak, point.level);
  return peak;
}

/** Separacion tipica entre ventanas, para cerrar la ultima nota. */
function estimateStep(points: readonly PitchPoint[]): number {
  const first = points[0]?.time ?? 0;
  const second = points[1]?.time ?? 0;
  const step = second - first;
  return step > 0 ? step : 0.01;
}
