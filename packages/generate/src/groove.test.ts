import { Duration, note, parseVoice } from '@sinfo/core';
import { describe, expect, it } from 'vitest';
import { GROOVE_PRESETS, getGroove, humanize, listGrooves, type PerformedNote } from './groove.js';

/** Convierte SinfoScript en notas colocadas, con velocity fija. */
function played(source: string, velocity = 80): PerformedNote[] {
  const events = parseVoice(source).events;
  const result: PerformedNote[] = [];
  let position = Duration.ZERO;
  for (const event of events) {
    if (event.pitches.length > 0) {
      result.push({ position, duration: event.duration, velocity, event });
    }
    position = position.plus(event.duration);
  }
  return result;
}

const positions = (notes: readonly PerformedNote[]): string[] =>
  notes.map((n) => n.position.toString());

describe('humanize', () => {
  it('sin groove ni desorden no cambia nada', () => {
    const source = played('c4/e d4/e e4/e f4/e');
    const result = humanize(source);
    expect(positions(result)).toEqual(positions(source));
  });

  describe('swing', () => {
    /**
     * El swing de tresillo reparte el par de corcheas en dos tercios y un
     * tercio: la segunda del par se retrasa de 1/8 a 1/6 de redonda.
     */
    it('retrasa la segunda corchea del par', () => {
      const result = humanize(played('c4/e d4/e e4/e f4/e'), {
        groove: GROOVE_PRESETS['swing']!,
      });
      expect(positions(result)).toEqual(['0/1', '1/6', '1/4', '5/12']);
    });

    it('no mueve las corcheas en tiempo fuerte', () => {
      const result = humanize(played('c4/e d4/e e4/e f4/e'), {
        groove: GROOVE_PRESETS['swing']!,
      });
      expect(result[0]!.position.toString()).toBe('0/1');
      expect(result[2]!.position.toString()).toBe('1/4');
    });

    it('el groove recto deja las posiciones intactas', () => {
      const source = played('c4/e d4/e e4/e f4/e');
      const result = humanize(source, { groove: GROOVE_PRESETS['straight']! });
      expect(positions(result)).toEqual(positions(source));
    });

    it('el shuffle balancea semicorcheas, no corcheas', () => {
      const conCorcheas = humanize(played('c4/e d4/e'), { groove: GROOVE_PRESETS['shuffle']! });
      // Las corcheas no son la unidad del shuffle: no se mueven.
      expect(conCorcheas[1]!.position.toString()).toBe('1/8');

      const conSemis = humanize(played('c4/s d4/s'), { groove: GROOVE_PRESETS['shuffle']! });
      expect(conSemis[1]!.position.toString()).not.toBe('1/16');
    });

    it('las notas no se salen del orden', () => {
      const result = humanize(played('c4/e d4/e e4/e f4/e g4/e a4/e'), {
        groove: GROOVE_PRESETS['swing']!,
      });
      for (let i = 1; i < result.length; i++) {
        expect(result[i]!.position.greaterThan(result[i - 1]!.position)).toBe(true);
      }
    });
  });

  describe('acentos', () => {
    it('el primer tiempo pesa mas que los demas', () => {
      const result = humanize(played('c4/q d4/q e4/q f4/q'), {
        groove: GROOVE_PRESETS['funk']!,
        measureDuration: Duration.WHOLE,
      });
      expect(result[0]!.velocity).toBeGreaterThan(result[1]!.velocity);
      expect(result[0]!.velocity).toBeGreaterThan(result[3]!.velocity);
    });

    it('el swing acentua los tiempos debiles, como en el jazz', () => {
      const result = humanize(played('c4/q d4/q e4/q f4/q'), {
        groove: GROOVE_PRESETS['swing']!,
        measureDuration: Duration.WHOLE,
      });
      // En swing pesan el 2 y el 4, no el 1 y el 3.
      expect(result[1]!.velocity).toBeGreaterThan(result[0]!.velocity);
      expect(result[3]!.velocity).toBeGreaterThan(result[2]!.velocity);
    });

    it('el vals carga el primer tiempo de los tres', () => {
      const result = humanize(played('c4/q d4/q e4/q'), {
        groove: GROOVE_PRESETS['waltz']!,
        measureDuration: Duration.of(3, 4),
      });
      expect(result[0]!.velocity).toBeGreaterThan(result[1]!.velocity);
      expect(result[0]!.velocity).toBeGreaterThan(result[2]!.velocity);
    });

    it('el acento se repite cada compas', () => {
      const result = humanize(played('c4/q d4/q e4/q f4/q g4/q a4/q b4/q c5/q'), {
        groove: GROOVE_PRESETS['funk']!,
        measureDuration: Duration.WHOLE,
      });
      expect(result[4]!.velocity).toBe(result[0]!.velocity);
    });
  });

  describe('empuje', () => {
    it('el groove atrasado retrasa todo', () => {
      const source = played('c4/q d4/q');
      const result = humanize(source, { groove: GROOVE_PRESETS['laid_back']! });
      expect(result[0]!.position.greaterThan(source[0]!.position)).toBe(true);
    });

    it('el adelantado no deja ninguna nota en posicion negativa', () => {
      const result = humanize(played('c4/q d4/q'), { groove: GROOVE_PRESETS['driving']! });
      expect(result[0]!.position.isNegative).toBe(false);
      expect(result[0]!.position.toString()).toBe('0/1');
    });
  });

  describe('humanizacion', () => {
    it('descuadra el tiempo y varia la intensidad', () => {
      const source = played('c4/q d4/q e4/q f4/q g4/q a4/q b4/q c5/q');
      const result = humanize(source, { amount: 0.6, seed: 'humano' });

      const movidas = result.filter((n, i) => !n.position.equals(source[i]!.position));
      const cambiadas = result.filter((n) => n.velocity !== 80);
      expect(movidas.length).toBeGreaterThan(0);
      expect(cambiadas.length).toBeGreaterThan(0);
    });

    it('mas cantidad desordena mas', () => {
      const source = played('c4/q d4/q e4/q f4/q g4/q a4/q b4/q c5/q');
      const spread = (amount: number): number =>
        humanize(source, { amount, seed: 'igual' }).reduce(
          (total, n, i) => total + Math.abs(n.position.minus(source[i]!.position).value),
          0,
        );
      expect(spread(0.8)).toBeGreaterThan(spread(0.2));
    });

    it('la misma semilla da la misma interpretacion', () => {
      const source = played('c4/q d4/q e4/q f4/q');
      const a = humanize(source, { amount: 0.5, seed: 'igual' });
      const b = humanize(source, { amount: 0.5, seed: 'igual' });
      expect(positions(a)).toEqual(positions(b));
      expect(a.map((n) => n.velocity)).toEqual(b.map((n) => n.velocity));
    });

    it('semillas distintas dan interpretaciones distintas', () => {
      const source = played('c4/q d4/q e4/q f4/q');
      const a = humanize(source, { amount: 0.5, seed: 'uno' });
      const b = humanize(source, { amount: 0.5, seed: 'dos' });
      expect(positions(a)).not.toEqual(positions(b));
    });

    it('la velocity nunca se sale del rango MIDI', () => {
      const extremos = [
        ...played('c4/q d4/q e4/q f4/q', 1),
        ...played('c4/q d4/q e4/q f4/q', 127),
      ];
      for (const n of humanize(extremos, { amount: 1, seed: 'extremo' })) {
        expect(n.velocity).toBeGreaterThanOrEqual(1);
        expect(n.velocity).toBeLessThanOrEqual(127);
      }
    });

    it('ninguna nota se adelanta del inicio de la obra', () => {
      for (const n of humanize(played('c4/q d4/q'), { amount: 1, seed: 'inicio' })) {
        expect(n.position.isNegative).toBe(false);
      }
    });

    it('conserva las duraciones escritas', () => {
      const source = played('c4/q d4/e e4/h');
      const result = humanize(source, { amount: 0.7, seed: 'duraciones' });
      expect(result.map((n) => n.duration.toString())).toEqual(['1/4', '1/8', '1/2']);
    });
  });

  it('una lista vacia no rompe nada', () => {
    expect(humanize([], { amount: 0.5 })).toEqual([]);
  });

  it('con una sola nota tampoco', () => {
    const one = [{ position: Duration.ZERO, duration: Duration.WHOLE, velocity: 80, event: note('C4', Duration.WHOLE) }];
    expect(humanize(one, { amount: 0.5, seed: 'sola' })).toHaveLength(1);
  });
});

describe('catalogo de grooves', () => {
  it('los lista con su descripcion', () => {
    const grooves = listGrooves();
    expect(grooves.length).toBeGreaterThanOrEqual(7);
    for (const groove of grooves) {
      expect(groove.name).toBeTruthy();
      expect(groove.description.length).toBeGreaterThan(20);
    }
  });

  it('se recuperan por id', () => {
    expect(getGroove('swing')?.swing).toEqual([2, 3]);
    expect(getGroove('inventado')).toBeUndefined();
  });

  it.each(Object.entries(GROOVE_PRESETS))('%s tiene datos coherentes', (id, groove) => {
    const [num, den] = groove.swing;
    expect(num / den, id).toBeGreaterThanOrEqual(0.5);
    expect(num / den, id).toBeLessThan(0.85);
    expect(groove.accents.length, id).toBeGreaterThan(0);
  });
});
