import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.js';
import { Duration, sumDurations } from './duration.js';

describe('Duration', () => {
  describe('normalizacion', () => {
    it('reduce por MCD', () => {
      expect(Duration.of(2, 8).toString()).toBe('1/4');
      expect(Duration.of(6, 12).toString()).toBe('1/2');
    });

    it('lleva el signo al numerador', () => {
      expect(Duration.of(1, -4).toString()).toBe('-1/4');
      expect(Duration.of(-1, -4).toString()).toBe('1/4');
    });

    it('rechaza denominador cero y no enteros', () => {
      expect(() => Duration.of(1, 0)).toThrow(DomainError);
      expect(() => Duration.of(1.5, 4)).toThrow(DomainError);
    });

    it('es inmutable', () => {
      const d = Duration.QUARTER;
      expect(Object.isFrozen(d)).toBe(true);
    });
  });

  describe('aritmetica exacta', () => {
    it('suma sin perdida', () => {
      expect(Duration.QUARTER.plus(Duration.EIGHTH).toString()).toBe('3/8');
    });

    it('resta sin perdida', () => {
      expect(Duration.HALF.minus(Duration.EIGHTH).toString()).toBe('3/8');
    });

    // Esta es LA razon de ser de la clase: en flotantes,
    // 1/12 + 1/12 + 1/12 === 0.25 es false.
    it('tres tresillos de corchea suman exactamente una negra', () => {
      const tripletEighth = Duration.EIGHTH.tuplet(3, 2);
      expect(tripletEighth.toString()).toBe('1/12');

      const total = sumDurations([tripletEighth, tripletEighth, tripletEighth]);
      expect(total.equals(Duration.QUARTER)).toBe(true);
      expect(total.toString()).toBe('1/4');
    });

    it('no acumula deriva en 2000 compases de tresillos', () => {
      const tripletEighth = Duration.EIGHTH.tuplet(3, 2);
      let position = Duration.ZERO;
      // 2000 compases de 4/4, cada uno con 12 tresillos de corchea
      for (let i = 0; i < 2000 * 12; i++) {
        position = position.plus(tripletEighth);
      }
      expect(position.equals(Duration.of(2000, 1))).toBe(true);
    });

    it('quintillos y septillos tambien cierran exacto', () => {
      const quintuplet = Duration.SIXTEENTH.tuplet(5, 4);
      expect(sumDurations(Array(5).fill(quintuplet)).equals(Duration.QUARTER)).toBe(true);

      const septuplet = Duration.SIXTEENTH.tuplet(7, 4);
      expect(sumDurations(Array(7).fill(septuplet)).equals(Duration.QUARTER)).toBe(true);
    });
  });

  describe('puntillos', () => {
    it('un puntillo suma la mitad', () => {
      expect(Duration.QUARTER.dotted().toString()).toBe('3/8');
      expect(Duration.HALF.dotted().toString()).toBe('3/4');
    });

    it('dos puntillos suman mitad mas cuarto', () => {
      expect(Duration.QUARTER.dotted(2).toString()).toBe('7/16');
    });

    it('cero puntillos no cambia nada', () => {
      expect(Duration.QUARTER.dotted(0).equals(Duration.QUARTER)).toBe(true);
    });

    it('rechaza cantidades absurdas', () => {
      expect(() => Duration.QUARTER.dotted(9)).toThrow(DomainError);
      expect(() => Duration.QUARTER.dotted(-1)).toThrow(DomainError);
    });
  });

  describe('comparacion', () => {
    it('ordena correctamente', () => {
      expect(Duration.EIGHTH.lessThan(Duration.QUARTER)).toBe(true);
      expect(Duration.HALF.greaterThan(Duration.QUARTER)).toBe(true);
      expect(Duration.of(2, 8).equals(Duration.QUARTER)).toBe(true);
    });

    it('compara fracciones no reducibles entre si', () => {
      // 3/8 vs 1/3: 3*3=9 > 1*8=8
      expect(Duration.of(3, 8).greaterThan(Duration.of(1, 3))).toBe(true);
    });
  });

  describe('conversion a ticks', () => {
    it('negra a ppq=480 son 480 ticks', () => {
      expect(Duration.QUARTER.toTicks(480)).toBe(480);
      expect(Duration.WHOLE.toTicks(480)).toBe(1920);
    });

    it('el tresillo de corchea es exacto a ppq=480', () => {
      const t = Duration.EIGHTH.tuplet(3, 2);
      expect(t.toTicks(480)).toBe(160);
      expect(t.isExactInTicks(480)).toBe(true);
    });

    it('el quintillo tambien es exacto a ppq=480', () => {
      // 1/20 de redonda -> 4*480/20 = 96 ticks justos.
      expect(Duration.SIXTEENTH.tuplet(5, 4).toTicks(480)).toBe(96);
      expect(Duration.SIXTEENTH.tuplet(5, 4).isExactInTicks(480)).toBe(true);
    });

    it('detecta duraciones que NO caen en la rejilla', () => {
      // El septillo (1/28) necesita un ppq multiplo de 7; 480 no lo es.
      const septuplet = Duration.SIXTEENTH.tuplet(7, 4);
      expect(septuplet.toString()).toBe('1/28');
      expect(septuplet.isExactInTicks(480)).toBe(false);
      expect(septuplet.isExactInTicks(1680)).toBe(true);
    });

    it('ida y vuelta por ticks', () => {
      expect(Duration.fromTicks(480, 480).equals(Duration.QUARTER)).toBe(true);
      expect(Duration.fromTicks(720, 480).equals(Duration.QUARTER.dotted())).toBe(true);
    });
  });

  describe('conversion a numero', () => {
    it('expone valor en redondas y en negras', () => {
      expect(Duration.QUARTER.value).toBe(0.25);
      expect(Duration.QUARTER.quarters).toBe(1);
      expect(Duration.WHOLE.quarters).toBe(4);
    });

    it('se puede ordenar con valueOf', () => {
      const sorted = [Duration.HALF, Duration.SIXTEENTH, Duration.QUARTER].sort(
        (a, b) => a.valueOf() - b.valueOf(),
      );
      expect(sorted.map(String)).toEqual(['1/16', '1/4', '1/2']);
    });
  });
});
