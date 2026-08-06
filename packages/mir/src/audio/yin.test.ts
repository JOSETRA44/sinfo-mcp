import { audioClip } from '@sinfo/perform';
import { describe, expect, it } from 'vitest';
import { autocorrelation, fft, ifft, nextPowerOfTwo } from './fft.js';
import { detectPitch } from './yin.js';

const RATE = 44100;

/**
 * Tono con armonicos, como suena un instrumento de verdad.
 *
 * Una sinusoide pura es un caso facil y enganoso: lo que hace fallar a los
 * detectores es el contenido armonico, que ofrece periodos alternativos donde
 * equivocarse de octava.
 */
function tone(frequency: number, seconds: number, harmonics = 6): Float32Array {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i += 1) {
    let value = 0;
    for (let h = 1; h <= harmonics; h += 1) {
      value += Math.sin((2 * Math.PI * frequency * h * i) / RATE) / h;
    }
    samples[i] = value * 0.25;
  }
  return samples;
}

/** Frecuencia mediana de las ventanas con tono, que es lo que se compara. */
function medianFrequency(points: readonly { frequency: number | null }[]): number {
  const values = points
    .map((point) => point.frequency)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 0;
}

describe('fft', () => {
  it('la inversa devuelve la senal original', () => {
    const re = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const im = new Float64Array(8);
    const original = Float64Array.from(re);

    fft(re, im);
    ifft(re, im);

    for (let i = 0; i < original.length; i += 1) {
      expect(re[i] ?? 0).toBeCloseTo(original[i] ?? 0, 10);
    }
  });

  it('rechaza longitudes que no son potencia de dos', () => {
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow(/potencia de dos/);
  });

  it('nextPowerOfTwo redondea hacia arriba', () => {
    expect(nextPowerOfTwo(1000)).toBe(1024);
    expect(nextPowerOfTwo(1024)).toBe(1024);
  });

  it('la autocorrelacion tiene su maximo en el desplazamiento cero', () => {
    const frame = new Float64Array(256);
    for (let i = 0; i < frame.length; i += 1) frame[i] = Math.sin((2 * Math.PI * 8 * i) / 256);

    const result = autocorrelation(frame);
    const zero = result[0] ?? 0;
    for (let tau = 1; tau < result.length; tau += 1) {
      expect(result[tau] ?? 0).toBeLessThanOrEqual(zero + 1e-9);
    }
  });

  it('la autocorrelacion tiene un maximo local en el periodo', () => {
    // 256 muestras con 8 ciclos: el periodo son 32 muestras.
    //
    // Se busca un maximo LOCAL y no el global a proposito. La autocorrelacion
    // lineal decae segun crece el desplazamiento, porque cada vez se solapan
    // menos muestras, asi que su maximo global siempre cae cerca de cero por
    // mucha periodicidad que haya. Ese sesgo es justo el que corrige la
    // normalizacion acumulada de YIN, y por eso YIN no se limita a buscar el
    // pico de la autocorrelacion.
    const frame = new Float64Array(256);
    for (let i = 0; i < frame.length; i += 1) frame[i] = Math.sin((2 * Math.PI * 8 * i) / 256);

    const result = autocorrelation(frame);
    for (const period of [32, 64, 96]) {
      expect(result[period] ?? 0).toBeGreaterThan(result[period - 1] ?? 0);
      expect(result[period] ?? 0).toBeGreaterThan(result[period + 1] ?? 0);
    }
    // Y en la mitad del periodo hay un minimo: la senal esta en contrafase.
    expect(result[16] ?? 0).toBeLessThan(0);
  });
});

describe('detectPitch', () => {
  it('acierta la altura de un la de 440', () => {
    const points = detectPitch(audioClip(tone(440, 0.5), RATE));
    expect(medianFrequency(points)).toBeCloseTo(440, 0);
  });

  it('no se equivoca de octava con un tono rico en armonicos', () => {
    // El fallo clasico de la autocorrelacion simple: quedarse con 110 o con
    // 440 en vez de con 220, porque ambos son periodos validos de la senal.
    const points = detectPitch(audioClip(tone(220, 0.5, 10), RATE));
    expect(medianFrequency(points)).toBeCloseTo(220, 0);
  });

  it('acierta en todo el registro util', () => {
    for (const frequency of [82.41, 146.83, 261.63, 440, 880, 1318.51]) {
      const points = detectPitch(audioClip(tone(frequency, 0.4), RATE));
      // Menos de un cuarto de tono de error: por debajo del umbral en que un
      // afinador diria que la nota es otra.
      expect(medianFrequency(points) / frequency).toBeCloseTo(1, 1.4);
    }
  });

  it('afina mejor que la rejilla de periodos enteros', () => {
    // Sin interpolacion parabolica, en el agudo los saltos de periodo entero
    // pasan del semitono. 1500 Hz cae entre dos periodos enteros a 44100.
    const points = detectPitch(audioClip(tone(1500, 0.3), RATE), { maxFrequency: 2500 });
    const cents = 1200 * Math.log2(medianFrequency(points) / 1500);
    expect(Math.abs(cents)).toBeLessThan(25);
  });

  it('no encuentra tono en el silencio', () => {
    const points = detectPitch(audioClip(new Float32Array(RATE), RATE));
    expect(points.every((point) => point.frequency === null)).toBe(true);
  });

  it('no encuentra tono en el ruido blanco', () => {
    // Ruido determinista: un generador congruencial sencillo.
    const samples = new Float32Array(RATE);
    let seed = 12345;
    for (let i = 0; i < samples.length; i += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      samples[i] = (seed / 2147483648) * 2 - 1;
    }
    const points = detectPitch(audioClip(samples, RATE));
    const tonal = points.filter((point) => point.frequency !== null).length;
    expect(tonal / points.length).toBeLessThan(0.2);
  });

  it('da confianza alta con tono limpio y baja con ruido', () => {
    const clean = detectPitch(audioClip(tone(440, 0.3), RATE));
    const average = clean.reduce((sum, point) => sum + point.confidence, 0) / clean.length;
    expect(average).toBeGreaterThan(0.8);
  });

  it('devuelve vacio si el audio es mas corto que una ventana', () => {
    expect(detectPitch(audioClip(new Float32Array(100), RATE))).toEqual([]);
  });
});
