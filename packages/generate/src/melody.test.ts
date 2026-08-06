import { Duration, Pitch } from '@sinfo/core';
import { Chord, Scale } from '@sinfo/theory';
import { describe, expect, it } from 'vitest';
import { preferStepwise, withinRange, type MelodyConstraint } from './constraints.js';
import { generateMelody, type MelodyOptions } from './melody.js';

const cMajor = Scale.of('C', 'major');

function options(overrides: Partial<MelodyOptions> = {}): MelodyOptions {
  return {
    scale: cMajor,
    lowest: Pitch.parse('C4'),
    highest: Pitch.parse('C6'),
    totalDuration: Duration.of(4, 1),
    seed: 'prueba',
    ...overrides,
  };
}

const midis = (result: { motif: { pitches: Pitch[] } }): number[] =>
  result.motif.pitches.map((p) => p.midi);

describe('generateMelody', () => {
  describe('reproducibilidad', () => {
    it('la misma semilla da exactamente la misma melodia', () => {
      const a = generateMelody(options({ seed: 'tema-a' }));
      const b = generateMelody(options({ seed: 'tema-a' }));
      expect(a.notation).toBe(b.notation);
    });

    it('semillas distintas dan melodias distintas', () => {
      const a = generateMelody(options({ seed: 'tema-a' }));
      const b = generateMelody(options({ seed: 'tema-b' }));
      expect(a.notation).not.toBe(b.notation);
    });

    // Lo que hace util la semilla: poder cambiar una cosa sin perder el resto.
    it('cambiar el contorno conserva el ritmo', () => {
      const a = generateMelody(options({ seed: 'fijo', contour: 'arch' }));
      const b = generateMelody(options({ seed: 'fijo', contour: 'descending' }));

      const rhythmOf = (r: typeof a): string[] =>
        r.motif.events.map((e) => e.duration.toString());

      expect(rhythmOf(a)).toEqual(rhythmOf(b));
      expect(a.notation).not.toBe(b.notation);
    });

    it('devuelve la semilla usada para poder repetirla', () => {
      expect(generateMelody(options({ seed: 'recordar' })).seed).toBe('recordar');
    });
  });

  describe('duracion', () => {
    it('cuadra exactamente con la pedida', () => {
      for (const total of [Duration.of(2, 1), Duration.of(7, 2), Duration.of(3, 4)]) {
        const result = generateMelody(options({ totalDuration: total }));
        expect(result.motif.duration.equals(total), total.toString()).toBe(true);
      }
    });

    it('usa solo las figuras permitidas', () => {
      const result = generateMelody(options({ rhythm: ['h'], totalDuration: Duration.of(2, 1) }));
      expect(result.motif.events.every((e) => e.duration.toString() === '1/2')).toBe(true);
      expect(result.motif.length).toBe(4);
    });
  });

  describe('rango', () => {
    it('no se sale nunca de los limites', () => {
      const result = generateMelody(
        options({
          lowest: Pitch.parse('G4'),
          highest: Pitch.parse('E5'),
          totalDuration: Duration.of(8, 1),
        }),
      );
      for (const midi of midis(result)) {
        expect(midi).toBeGreaterThanOrEqual(Pitch.parse('G4').midi);
        expect(midi).toBeLessThanOrEqual(Pitch.parse('E5').midi);
      }
    });

    it('falla claro si el rango no contiene ninguna nota de la escala', () => {
      expect(() =>
        generateMelody(
          options({ lowest: Pitch.parse('C#4'), highest: Pitch.parse('C#4') }),
        ),
      ).toThrow(/no tiene ninguna nota/);
    });
  });

  describe('pertenencia a la escala', () => {
    it('todas las notas son de la escala', () => {
      const result = generateMelody(options({ totalDuration: Duration.of(8, 1) }));
      for (const pitch of result.motif.pitches) {
        expect(cMajor.contains(pitch), `${pitch.name} fuera de Do mayor`).toBe(true);
      }
    });

    it('funciona igual en menor armonica', () => {
      const harmonic = Scale.of('A', 'harmonicMinor');
      const result = generateMelody(options({ scale: harmonic, totalDuration: Duration.of(4, 1) }));
      for (const pitch of result.motif.pitches) {
        expect(harmonic.contains(pitch), `${pitch.name} fuera de la menor armonica`).toBe(true);
      }
    });
  });

  describe('armonia', () => {
    it('en tiempo fuerte prefiere notas del acorde', () => {
      const chords = [Chord.of('C', 'major'), Chord.of('G', 'dominant7')];
      const result = generateMelody(
        options({
          chords,
          chordDuration: Duration.WHOLE,
          totalDuration: Duration.of(2, 1),
          rhythm: ['q'],
          seed: 'armonia',
        }),
      );

      const onStrong = result.decisions.filter((d) => d.strongBeat);
      expect(onStrong.length).toBeGreaterThan(0);

      const matching = onStrong.filter((decision) => {
        const chord = chords.find((c) => c.symbol === decision.chord);
        return chord?.contains(Pitch.parse(decision.pitch)) ?? false;
      });
      // No es una regla absoluta, pero debe dominar con claridad.
      expect(matching.length / onStrong.length).toBeGreaterThan(0.75);
    });

    it('registra que acorde regia en cada nota', () => {
      const result = generateMelody(
        options({
          chords: [Chord.of('C', 'major'), Chord.of('F', 'major')],
          totalDuration: Duration.of(2, 1),
        }),
      );
      const seen = new Set(result.decisions.map((d) => d.chord));
      expect(seen).toContain('C');
      expect(seen).toContain('F');
    });
  });

  describe('contorno', () => {
    it('el ascendente termina mas arriba de donde empieza', () => {
      // Se promedian varias semillas: el contorno guia, no impone.
      let ascending = 0;
      for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
        const result = generateMelody(
          options({ seed, contour: 'ascending', totalDuration: Duration.of(8, 1) }),
        );
        const notes = midis(result);
        const firstQuarter = average(notes.slice(0, Math.floor(notes.length / 4)));
        const lastQuarter = average(notes.slice(-Math.floor(notes.length / 4)));
        if (lastQuarter > firstQuarter) ascending++;
      }
      expect(ascending).toBeGreaterThanOrEqual(5);
    });

    it('el arco culmina por el medio', () => {
      let arched = 0;
      for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
        const result = generateMelody(
          options({ seed, contour: 'arch', totalDuration: Duration.of(8, 1) }),
        );
        const notes = midis(result);
        const third = Math.floor(notes.length / 3);
        const middle = average(notes.slice(third, third * 2));
        const edges = average([...notes.slice(0, third), ...notes.slice(third * 2)]);
        if (middle > edges) arched++;
      }
      expect(arched).toBeGreaterThanOrEqual(5);
    });
  });

  describe('calidad melodica', () => {
    it('predomina el grado conjunto sobre el salto', () => {
      const result = generateMelody(options({ totalDuration: Duration.of(8, 1), seed: 'lineal' }));
      const notes = midis(result);

      let steps = 0;
      for (let i = 1; i < notes.length; i++) {
        if (Math.abs(notes[i]! - notes[i - 1]!) <= 2) steps++;
      }
      expect(steps / (notes.length - 1)).toBeGreaterThan(0.5);
    });

    it('no encadena saltos grandes en la misma direccion', () => {
      const result = generateMelody(options({ totalDuration: Duration.of(12, 1), seed: 'saltos' }));
      const notes = midis(result);

      let chained = 0;
      for (let i = 2; i < notes.length; i++) {
        const first = notes[i - 1]! - notes[i - 2]!;
        const second = notes[i]! - notes[i - 1]!;
        if (Math.abs(first) > 4 && Math.abs(second) > 4 && Math.sign(first) === Math.sign(second)) {
          chained++;
        }
      }
      expect(chained / notes.length).toBeLessThan(0.06);
    });

    it('termina en una nota estable', () => {
      let stable = 0;
      for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
        const result = generateMelody(options({ seed, totalDuration: Duration.of(4, 1) }));
        const last = result.motif.pitches.at(-1)!;
        if (cMajor.degreeOf(last) === 1 || cMajor.degreeOf(last) === 3 || cMajor.degreeOf(last) === 5) {
          stable++;
        }
      }
      expect(stable).toBeGreaterThanOrEqual(6);
    });
  });

  describe('silencios', () => {
    it('los inserta con la probabilidad pedida', () => {
      const result = generateMelody(
        options({ restProbability: 0.35, totalDuration: Duration.of(16, 1) }),
      );
      const rests = result.motif.events.filter((e) => e.pitches.length === 0);
      expect(rests.length).toBeGreaterThan(0);
      expect(rests.length).toBeLessThan(result.motif.length);
    });

    it('sin probabilidad no aparece ninguno', () => {
      const result = generateMelody(options({ totalDuration: Duration.of(8, 1) }));
      expect(result.motif.events.every((e) => e.pitches.length > 0)).toBe(true);
    });
  });

  describe('restricciones a medida', () => {
    it('acepta un conjunto propio', () => {
      const onlyC: MelodyConstraint = {
        name: 'solo-do',
        score: (candidate) => (candidate.step === 'C' ? 1 : 0),
      };
      const result = generateMelody(
        options({ constraints: [withinRange, onlyC], totalDuration: Duration.of(2, 1) }),
      );
      expect(result.motif.pitches.every((p) => p.step === 'C')).toBe(true);
    });

    it('con menos restricciones sigue funcionando', () => {
      const result = generateMelody(
        options({ constraints: [withinRange, preferStepwise], totalDuration: Duration.of(2, 1) }),
      );
      expect(result.motif.length).toBeGreaterThan(0);
    });

    // Una restriccion imposible no debe reventar: mejor musica imperfecta.
    it('si nada pasa el filtro, relaja en vez de fallar', () => {
      const impossible: MelodyConstraint = { name: 'imposible', score: () => 0 };
      const result = generateMelody(
        options({ constraints: [impossible], totalDuration: Duration.WHOLE }),
      );
      expect(result.motif.length).toBeGreaterThan(0);
    });
  });
});

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}
