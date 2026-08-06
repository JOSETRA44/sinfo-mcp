import { invalid } from '@sinfo/core';

/**
 * Audio en bruto: muestras y frecuencia de muestreo. Nada mas.
 *
 * Siempre MONO. La estereofonia es informacion de mezcla, no de altura, y
 * arrastrarla por toda la cadena obligaria a cada analizador a decidir que
 * hace con ella. Se remezcla una vez, al decodificar, y se acabo.
 *
 * Vive en este paquete y no en el adaptador porque los puertos de entrada que
 * declara `@sinfo/engine` necesitan nombrar este tipo, y engine no puede mirar
 * hacia afuera.
 */
export interface AudioClip {
  /** Muestras normalizadas a -1..1. */
  readonly samples: Float32Array;
  readonly sampleRate: number;
  /** Nombre de la fuente, para la procedencia. */
  readonly name?: string | undefined;
}

export function audioClip(
  samples: Float32Array,
  sampleRate: number,
  name?: string,
): AudioClip {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    invalid('INVALID_PERFORMANCE', 'La frecuencia de muestreo debe ser positiva', { sampleRate });
  }
  return Object.freeze({ samples, sampleRate, ...(name === undefined ? {} : { name }) });
}

/** Duracion en segundos. */
export function clipDuration(clip: AudioClip): number {
  return clip.samples.length / clip.sampleRate;
}

/**
 * Nivel eficaz (RMS) de todo el clip.
 *
 * Sirve para detectar de un vistazo un archivo mudo o casi: es la causa mas
 * frecuente de "no detecta ninguna nota", y merece un aviso claro en vez de
 * dejar que el detector devuelva silencio sin explicar por que.
 */
export function clipLevel(clip: AudioClip): number {
  const { samples } = clip;
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}
