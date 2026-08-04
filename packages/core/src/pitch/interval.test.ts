import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.js';
import { Interval } from './interval.js';

describe('Interval', () => {
  describe('parse', () => {
    it('interpreta calidades justas, mayores y menores', () => {
      expect(Interval.parse('P5')).toEqual(Interval.PERFECT_FIFTH);
      expect(Interval.parse('M3')).toEqual(Interval.MAJOR_THIRD);
      expect(Interval.parse('m3')).toEqual(Interval.MINOR_THIRD);
      expect(Interval.parse('P8')).toEqual(Interval.OCTAVE);
      expect(Interval.parse('P1')).toEqual(Interval.UNISON);
    });

    it('interpreta aumentados y disminuidos', () => {
      expect(Interval.parse('A4').chromatic).toBe(6);
      expect(Interval.parse('d5').chromatic).toBe(6);
      expect(Interval.parse('A5').chromatic).toBe(8);
      expect(Interval.parse('d7').chromatic).toBe(9);
      expect(Interval.parse('AA4').chromatic).toBe(7);
    });

    it('interpreta intervalos compuestos', () => {
      expect(Interval.parse('M10').chromatic).toBe(16);
      expect(Interval.parse('P12').chromatic).toBe(19);
    });

    it('interpreta descendentes', () => {
      const down = Interval.parse('-P5');
      expect(down.diatonic).toBe(-4);
      expect(down.chromatic).toBe(-7);
      expect(down.isDescending).toBe(true);
    });

    it('rechaza combinaciones imposibles', () => {
      expect(() => Interval.parse('M5')).toThrow(DomainError);
      expect(() => Interval.parse('P3')).toThrow(DomainError);
      expect(() => Interval.parse('X4')).toThrow(DomainError);
    });
  });

  describe('name', () => {
    it('reconstruye el nombre a partir de los componentes', () => {
      const cases = ['P1', 'm2', 'M2', 'm3', 'M3', 'P4', 'A4', 'd5', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8', 'M10'];
      for (const name of cases) {
        expect(Interval.parse(name).name).toBe(name);
      }
    });

    it('marca los descendentes con guion', () => {
      expect(Interval.parse('-m3').name).toBe('-m3');
    });
  });

  // La razon de guardar dos componentes en vez de solo semitonos.
  describe('4a aumentada y 5a disminuida', () => {
    it('suenan igual pero son intervalos distintos', () => {
      const a4 = Interval.parse('A4');
      const d5 = Interval.parse('d5');

      expect(a4.chromatic).toBe(d5.chromatic);
      expect(a4.isEnharmonicWith(d5)).toBe(true);
      expect(a4.equals(d5)).toBe(false);
      expect(a4.diatonic).toBe(3);
      expect(d5.diatonic).toBe(4);
    });
  });

  describe('operaciones', () => {
    it('suma intervalos', () => {
      expect(Interval.MAJOR_THIRD.plus(Interval.MINOR_THIRD).name).toBe('P5');
      expect(Interval.MINOR_THIRD.plus(Interval.MAJOR_THIRD).name).toBe('P5');
      expect(Interval.MAJOR_THIRD.plus(Interval.MAJOR_THIRD).name).toBe('A5');
    });

    it('invierte', () => {
      expect(Interval.PERFECT_FIFTH.inverted().name).toBe('-P5');
      expect(Interval.PERFECT_FIFTH.inverted().inverted().name).toBe('P5');
    });
  });

  describe('consonancia', () => {
    it('clasifica segun la practica comun', () => {
      expect(Interval.PERFECT_FIFTH.isConsonant).toBe(true);
      expect(Interval.MAJOR_THIRD.isConsonant).toBe(true);
      expect(Interval.OCTAVE.isConsonant).toBe(true);
      expect(Interval.MAJOR_SECOND.isConsonant).toBe(false);
      expect(Interval.MINOR_SEVENTH.isConsonant).toBe(false);
      expect(Interval.TRITONE.isConsonant).toBe(false);
    });
  });
});
