import type { AudioClip } from '@sinfo/perform';
import { autocorrelation, nextPowerOfTwo } from './fft.js';

/**
 * Deteccion de tono por el metodo YIN (de Cheveigne y Kawahara, 2002).
 *
 * Es un detector MONOFONICO: da una altura por instante. Con una voz, un saxo,
 * una flauta o un bajo funciona muy bien; con un acorde de piano devuelve una
 * sola nota, normalmente la mas grave, y no es que falle sino que no es lo que
 * hace. La polifonia necesita un modelo entrenado.
 *
 * Se eligio frente a la autocorrelacion pelada porque resuelve el error
 * clasico de esta: confundir el tono con su octava grave. La normalizacion
 * acumulada de YIN es lo que quita ese sesgo, y una octava mal detectada no es
 * un detalle —convierte la transcripcion en otra obra—.
 */

export interface PitchPoint {
  /** Instante del centro de la ventana, en segundos. */
  readonly time: number;
  /** Frecuencia fundamental en hercios, o null si no hay tono claro. */
  readonly frequency: number | null;
  /** Periodicidad 0..1. Cuanto mas alta, mas fiable la lectura. */
  readonly confidence: number;
  /** Nivel eficaz de la ventana, para distinguir silencio de ruido con tono. */
  readonly level: number;
}

export interface YinOptions {
  /** Frecuencia mas grave que se busca. 65 Hz es un do2, un bajo comodo. */
  readonly minFrequency?: number | undefined;
  /** Frecuencia mas aguda. 2000 Hz cubre hasta la punta de un violin. */
  readonly maxFrequency?: number | undefined;
  /**
   * Umbral de aperiodicidad. Por debajo de el, una ventana se da por tonal.
   * 0,15 es el valor del articulo original y funciona bien; subirlo detecta
   * mas notas a costa de inventarse alguna en el ruido.
   */
  readonly threshold?: number | undefined;
  /** Salto entre ventanas en muestras. Menor da mas resolucion y mas coste. */
  readonly hop?: number | undefined;
  /** Nivel eficaz por debajo del cual la ventana se considera silencio. */
  readonly silenceLevel?: number | undefined;
}

const DEFAULTS = {
  minFrequency: 65,
  maxFrequency: 2000,
  threshold: 0.15,
  silenceLevel: 0.005,
} as const;

export function detectPitch(clip: AudioClip, options: YinOptions = {}): PitchPoint[] {
  const minFrequency = options.minFrequency ?? DEFAULTS.minFrequency;
  const maxFrequency = options.maxFrequency ?? DEFAULTS.maxFrequency;
  const threshold = options.threshold ?? DEFAULTS.threshold;
  const silenceLevel = options.silenceLevel ?? DEFAULTS.silenceLevel;

  const { samples, sampleRate } = clip;
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const tauMax = Math.min(
    Math.ceil(sampleRate / minFrequency),
    Math.floor(samples.length / 2) || 2,
  );
  if (tauMax <= tauMin || samples.length === 0) return [];

  // La ventana necesita al menos dos periodos de la nota mas grave que se
  // busca; con menos, esa nota no cabe entera y el detector no puede verla.
  const window = nextPowerOfTwo(tauMax * 2);
  if (window > samples.length) return [];
  const hop = options.hop ?? Math.max(64, Math.floor(window / 8));

  const points: PitchPoint[] = [];
  const frame = new Float64Array(window);

  for (let start = 0; start + window <= samples.length; start += hop) {
    let energy = 0;
    for (let i = 0; i < window; i += 1) {
      const value = samples[start + i] ?? 0;
      frame[i] = value;
      energy += value * value;
    }
    const level = Math.sqrt(energy / window);
    const time = (start + window / 2) / sampleRate;

    if (level < silenceLevel) {
      points.push({ time, frequency: null, confidence: 0, level });
      continue;
    }

    const estimate = estimateFrame(frame, tauMin, tauMax, threshold);
    points.push({
      time,
      frequency: estimate.tau === null ? null : sampleRate / estimate.tau,
      confidence: estimate.confidence,
      level,
    });
  }

  return points;
}

// --------------------------------------------------------------- interiores

interface FrameEstimate {
  readonly tau: number | null;
  readonly confidence: number;
}

function estimateFrame(
  frame: Float64Array,
  tauMin: number,
  tauMax: number,
  threshold: number,
): FrameEstimate {
  const window = frame.length;
  const correlation = autocorrelation(frame);

  // Sumas acumuladas de cuadrados: permiten obtener la funcion de diferencia
  // a partir de la autocorrelacion sin volver a recorrer la ventana.
  const power = new Float64Array(window + 1);
  for (let i = 0; i < window; i += 1) {
    const value = frame[i] ?? 0;
    power[i + 1] = (power[i] ?? 0) + value * value;
  }

  const difference = new Float64Array(tauMax + 1);
  for (let tau = 0; tau <= tauMax; tau += 1) {
    const head = (power[window - tau] ?? 0) - (power[0] ?? 0);
    const tail = (power[window] ?? 0) - (power[tau] ?? 0);
    difference[tau] = head + tail - 2 * (correlation[tau] ?? 0);
  }

  // Diferencia media normalizada acumulada: es el paso que quita el sesgo
  // hacia la octava grave, porque compara cada desplazamiento con la media de
  // los anteriores en vez de con un cero absoluto.
  const normalized = new Float64Array(tauMax + 1);
  normalized[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau += 1) {
    running += difference[tau] ?? 0;
    normalized[tau] = running === 0 ? 1 : ((difference[tau] ?? 0) * tau) / running;
  }

  // Primer valle por debajo del umbral, no el minimo global: el minimo global
  // suele caer en un multiplo del periodo real, y quedarse con el primero es
  // lo que evita detectar la octava equivocada.
  let chosen = -1;
  for (let tau = tauMin; tau <= tauMax; tau += 1) {
    if ((normalized[tau] ?? 1) < threshold) {
      while (tau + 1 <= tauMax && (normalized[tau + 1] ?? 1) < (normalized[tau] ?? 1)) tau += 1;
      chosen = tau;
      break;
    }
  }

  if (chosen === -1) {
    // Sin valle claro no hay tono, pero se informa de lo cerca que estuvo:
    // el segmentador usa la confianza para descartar tramos dudosos.
    let best = 1;
    for (let tau = tauMin; tau <= tauMax; tau += 1) best = Math.min(best, normalized[tau] ?? 1);
    return { tau: null, confidence: Math.max(0, 1 - best) };
  }

  return {
    tau: refine(normalized, chosen, tauMax),
    confidence: Math.min(1, Math.max(0, 1 - (normalized[chosen] ?? 1))),
  };
}

/**
 * Interpolacion parabolica alrededor del valle.
 *
 * Sin esto la frecuencia solo puede tomar los valores sampleRate/entero, y en
 * el registro agudo esos escalones llegan a medir mas de un semitono: un la4
 * saldria desafinado por el redondeo del periodo, no por el interprete.
 */
function refine(normalized: Float64Array, tau: number, tauMax: number): number {
  if (tau <= 0 || tau >= tauMax) return tau;
  const previous = normalized[tau - 1] ?? 0;
  const current = normalized[tau] ?? 0;
  const next = normalized[tau + 1] ?? 0;
  const denominator = 2 * (2 * current - next - previous);
  if (denominator === 0) return tau;
  const shift = (next - previous) / denominator;
  return Math.abs(shift) < 1 ? tau + shift : tau;
}
