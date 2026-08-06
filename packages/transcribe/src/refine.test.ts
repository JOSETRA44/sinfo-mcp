import type { RawNote } from '@sinfo/perform';
import { describe, expect, it } from 'vitest';
import { refineNotes } from './refine.js';

const note = (
  midi: number,
  velocity: number,
  onset = 0,
  length = 0.5,
  confidence = 1,
): RawNote => ({ onset, offset: onset + length, midi, velocity, confidence });

const pitches = (notes: readonly RawNote[]): number[] =>
  notes.map((item) => item.midi).sort((a, b) => a - b);

describe('refineNotes: armonicos falsos', () => {
  it('descarta la octava debil que entra con una nota grave y fuerte', () => {
    // El caso medido de verdad: un do3 sintetizado hace aparecer un do4
    // fantasma. Es su segundo armonico, no una nota que alguien toco.
    const result = refineNotes([note(60, 100), note(72, 45)]);
    expect(pitches(result.notes)).toEqual([60]);
    expect(result.report.droppedHarmonics).toBe(1);
  });

  it('descarta tambien la doceava y la quincena', () => {
    const result = refineNotes([note(60, 100), note(79, 40), note(84, 30)]);
    expect(pitches(result.notes)).toEqual([60]);
    expect(result.report.droppedHarmonics).toBe(2);
  });

  it('CONSERVA una octava real tocada con fuerza pareja', () => {
    // Un piano que dobla la melodia en octavas toca ambas con energia
    // parecida. Perderla seria mucho peor que dejar pasar un armonico, asi
    // que el filtro exige que la de arriba sea claramente mas floja.
    const result = refineNotes([note(60, 100), note(72, 95)]);
    expect(pitches(result.notes)).toEqual([60, 72]);
    expect(result.report.droppedHarmonics).toBe(0);
  });

  it('conserva una octava que entra en otro momento', () => {
    // Una melodia que sube a la octava medio segundo despues no es armonico
    // de nada: es la nota siguiente.
    const result = refineNotes([note(60, 100, 0), note(72, 40, 1.5)]);
    expect(pitches(result.notes)).toEqual([60, 72]);
  });

  it('no toca los intervalos que no son armonicos', () => {
    // Una tercera y una quinta debiles son parte del acorde, no armonicos.
    const result = refineNotes([note(60, 100), note(64, 40), note(67, 35)]);
    expect(pitches(result.notes)).toEqual([60, 64, 67]);
  });

  it('se puede desactivar', () => {
    const result = refineNotes([note(60, 100), note(72, 45)], { dropHarmonics: false });
    expect(pitches(result.notes)).toEqual([60, 72]);
  });

  it('explica siempre lo que ha quitado', () => {
    // Un filtro que se come notas en silencio es peor que no filtrar.
    const result = refineNotes([note(60, 100), note(72, 45)]);
    expect(result.report.notes.join(' ')).toMatch(/armonicos/);
  });

  it('limpia el caso real medido: tres acordes con sus armonicos', () => {
    // Reproduce lo que devolvio basic-pitch sobre audio sintetizado: el
    // acorde correcto mas octavas y doceavas fantasma, mas flojas.
    const result = refineNotes([
      note(60, 110),
      note(64, 105),
      note(67, 100),
      note(72, 40),
      note(76, 35),
      note(79, 30),
    ]);
    expect(pitches(result.notes)).toEqual([60, 64, 67]);
  });
});

describe('refineNotes: trozos de una misma nota', () => {
  it('funde una nota que el modelo partio en dos', () => {
    // Medido de verdad: basic-pitch devolvio dos veces la misma altura en el
    // mismo acorde. Sin fundirlas, la partitura sale con la nota repicada.
    const result = refineNotes([note(72, 90, 0, 0.3), note(72, 80, 0.32, 0.2)], {
      dropHarmonics: false,
    });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]?.offset).toBeCloseTo(0.52, 5);
    expect(result.report.mergedDuplicates).toBe(1);
  });

  it('compara la altura redondeada, no la exacta', () => {
    // Cada trozo se afina por su cuenta y difieren en centesimas; exigir
    // igualdad exacta no fundiria nunca nada.
    const result = refineNotes([note(71.96, 90, 0, 0.3), note(72.05, 80, 0.31, 0.2)], {
      dropHarmonics: false,
    });
    expect(result.notes).toHaveLength(1);
  });

  it('NO funde dos notas repetidas de verdad', () => {
    // Dos negras iguales seguidas, con su silencio en medio, son dos notas.
    const result = refineNotes([note(72, 90, 0, 0.4), note(72, 90, 1.0, 0.4)], {
      dropHarmonics: false,
    });
    expect(result.notes).toHaveLength(2);
  });

  it('se puede desactivar', () => {
    const result = refineNotes([note(72, 90, 0, 0.3), note(72, 80, 0.32, 0.2)], {
      dropHarmonics: false,
      mergeDuplicates: false,
    });
    expect(result.notes).toHaveLength(2);
  });
});

describe('refineNotes: rango del instrumento', () => {
  it('sube una octava lo que cae por debajo del instrumento', () => {
    // Un violin no baja de sol3. Una nota una octava mas abajo es un error de
    // octava del detector, no una nota imposible que el violinista toco.
    const result = refineNotes([note(43, 90)], { instrumentId: 'violin' });
    expect(result.notes[0]?.midi).toBe(55);
    expect(result.report.octaveCorrected).toBe(1);
  });

  it('descarta lo que no entra ni cambiando de octava', () => {
    const result = refineNotes([note(12, 90)], { instrumentId: 'piccolo' });
    expect(result.notes).toHaveLength(0);
    expect(result.report.droppedOutOfRange).toBe(1);
  });

  it('no toca lo que ya esta en registro', () => {
    const result = refineNotes([note(69, 90)], { instrumentId: 'violin' });
    expect(result.notes[0]?.midi).toBe(69);
    expect(result.report.octaveCorrected).toBe(0);
  });

  it('sin instrumento declarado no filtra por rango', () => {
    // Sin saber que suena no hay nada contra lo que comparar, y adivinarlo
    // seria peor que no hacer nada.
    const result = refineNotes([note(12, 90), note(120, 90)], { dropHarmonics: false });
    expect(result.notes).toHaveLength(2);
  });

  it('explica la correccion de octava', () => {
    const result = refineNotes([note(43, 90)], { instrumentId: 'violin' });
    expect(result.report.notes.join(' ')).toMatch(/octava/);
  });
});

describe('refineNotes: confianza', () => {
  it('descarta por debajo del umbral', () => {
    const result = refineNotes([note(60, 90, 0, 0.5, 0.9), note(61, 90, 0, 0.5, 0.2)], {
      minConfidence: 0.5,
      dropHarmonics: false,
    });
    expect(pitches(result.notes)).toEqual([60]);
    expect(result.report.droppedLowConfidence).toBe(1);
  });

  it('por defecto no filtra por confianza', () => {
    const result = refineNotes([note(60, 90, 0, 0.5, 0.1)], { dropHarmonics: false });
    expect(result.notes).toHaveLength(1);
  });
});
