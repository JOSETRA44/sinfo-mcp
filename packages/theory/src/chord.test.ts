import { DomainError, Interval, Pitch } from '@sinfo/core';
import { describe, expect, it } from 'vitest';
import { Chord, identifyChord } from './chord.js';

const names = (pitches: readonly Pitch[]): string[] => pitches.map((p) => p.name);
const classes = (pitches: readonly Pitch[]): string[] => pitches.map((p) => p.pitchName);

describe('Chord', () => {
  describe('construccion', () => {
    it('genera las triadas basicas', () => {
      expect(classes(Chord.of('C', 'major').pitches)).toEqual(['C', 'E', 'G']);
      expect(classes(Chord.of('C', 'minor').pitches)).toEqual(['C', 'Eb', 'G']);
      expect(classes(Chord.of('C', 'diminished').pitches)).toEqual(['C', 'Eb', 'Gb']);
      expect(classes(Chord.of('C', 'augmented').pitches)).toEqual(['C', 'E', 'G#']);
    });

    it('genera los acordes de septima', () => {
      expect(classes(Chord.of('G', 'dominant7').pitches)).toEqual(['G', 'B', 'D', 'F']);
      expect(classes(Chord.of('C', 'major7').pitches)).toEqual(['C', 'E', 'G', 'B']);
      expect(classes(Chord.of('D', 'minor7').pitches)).toEqual(['D', 'F', 'A', 'C']);
      expect(classes(Chord.of('B', 'halfDiminished7').pitches)).toEqual(['B', 'D', 'F', 'A']);
    });

    // El caso que justifica guardar intervalos en vez de semitonos.
    it('la septima disminuida se escribe como septima, no como sexta', () => {
      const chord = Chord.of('B', 'diminished7');
      expect(classes(chord.pitches)).toEqual(['B', 'D', 'F', 'Ab']);

      // Lab y Sol# suenan igual, pero solo Lab es una SEPTIMA de Si: escrito
      // como Sol# seria una sexta aumentada y el analisis dejaria de
      // reconocer el acorde.
      const seventh = chord.pitches[3]!;
      expect(seventh.isEnharmonicWith(Pitch.parse('G#5'))).toBe(true);
      expect(seventh.step).toBe('A');
      expect(chord.root.intervalTo(seventh).name).toBe('d7');
    });

    it('conserva la ortografia en tonalidades con muchas alteraciones', () => {
      expect(classes(Chord.of('F#', 'major').pitches)).toEqual(['F#', 'A#', 'C#']);
      expect(classes(Chord.of('Gb', 'major').pitches)).toEqual(['Gb', 'Bb', 'Db']);
      expect(classes(Chord.of('C#', 'minor').pitches)).toEqual(['C#', 'E', 'G#']);
    });
  });

  describe('parse de cifrados', () => {
    it.each([
      ['C', 'C', 'major'],
      ['Am', 'A', 'minor'],
      ['G7', 'G', 'dominant7'],
      ['Cmaj7', 'C', 'major7'],
      ['F#m7b5', 'F#', 'halfDiminished7'],
      ['Bbdim7', 'Bb', 'diminished7'],
      ['Dsus4', 'D', 'sus4'],
      ['Eaug', 'E', 'augmented'],
      ['C6', 'C', 'major6'],
    ])('interpreta %s', (symbol, root, quality) => {
      const chord = Chord.parse(symbol);
      expect(chord.root.pitchName).toBe(root);
      expect(chord.quality).toBe(quality);
    });

    it('rechaza sufijos inventados', () => {
      expect(() => Chord.parse('Cmagico')).toThrow(DomainError);
      expect(() => Chord.parse('H7')).toThrow(DomainError);
    });

    it('escribir y volver a leer conserva el acorde', () => {
      for (const symbol of ['C', 'Am', 'G7', 'Cmaj7', 'F#m7b5', 'Bbdim7', 'Dsus4']) {
        expect(Chord.parse(Chord.parse(symbol).symbol).symbol).toBe(Chord.parse(symbol).symbol);
      }
    });
  });

  describe('inversiones', () => {
    it('el bajo cambia con la inversion', () => {
      const chord = Chord.of('C', 'major');
      expect(chord.bass.pitchName).toBe('C');
      expect(chord.withInversion(1).bass.pitchName).toBe('E');
      expect(chord.withInversion(2).bass.pitchName).toBe('G');
    });

    it('el cifrado marca la nota del bajo', () => {
      expect(Chord.of('C', 'major', 1).symbol).toBe('C/E');
      expect(Chord.of('G', 'dominant7', 3).symbol).toBe('G7/F');
    });

    it('rechaza inversiones que el acorde no tiene', () => {
      expect(() => Chord.of('C', 'major', 3)).toThrow(DomainError);
      expect(() => Chord.of('G', 'dominant7', 4)).toThrow(DomainError);
    });
  });

  describe('voicing', () => {
    it('coloca las notas de grave a agudo sin cruces', () => {
      const voiced = Chord.of('C', 'major').voicing(3);
      expect(names(voiced)).toEqual(['C3', 'E3', 'G3']);

      for (let i = 1; i < voiced.length; i++) {
        expect(voiced[i]!.midi).toBeGreaterThan(voiced[i - 1]!.midi);
      }
    });

    it('la inversion pone su nota en el bajo y sube el resto', () => {
      expect(names(Chord.of('C', 'major', 1).voicing(3))).toEqual(['E3', 'G3', 'C4']);
      expect(names(Chord.of('C', 'major', 2).voicing(3))).toEqual(['G3', 'C4', 'E4']);
    });

    it('funciona con septimas', () => {
      const voiced = Chord.of('G', 'dominant7').voicing(2);
      expect(names(voiced)).toEqual(['G2', 'B2', 'D3', 'F3']);
    });
  });

  describe('transposicion', () => {
    it('mantiene la calidad y la escritura', () => {
      const transposed = Chord.of('C', 'major7').transpose(Interval.PERFECT_FIFTH);
      expect(transposed.root.pitchName).toBe('G');
      expect(transposed.quality).toBe('major7');
      expect(classes(transposed.pitches)).toEqual(['G', 'B', 'D', 'F#']);
    });
  });
});

