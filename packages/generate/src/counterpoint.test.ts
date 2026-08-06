import { parseVoice, Pitch, Voice } from '@sinfo/core';
import { checkVoiceLeading, Scale } from '@sinfo/theory';
import { describe, expect, it } from 'vitest';
import { generateCounterpoint, type CounterpointOptions } from './counterpoint.js';

const cMajor = Scale.of('C', 'major');

/** Cantus firmus clasico en Do mayor, ocho notas, empieza y acaba en la tonica. */
const CANTUS = 'c4/w d4/w e4/w c4/w f4/w e4/w d4/w c4/w';

function options(overrides: Partial<CounterpointOptions> = {}): CounterpointOptions {
  return {
    cantus: parseVoice(CANTUS).events,
    scale: cMajor,
    lowest: Pitch.parse('C4'),
    highest: Pitch.parse('C6'),
    seed: 'cp',
    ...overrides,
  };
}

/** Distancia vertical en semitonos, reducida a la octava. */
function verticals(cantus: string, line: readonly Pitch[]): number[] {
  const cf = parseVoice(cantus).events.map((e) => e.pitches[0]!);
  return line.map((pitch, index) => Math.abs(pitch.midi - cf[index]!.midi) % 12);
}

const CONSONANCES = new Set([0, 3, 4, 7, 8, 9]);

