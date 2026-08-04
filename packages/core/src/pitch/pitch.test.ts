import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.js';
import { Interval } from './interval.js';
import { Pitch } from './pitch.js';

describe('Pitch', () => {
  describe('construccion y lectura', () => {
    it('C4 es el do central, MIDI 60', () => {
      expect(Pitch.parse('C4').midi).toBe(60);
      expect(Pitch.of('C', 0, 4).midi).toBe(60);
    });

    it('interpreta alteraciones simples y dobles', () => {
      expect(Pitch.parse('F#3').midi).toBe(54);
      expect(Pitch.parse('Bb5').name).toBe('Bb5');
      expect(Pitch.parse('Ebb2').alter).toBe(-2);
      expect(Pitch.parse('G##4').alter).toBe(2);
    });

    it('acepta minusculas', () => {
      expect(Pitch.parse('c4').name).toBe('C4');
      expect(Pitch.parse('bb3').name).toBe('Bb3');
    });

    // Regresion: aceptar `-` como bemol hacia ambiguo `C-1` y lo interpretaba
    // como Do bemol 1 (MIDI 23) en vez de Do de la octava -1 (MIDI 0).
    it('la octava -1 no se confunde con un bemol', () => {
      expect(Pitch.parse('C-1').midi).toBe(0);
      expect(Pitch.parse('C-1').octave).toBe(-1);
      expect(Pitch.parse('B-1').midi).toBe(11);
      expect(Pitch.parse('Cb-1').alter).toBe(-1);
    });

    it('rechaza basura', () => {
      expect(() => Pitch.parse('H4')).toThrow(DomainError);
      expect(() => Pitch.parse('C')).toThrow(DomainError);
      expect(() => Pitch.of('C', 0, 99)).toThrow(DomainError);
    });

    it('calcula la frecuencia con A4 = 440', () => {
      expect(Pitch.parse('A4').frequency()).toBeCloseTo(440, 6);
      expect(Pitch.parse('A5').frequency()).toBeCloseTo(880, 6);
    });
  });

  // Esta es LA razon por la que Pitch no guarda un numero MIDI.
  describe('la ortografia es informacion, no decoracion', () => {
    it('Do# y Reb suenan igual pero no son la misma nota', () => {
      const cSharp = Pitch.parse('C#4');
      const dFlat = Pitch.parse('Db4');

      expect(cSharp.midi).toBe(dFlat.midi);
      expect(cSharp.isEnharmonicWith(dFlat)).toBe(true);
      expect(cSharp.equals(dFlat)).toBe(false);
    });

    it('transponer conserva la escritura correcta', () => {
      // Do + 3a mayor = Mi (no Fa bemol)
      expect(Pitch.parse('C4').transpose(Interval.MAJOR_THIRD).name).toBe('E4');
      // Do + 4a disminuida = Fa bemol (no Mi), aunque suenen igual
      expect(Pitch.parse('C4').transpose(Interval.parse('d4')).name).toBe('Fb4');
      // Si + 2a menor = Do de la octava siguiente
      expect(Pitch.parse('B3').transpose(Interval.MINOR_SECOND).name).toBe('C4');
    });

    it('transponer una escala de Fa# mayor por 5a justa da Do# mayor, no Reb', () => {
      const fSharpMajor = ['F#4', 'G#4', 'A#4', 'B4', 'C#5', 'D#5', 'E#5'].map((n) =>
        Pitch.parse(n),
      );
      const transposed = fSharpMajor.map((p) => p.transpose(Interval.PERFECT_FIFTH));

      expect(transposed.map((p) => p.name)).toEqual([
        'C#5', 'D#5', 'E#5', 'F#5', 'G#5', 'A#5', 'B#5',
      ]);
    });

    it('transponer y volver devuelve la nota original', () => {
      for (const name of ['C4', 'F#3', 'Bb5', 'Ebb2', 'B#3']) {
        const original = Pitch.parse(name);
        const roundTrip = original
          .transpose(Interval.PERFECT_FIFTH)
          .transpose(Interval.PERFECT_FIFTH.inverted());
        expect(roundTrip.equals(original)).toBe(true);
      }
    });

    it('transponer por intervalo descendente baja', () => {
      expect(Pitch.parse('C4').transpose(Interval.parse('-P5')).name).toBe('F3');
      expect(Pitch.parse('C4').transpose(Interval.parse('-M2')).name).toBe('Bb3');
    });
  });

  describe('intervalTo', () => {
    it('mide el intervalo entre dos alturas', () => {
      expect(Pitch.parse('C4').intervalTo(Pitch.parse('G4')).name).toBe('P5');
      expect(Pitch.parse('C4').intervalTo(Pitch.parse('E4')).name).toBe('M3');
      expect(Pitch.parse('C4').intervalTo(Pitch.parse('Eb4')).name).toBe('m3');
    });

    it('distingue 4a aumentada de 5a disminuida', () => {
      expect(Pitch.parse('F4').intervalTo(Pitch.parse('B4')).name).toBe('A4');
      expect(Pitch.parse('F4').intervalTo(Pitch.parse('Cb5')).name).toBe('d5');
    });

    it('es coherente con transpose', () => {
      const a = Pitch.parse('D3');
      const b = Pitch.parse('Ab5');
      expect(a.transpose(a.intervalTo(b)).equals(b)).toBe(true);
    });
  });

  describe('fromMidi', () => {
    it('elige escritura con sostenidos o bemoles segun se pida', () => {
      expect(Pitch.fromMidi(61, 'sharp').name).toBe('C#4');
      expect(Pitch.fromMidi(61, 'flat').name).toBe('Db4');
    });

    it('las naturales no dependen de la preferencia', () => {
      expect(Pitch.fromMidi(60, 'flat').name).toBe('C4');
    });

    it('rechaza fuera del rango MIDI', () => {
      expect(() => Pitch.fromMidi(128)).toThrow(DomainError);
    });
  });

  describe('simplified', () => {
    it('reduce alteraciones dobles', () => {
      expect(Pitch.parse('G##4').simplified().name).toBe('A4');
      expect(Pitch.parse('Fbb4').simplified('flat').name).toBe('Eb4');
    });

    it('quita la alteracion cuando el sonido es una nota natural', () => {
      expect(Pitch.parse('B#4').simplified().name).toBe('C5');
      expect(Pitch.parse('E#4').simplified().name).toBe('F4');
      expect(Pitch.parse('Cb4').simplified().name).toBe('B3');
    });

    it('no reescribe alteraciones que ya son minimas', () => {
      expect(Pitch.parse('F#4').simplified().name).toBe('F#4');
      // Aunque se prefieran bemoles, Fa# ya es minimo: no se vuelve Solb.
      expect(Pitch.parse('F#4').simplified('flat').name).toBe('F#4');
      expect(Pitch.parse('Bb4').simplified().name).toBe('Bb4');
    });
  });
});
