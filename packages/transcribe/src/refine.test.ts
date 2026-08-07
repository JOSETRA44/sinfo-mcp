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

describe('refineNotes: desplazamiento sistematico de octava', () => {
  /** Linea de bajo entera una octava por encima de donde deberia estar. */
  const bassLineUpAnOctave = [36, 41, 43, 36, 41, 43, 38, 36].map((midi, i) =>
    note(midi + 12, 90, i * 0.5),
  );

  it('baja la pista entera cuando esta descolocada de octava', () => {
    // Es el error que la correccion nota a nota NO ve: un bajo detectado una
    // octava alto sigue dentro del rango fisico de un bajo, asi que ninguna
    // nota parece sospechosa por separado.
    const result = refineNotes(bassLineUpAnOctave, {
      instrumentId: 'bass_guitar',
      dropHarmonics: false,
    });
    expect(result.notes.map((n) => n.midi)).toEqual([36, 41, 43, 36, 41, 43, 38, 36]);
    expect(result.report.notes.join(' ')).toMatch(/octava/);
  });

  it('NO toca un instrumento de tesitura ancha como el piano', () => {
    // El centro de una tesitura de cinco octavas no significa nada: una pieza
    // en clave de sol vive legitimamente por encima de el. Sin este freno, los
    // acordes de piano del banco de pruebas caian del 95,7 % al 0 %.
    const treble = [60, 64, 67, 72, 76, 79].map((midi, i) => note(midi, 90, i * 0.5));
    const result = refineNotes(treble, { instrumentId: 'piano', dropHarmonics: false });
    expect(result.notes.map((n) => n.midi)).toEqual([60, 64, 67, 72, 76, 79]);
  });

  it('no mueve nada si la pista ya esta centrada', () => {
    const centred = [36, 41, 43, 36, 41, 43].map((midi, i) => note(midi, 90, i * 0.5));
    const result = refineNotes(centred, { instrumentId: 'bass_guitar', dropHarmonics: false });
    expect(result.notes.map((n) => n.midi)).toEqual([36, 41, 43, 36, 41, 43]);
  });

  it('no se pronuncia con muy pocas notas', () => {
    // Con dos o tres notas, la mediana no dice nada sobre el registro de la
    // obra y desplazarla seria adivinar.
    const few = [note(60, 90, 0), note(62, 90, 0.5)];
    const result = refineNotes(few, { instrumentId: 'bass_guitar', dropHarmonics: false });
    expect(result.notes.map((n) => n.midi)).toEqual([60, 62]);
  });
});

describe('refineNotes: monofonia', () => {
  it('una voz no puede cantar dos notas a la vez', () => {
    // Medido de verdad: la pista vocal separada salia con dos voces. Un
    // cantante emite una linea; el modelo dudaba entre dos alturas y devolvia
    // ambas solapadas.
    const result = refineNotes([note(60, 100, 0, 1), note(62, 40, 0.3, 0.8)], {
      instrumentId: 'alto_voice',
      dropHarmonics: false,
    });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]?.midi).toBe(60);
    expect(result.report.droppedOverlaps).toBe(1);
  });

  it('cuando la nueva es mas fuerte, corta la anterior', () => {
    const result = refineNotes([note(60, 40, 0, 1), note(62, 100, 0.4, 0.6)], {
      instrumentId: 'alto_voice',
      dropHarmonics: false,
    });
    expect(result.notes).toHaveLength(2);
    expect(result.notes[0]?.offset).toBeCloseTo(0.4, 5);
  });

  it('se deduce del instrumento: la flauta si, el piano no', () => {
    const overlapping = [note(60, 100, 0, 1), note(64, 90, 0.3, 0.8)];

    expect(
      refineNotes(overlapping, { instrumentId: 'flute', dropHarmonics: false }).notes,
    ).toHaveLength(1);
    // Un piano toca acordes: forzarle monofonia le robaria notas reales.
    expect(
      refineNotes(overlapping, { instrumentId: 'piano', dropHarmonics: false }).notes,
    ).toHaveLength(2);
  });

  it('las cuerdas quedan fuera: hacen dobles cuerdas', () => {
    const result = refineNotes([note(60, 100, 0, 1), note(67, 90, 0.3, 0.8)], {
      instrumentId: 'violin',
      dropHarmonics: false,
    });
    expect(result.notes).toHaveLength(2);
  });

  it('se puede forzar e imponer sobre el instrumento', () => {
    const result = refineNotes([note(60, 100, 0, 1), note(64, 90, 0.3, 0.8)], {
      instrumentId: 'piano',
      monophonic: true,
      dropHarmonics: false,
    });
    expect(result.notes).toHaveLength(1);
  });

  it('no toca las notas que se suceden sin solaparse', () => {
    const result = refineNotes([note(60, 100, 0, 0.5), note(62, 90, 0.6, 0.5)], {
      instrumentId: 'alto_voice',
      dropHarmonics: false,
    });
    expect(result.notes).toHaveLength(2);
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