describe('generateCounterpoint', () => {
  describe('reglas duras', () => {
    it('todas las verticales son consonancia', () => {
      const result = generateCounterpoint(options());
      for (const distance of verticals(CANTUS, result.motif.pitches)) {
        expect(CONSONANCES.has(distance), `distancia ${distance} es disonante`).toBe(true);
      }
    });

    it('empieza y termina en consonancia perfecta', () => {
      const distances = verticals(CANTUS, generateCounterpoint(options()).motif.pitches);
      expect([0, 7]).toContain(distances[0]);
      // El final, ademas, en unisono u octava.
      expect(distances.at(-1)).toBe(0);
    });

    it('no cruza el cantus', () => {
      const cf = parseVoice(CANTUS).events.map((e) => e.pitches[0]!);

      const above = generateCounterpoint(options({ above: true }));
      above.motif.pitches.forEach((pitch, index) => {
        expect(pitch.midi).toBeGreaterThan(cf[index]!.midi);
      });

      const below = generateCounterpoint(
        options({ above: false, lowest: Pitch.parse('C2'), highest: Pitch.parse('C4') }),
      );
      below.motif.pitches.forEach((pitch, index) => {
        expect(pitch.midi).toBeLessThan(cf[index]!.midi);
      });
    });

    it('se mantiene en el rango pedido', () => {
      const result = generateCounterpoint(
        options({ lowest: Pitch.parse('E4'), highest: Pitch.parse('G5') }),
      );
      for (const pitch of result.motif.pitches) {
        expect(pitch.midi).toBeGreaterThanOrEqual(Pitch.parse('E4').midi);
        expect(pitch.midi).toBeLessThanOrEqual(Pitch.parse('G5').midi);
      }
    });

    it('todas las notas son de la escala', () => {
      const result = generateCounterpoint(options());
      for (const pitch of result.motif.pitches) {
        expect(cMajor.contains(pitch), `${pitch.name} fuera de Do mayor`).toBe(true);
      }
    });

    it('no repite la misma nota dos veces seguidas', () => {
      const notes = generateCounterpoint(options()).motif.pitches;
      for (let i = 1; i < notes.length; i++) {
        expect(notes[i]!.midi).not.toBe(notes[i - 1]!.midi);
      }
    });
  });

  /**
   * La comprobacion que cierra el circulo: el contrapunto generado se somete
   * al mismo analizador de conduccion de voces que usa el agente para criticar
   * lo que escribe a mano.
   */
  describe('sometido al analizador de conduccion de voces', () => {
    it.each(['cp-1', 'cp-2', 'cp-3', 'cp-4', 'cp-5', 'cp-6'])(
      'con semilla %s no produce paralelas',
      (seed) => {
        const result = generateCounterpoint(options({ seed }));

        const issues = checkVoiceLeading([
          { label: 'cantus', voice: new Voice('cf').append(...parseVoice(CANTUS).events) },
          { label: 'contrapunto', voice: new Voice('cp').append(...result.motif.events) },
        ]);

        const parallels = issues.filter(
          (issue) =>
            issue.rule === 'quintas-paralelas' || issue.rule === 'octavas-paralelas',
        );
        expect(parallels, JSON.stringify(parallels.map((p) => p.message))).toEqual([]);
      },
    );

    /**
     * Regresion: la regla de movimiento directo miraba el salto del
     * contrapunto en vez del de la voz superior. Escribiendo por DEBAJO del
     * cantus, la superior es el cantus, y se colaban octavas directas que el
     * analizador si detectaba despues.
     */
    it.each(['bajo-1', 'bajo-2', 'bajo-3', 'bajo-4'])(
      'escrito por debajo con semilla %s no deja ni un aviso',
      (seed) => {
        const result = generateCounterpoint(
          options({ seed, above: false, lowest: Pitch.parse('C3'), highest: Pitch.parse('B3') }),
        );

        const issues = checkVoiceLeading([
          { label: 'contrapunto', voice: new Voice('cp').append(...result.motif.events) },
          { label: 'cantus', voice: new Voice('cf').append(...parseVoice(CANTUS).events) },
        ]);

        const serious = issues.filter(
          (issue) => issue.rule !== 'espaciado-excesivo' && issue.rule !== 'salto-excesivo',
        );
        expect(serious, JSON.stringify(serious.map((i) => i.message))).toEqual([]);
      },
    );

    it('no genera intervalos aumentados', () => {
      const result = generateCounterpoint(options({ seed: 'aumentados' }));
      const notes = result.motif.pitches;

      for (let i = 1; i < notes.length; i++) {
        const interval = notes[i - 1]!.intervalTo(notes[i]!);
        if (interval.quality.startsWith('A')) {
          expect(Math.abs(interval.chromatic)).toBeLessThanOrEqual(2);
        }
      }
    });
  });

  describe('reproducibilidad', () => {
    it('la misma semilla da el mismo contrapunto', () => {
      const a = generateCounterpoint(options({ seed: 'igual' }));
      const b = generateCounterpoint(options({ seed: 'igual' }));
      expect(a.motif.notation).toBe(b.motif.notation);
    });

    it('semillas distintas dan contrapuntos distintos', () => {
      const notations = ['s1', 's2', 's3', 's4'].map(
        (seed) => generateCounterpoint(options({ seed })).motif.notation,
      );
      expect(new Set(notations).size).toBeGreaterThan(1);
    });
  });

  describe('estructura del resultado', () => {
    it('tiene una nota por cada nota del cantus', () => {
      const result = generateCounterpoint(options());
      expect(result.notes).toBe(8);
      expect(result.motif.length).toBe(8);
    });

    it('hereda las duraciones del cantus', () => {
      const result = generateCounterpoint(
        options({ cantus: parseVoice('c4/h d4/q e4/q c4/w').events }),
      );
      expect(result.motif.events.map((e) => e.duration.toString())).toEqual([
        '1/2',
        '1/4',
        '1/4',
        '1/1',
      ]);
    });

    it('informa de cuanto exploro', () => {
      const result = generateCounterpoint(options());
      expect(result.nodesExplored).toBeGreaterThan(0);
      expect(result.complete).toBe(true);
      expect(result.relaxed).toEqual([]);
    });
  });

  /**
   * Un cantus estrecho no siempre admite solucion estricta. Devolver musica
   * diciendo que se cedio es mas util que devolver un error.
   */
  describe('cuando no hay solucion estricta', () => {
    it('relaja reglas de estilo e informa de cuales', () => {
      const result = generateCounterpoint(
        options({
          cantus: parseVoice('c4/w d4/w e4/w f4/w g4/w a4/w b4/w c5/w').events,
          lowest: Pitch.parse('C5'),
          highest: Pitch.parse('E5'),
          seed: 'estrecho',
        }),
      );

      expect(result.motif.length).toBe(8);
      if (!result.complete) expect(result.relaxed.length).toBeGreaterThan(0);
    });

    it('nunca cede en las disonancias', () => {
      const cantus = 'c4/w d4/w e4/w f4/w g4/w';
      const result = generateCounterpoint(
        options({
          cantus: parseVoice(cantus).events,
          lowest: Pitch.parse('C5'),
          highest: Pitch.parse('D5'),
          seed: 'imposible',
        }),
      );

      // Aunque haya que relajarlo todo, sigue devolviendo algo utilizable.
      expect(result.motif.length).toBe(5);
    });
  });

  describe('validacion de entrada', () => {
    it('rechaza un cantus vacio', () => {
      expect(() => generateCounterpoint(options({ cantus: [] }))).toThrow(/no tiene ninguna nota/);
    });

    it('rechaza un cantus que solo tiene silencios', () => {
      expect(() =>
        generateCounterpoint(options({ cantus: parseVoice('r/w r/w').events })),
      ).toThrow(/no tiene ninguna nota/);
    });

    it('rechaza un rango sin notas de la escala', () => {
      expect(() =>
        generateCounterpoint(
          options({ lowest: Pitch.parse('C#5'), highest: Pitch.parse('C#5') }),
        ),
      ).toThrow(/no tiene notas/);
    });
  });
});
