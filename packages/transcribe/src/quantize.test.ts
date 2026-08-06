import { Duration } from '@sinfo/core';
import { type RawNote, createGrid, gridFromTempo, rawNote } from '@sinfo/perform';
import { describe, expect, it } from 'vitest';
import { quantize } from './quantize.js';

/** Rejilla de 120 negras por minuto: el pulso dura medio segundo. */
const grid120 = gridFromTempo(120, 30);
const BEAT = 0.5;

/** Nota situada por posicion de pulso, no por segundos, que se lee mejor. */
const atBeat = (beat: number, lengthInBeats: number, midi = 60): RawNote =>
  rawNote({
    onset: beat * BEAT,
    offset: (beat + lengthInBeats) * BEAT,
    midi,
    velocity: 80,
    confidence: 1,
  });

const positions = (notes: readonly { position: Duration }[]): string[] =>
  notes.map((note) => note.position.toString());

describe('quantize: eleccion de subdivision', () => {
  it('escribe negras como negras, sin subdividir', () => {
    const result = quantize([atBeat(0, 1), atBeat(1, 1), atBeat(2, 1), atBeat(3, 1)], grid120);
    expect(result.subdivisions.every((d) => d === 1)).toBe(true);
    expect(positions(result.notes)).toEqual(['0/1', '1/4', '1/2', '3/4']);
  });

  it('reconoce semicorcheas y las sitúa en la rejilla de cuatro', () => {
    const notes = [0, 0.25, 0.5, 0.75].map((f) => atBeat(f, 0.25));
    const result = quantize(notes, grid120);
    expect(result.subdivisions[0]).toBe(4);
    expect(positions(result.notes)).toEqual(['0/1', '1/16', '1/8', '3/16']);
  });

  it('reconoce tresillos y produce doceavos EXACTOS', () => {
    // El punto de todo el diseno de Duration: 1/12 de verdad, no 0.0833333.
    const notes = [0, 1 / 3, 2 / 3].map((f) => atBeat(f, 1 / 3));
    const result = quantize(notes, grid120);
    expect(result.subdivisions[0]).toBe(3);
    expect(positions(result.notes)).toEqual(['0/1', '1/12', '1/6']);
    const [, second] = result.notes;
    expect(second?.duration.equals(Duration.of(1, 12))).toBe(true);
  });

  it('lee el swing como tresillo, que es como se toca', () => {
    // Corcheas con swing caen en 0 y 2/3, no en 0 y 1/2.
    const notes = [atBeat(0, 2 / 3), atBeat(2 / 3, 1 / 3)];
    const result = quantize(notes, grid120);
    expect(result.subdivisions[0]).toBe(3);
    expect(positions(result.notes)).toEqual(['0/1', '1/6']);
  });
});