describe('identifyChord', () => {
  it('reconoce triadas en estado fundamental', () => {
    const match = identifyChord([Pitch.parse('C4'), Pitch.parse('E4'), Pitch.parse('G4')]);
    expect(match?.chord.root.pitchName).toBe('C');
    expect(match?.chord.quality).toBe('major');
    expect(match?.chord.inversion).toBe(0);
  });

  it('reconoce la inversion por la nota del bajo', () => {
    const match = identifyChord([Pitch.parse('E3'), Pitch.parse('G3'), Pitch.parse('C4')]);
    expect(match?.chord.root.pitchName).toBe('C');
    expect(match?.chord.inversion).toBe(1);
    expect(match?.chord.symbol).toBe('C/E');
  });

  it('reconoce acordes de septima', () => {
    const match = identifyChord(
      ['G2', 'B3', 'D4', 'F4'].map((n) => Pitch.parse(n)),
    );
    expect(match?.chord.quality).toBe('dominant7');
    expect(match?.chord.root.pitchName).toBe('G');
  });

  it('reconoce con notas duplicadas en varias octavas', () => {
    const match = identifyChord(
      ['C3', 'G3', 'C4', 'E4', 'G4'].map((n) => Pitch.parse(n)),
    );
    expect(match?.chord.symbol).toBe('C');
  });

  it('no inventa un acorde cuando hay notas ajenas', () => {
    // Do-Mi-Sol-Fa# no es ninguna triada ni septima de la lista.
    const match = identifyChord(['C4', 'E4', 'G4', 'F#4'].map((n) => Pitch.parse(n)));
    expect(match).toBeNull();
  });

  it('acepta una triada a la que le falta la quinta', () => {
    const match = identifyChord([Pitch.parse('C4'), Pitch.parse('E4')]);
    expect(match?.chord.quality).toBe('major');
    expect(match?.missing).toBe(1);
    expect(match?.confidence).toBeLessThan(1);
  });

  it('devuelve null con menos de dos notas', () => {
    expect(identifyChord([Pitch.parse('C4')])).toBeNull();
    expect(identifyChord([])).toBeNull();
  });

  it('respeta la ortografia al identificar', () => {
    const match = identifyChord(['B3', 'D4', 'F4', 'Ab4'].map((n) => Pitch.parse(n)));
    expect(match?.chord.quality).toBe('diminished7');
    expect(match?.chord.root.pitchName).toBe('B');
  });
});