describe('quantize: resistencia a la ejecucion humana', () => {
  it('recupera la rejilla exacta pese al desajuste de un interprete', () => {
    // Desvios de hasta 18 ms, del orden de lo que produce un pianista.
    const jitter = [0.004, -0.012, 0.009, 0.018, -0.006, 0.011, -0.015, 0.003];
    const notes = jitter.map((offset, i) =>
      rawNote({
        onset: i * 0.25 * BEAT + offset,
        offset: (i + 1) * 0.25 * BEAT + offset,
        midi: 60,
        velocity: 80,
        confidence: 1,
      }),
    );
    const result = quantize(notes, grid120);
    expect(positions(result.notes)).toEqual([
      '0/1',
      '1/16',
      '1/8',
      '3/16',
      '1/4',
      '5/16',
      '3/8',
      '7/16',
    ]);
  });

  it('no se inventa tresillos en un pasaje binario con ruido', () => {
    // El fallo caracteristico de los transcriptores: alternar tresillos y
    // semicorcheas compas tras compas porque el ruido inclina cada pulso por
    // su cuenta. El coste de transicion es lo que lo impide.
    const wobble = [0, 0.021, -0.017, 0.014, -0.02, 0.008, 0.019, -0.011];
    const notes: RawNote[] = [];
    for (let beat = 0; beat < 8; beat += 1) {
      for (let step = 0; step < 4; step += 1) {
        const noise = wobble[(beat * 4 + step) % wobble.length] ?? 0;
        notes.push(
          rawNote({
            onset: (beat + step * 0.25) * BEAT + noise,
            offset: (beat + step * 0.25 + 0.2) * BEAT + noise,
            midi: 60,
            velocity: 80,
            confidence: 1,
          }),
        );
      }
    }
    const result = quantize(notes, grid120);
    expect(result.subdivisions.some((d) => d % 3 === 0)).toBe(false);
  });

  it('se mantiene en una sola rejilla cuando algunos pulsos son ambiguos', () => {
    // Corcheas rectas donde algunos pulsos se van a 0,62 del pulso: ni
    // corchea limpia ni tresillo limpio, justo en la frontera donde el ajuste
    // por si solo se decide por un pelo. Pulso a pulso sale un zigzag de
    // binario y ternario que ningun copista escribiria. Lo que decide aqui es
    // el coste de transicion: ante la duda, seguir en la rejilla del contexto.
    const notes: RawNote[] = [];
    for (let beat = 0; beat < 8; beat += 1) {
      const split = beat % 2 === 0 ? 0.5 : 0.62;
      notes.push(atBeat(beat, split), atBeat(beat + split, 1 - split));
    }

    const result = quantize(notes, grid120);
    const naive = quantize(notes, grid120, { switchPenalty: 0, familySwitchPenalty: 0 });

    expect(new Set(result.subdivisions).size).toBe(1);
    // Y que conste que el merito es del coste de transicion: sin el, el mismo
    // pasaje se descompone en el zigzag.
    expect(new Set(naive.subdivisions).size).toBeGreaterThan(1);
  });

  it('detecta un tresillo aunque venga tocado con desvio realista', () => {
    // El margen que costo calibrar `complexityWeight`. Con el valor anterior
    // este pasaje se escribia como corcheas rectas, que es una figura
    // distinta, no una aproximacion.
    const notes = [0, 1 / 3 + 0.03, 2 / 3 - 0.025].map((f) => atBeat(f, 0.3));
    const result = quantize(notes, grid120);
    expect(result.subdivisions[0]).toBe(3);
    expect(positions(result.notes)).toEqual(['0/1', '1/12', '1/6']);
  });

  it('anula el rubato midiendo contra el pulso real', () => {
    // Rejilla que se acelera de verdad: 0,60 s, 0,55 s, 0,50 s, 0,45 s por
    // pulso. Un reloj de tempo constante desviaria las notas cada vez mas.
    const drifting = createGrid([0, 0.6, 1.15, 1.65, 2.1, 2.5]);
    const onsets = [0, 0.6, 1.15, 1.65, 2.1];
    const notes = onsets.map((onset, i) =>
      rawNote({
        onset,
        offset: (onsets[i + 1] ?? 2.5) - 0.01,
        midi: 60,
        velocity: 80,
        confidence: 1,
      }),
    );
    const result = quantize(notes, drifting);
    expect(positions(result.notes)).toEqual(['0/1', '1/4', '1/2', '3/4', '1/1']);
  });
});

describe('quantize: casos de borde', () => {
  it('acepta una anacrusa con posiciones negativas', () => {
    const grid = createGrid(
      Array.from({ length: 9 }, (_, i) => 1 + i * BEAT),
      [1, 3],
    );
    const result = quantize([rawNote({ onset: 0.5, offset: 1, midi: 67, velocity: 80, confidence: 1 })], grid);
    expect(result.firstBeat).toBe(-1);
    expect(result.notes[0]?.position.toString()).toBe('-1/4');
  });

  it('da el paso minimo a una nota mas corta que la rejilla', () => {
    // Un adorno mal medido sigue siendo una nota que sono: perderla es peor
    // que escribirla con la figura mas corta disponible.
    const notes = [
      rawNote({ onset: 0, offset: 0.002, midi: 60, velocity: 80, confidence: 1 }),
      atBeat(1, 1),
    ];
    const result = quantize(notes, grid120);
    expect(result.notes[0]?.duration.isZero).toBe(false);
  });

  it('devuelve un resultado vacio sin notas, en vez de fallar', () => {
    const result = quantize([], grid120);
    expect(result.notes).toEqual([]);
    expect(result.meanDeviation).toBe(0);
  });

  it('informa de la desviacion media para poder desconfiar del resultado', () => {
    const clean = quantize([atBeat(0, 1), atBeat(1, 1)], grid120);
    expect(clean.meanDeviation).toBeCloseTo(0, 6);
  });
});

describe('quantize: politica de huecos', () => {
  it('conserva los silencios medidos por defecto', () => {
    const result = quantize([atBeat(0, 0.5), atBeat(1, 1)], grid120);
    expect(result.notes[0]?.duration.equals(Duration.of(1, 8))).toBe(true);
  });

  it('con legato alarga la nota hasta el ataque siguiente', () => {
    const result = quantize([atBeat(0, 0.5), atBeat(1, 1)], grid120, { gapPolicy: 'legato' });
    expect(result.notes[0]?.duration.equals(Duration.QUARTER)).toBe(true);
  });

  it('con legato no inventa nada sobre un silencio largo', () => {
    // Alargar una nota dos compases no es interpretar, es inventar. Pero el
    // hueco se cierra igual: la decision de escribir silencios es del
    // ensamblador de la partitura, no de aqui.
    const result = quantize([atBeat(0, 1), atBeat(8, 1)], grid120, { gapPolicy: 'legato' });
    expect(result.notes[0]?.duration.equals(Duration.of(2, 1))).toBe(true);
  });
});
