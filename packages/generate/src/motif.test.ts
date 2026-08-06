import { Duration, Interval, Pitch } from '@sinfo/core';
import { Scale } from '@sinfo/theory';
import { describe, expect, it } from 'vitest';
import { Motif } from './motif.js';
import { Random } from './random.js';

const cMajor = Scale.of('C', 'major');
const names = (motif: Motif): string[] => motif.pitches.map((p) => p.name);

describe('Random', () => {
  it('la misma semilla da exactamente la misma secuencia', () => {
    const a = new Random('tema-principal');
    const b = new Random('tema-principal');
    const first = Array.from({ length: 20 }, () => a.next());
    const second = Array.from({ length: 20 }, () => b.next());
    expect(first).toEqual(second);
  });

  it('semillas distintas dan secuencias distintas', () => {
    const a = Array.from({ length: 10 }, () => new Random('tema-1').next());
    const b = Array.from({ length: 10 }, () => new Random('tema-2').next());
    expect(a).not.toEqual(b);
  });

  // Si semillas parecidas arrancaran cerca, cambiar de semilla no cambiaria
  // la musica de verdad.
  it('semillas contiguas divergen desde el primer numero', () => {
    const a = new Random('tema-1').next();
    const b = new Random('tema-2').next();
    expect(Math.abs(a - b)).toBeGreaterThan(0.05);
  });

  it('se mantiene en el rango [0, 1)', () => {
    const random = new Random('rango');
    for (let i = 0; i < 1000; i++) {
      const value = random.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('int respeta los limites, ambos incluidos', () => {
    const random = new Random('enteros');
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(random.int(1, 4));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it('weighted respeta las proporciones', () => {
    const random = new Random('pesos');
    let a = 0;
    for (let i = 0; i < 2000; i++) {
      if (random.weighted([{ value: 'a', weight: 3 }, { value: 'b', weight: 1 }]) === 'a') a++;
    }
    expect(a / 2000).toBeGreaterThan(0.7);
    expect(a / 2000).toBeLessThan(0.8);
  });

  it('el peso cero prohibe el candidato', () => {
    const random = new Random('prohibido');
    for (let i = 0; i < 200; i++) {
      expect(random.weighted([{ value: 'si', weight: 1 }, { value: 'no', weight: 0 }])).toBe('si');
    }
  });

  it('shuffle no toca el original y conserva los elementos', () => {
    const original = [1, 2, 3, 4, 5];
    const shuffled = new Random('barajar').shuffle(original);
    expect(original).toEqual([1, 2, 3, 4, 5]);
    expect([...shuffled].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  /**
   * Lo que evita el efecto domino: tocar el algoritmo de la melodia no debe
   * mover los numeros que consume el ritmo.
   */
  describe('sub-flujos por etiqueta', () => {
    it('cada etiqueta da un flujo distinto', () => {
      const base = new Random('obra');
      expect(base.fork('melodia').next()).not.toBe(base.fork('ritmo').next());
    });

    it('el sub-flujo es estable aunque el padre haya avanzado', () => {
      const a = new Random('obra');
      const primero = a.fork('ritmo').next();

      const b = new Random('obra');
      for (let i = 0; i < 50; i++) b.next();
      expect(b.fork('ritmo').next()).toBe(primero);
    });
  });
});

describe('Motif', () => {
  it('se construye desde SinfoScript y vuelve a el', () => {
    const motif = Motif.parse('c4/q e4/q g4/h');
    expect(motif.length).toBe(3);
    expect(motif.duration.toString()).toBe('1/1');
    expect(motif.notation).toBe('C4/q E4/q G4/h');
  });

  it('mide su ambito', () => {
    expect(Motif.parse('c4/q e4/q g4/q').range).toBe(7);
    expect(Motif.parse('r/q').range).toBe(0);
  });

  describe('transposicion', () => {
    it('conserva la escritura correcta', () => {
      const motif = Motif.parse('c4/q e4/q g4/q').transposed(Interval.PERFECT_FIFTH);
      expect(names(motif)).toEqual(['G4', 'B4', 'D5']);
    });

    it('no altera el motivo original', () => {
      const original = Motif.parse('c4/q e4/q');
      original.transposed(Interval.OCTAVE);
      expect(names(original)).toEqual(['C4', 'E4']);
    });
  });

  describe('inversion', () => {
    it('la cromatica da la vuelta a cada intervalo exactamente', () => {
      // Do-Mi-Sol (3aM arriba, 3am arriba) invertido sobre Do:
      // Do-Lab-Fa (3aM abajo, 3am abajo).
      const motif = Motif.parse('c4/q e4/q g4/q').inverted();
      expect(names(motif)).toEqual(['C4', 'Ab3', 'F3']);
    });

    // La tonal es la que se usa en musica tonal: el resultado sigue en la
    // tonalidad, y por eso el motivo invertido suena emparentado.
    it('la tonal se queda dentro de la escala', () => {
      const motif = Motif.parse('c4/q e4/q g4/q').invertedInScale(cMajor);
      expect(names(motif)).toEqual(['C4', 'A3', 'F3']);
      for (const pitch of motif.pitches) {
        expect(cMajor.contains(pitch), `${pitch.name} fuera de Do mayor`).toBe(true);
      }
    });

    it('acepta un eje distinto de la primera nota', () => {
      const motif = Motif.parse('c4/q e4/q').invertedInScale(cMajor, Pitch.parse('G4'));
      expect(names(motif)).toEqual(['D5', 'B4']);
    });

    it('invertir dos veces devuelve el original', () => {
      const original = Motif.parse('c4/q e4/q g4/q');
      expect(names(original.inverted().inverted())).toEqual(names(original));
    });

    it('los silencios pasan intactos', () => {
      const motif = Motif.parse('c4/q r/q e4/q').invertedInScale(cMajor);
      expect(motif.length).toBe(3);
      expect(motif.events[1]!.pitches).toHaveLength(0);
    });
  });

  describe('retrogradacion', () => {
    it('invierte el orden con sus duraciones', () => {
      const motif = Motif.parse('c4/q e4/e g4/h');
      const retro = motif.retrograded();
      expect(names(retro)).toEqual(['G4', 'E4', 'C4']);
      expect(retro.events.map((e) => e.duration.toString())).toEqual(['1/2', '1/8', '1/4']);
    });

    it('aplicada dos veces devuelve el original', () => {
      const original = Motif.parse('c4/q e4/e g4/h');
      expect(original.retrograded().retrograded().notation).toBe(original.notation);
    });
  });

  describe('aumentacion y disminucion', () => {
    it('escalan las duraciones sin tocar las alturas', () => {
      const motif = Motif.parse('c4/q e4/e');
      expect(motif.augmented(2).events.map((e) => e.duration.toString())).toEqual(['1/2', '1/4']);
      expect(motif.diminished(2).events.map((e) => e.duration.toString())).toEqual(['1/8', '1/16']);
      expect(names(motif.augmented(2))).toEqual(['C4', 'E4']);
    });

    it('la duracion total escala con el factor', () => {
      const motif = Motif.parse('c4/q e4/q');
      expect(motif.augmented(3).duration.equals(motif.duration.times(3))).toBe(true);
    });

    it('son inversas la una de la otra', () => {
      const original = Motif.parse('c4/q e4/e g4/s');
      expect(original.augmented(3).diminished(3).notation).toBe(original.notation);
    });
  });

  describe('secuencia', () => {
    it('repite el motivo desplazado por grados de la escala', () => {
      // Do-Mi ascendiendo por segundas: Do-Mi, Re-Fa, Mi-Sol.
      const motif = Motif.parse('c4/q e4/q').sequence(2, Interval.MAJOR_SECOND, cMajor);
      expect(names(motif)).toEqual(['C4', 'E4', 'D4', 'F4', 'E4', 'G4']);
    });

    it('la secuencia diatonica no se sale de la tonalidad', () => {
      const motif = Motif.parse('c4/q e4/q g4/q').sequence(4, Interval.MAJOR_SECOND, cMajor);
      for (const pitch of motif.pitches) {
        expect(cMajor.contains(pitch), `${pitch.name} fuera de Do mayor`).toBe(true);
      }
    });

    it('sin escala desplaza por el intervalo exacto', () => {
      const motif = Motif.parse('c4/q e4/q').sequence(1, Interval.MAJOR_SECOND);
      expect(names(motif)).toEqual(['C4', 'E4', 'D4', 'F#4']);
    });

    it('descendiendo tambien', () => {
      const motif = Motif.parse('g4/q e4/q').sequence(2, Interval.parse('-M2'), cMajor);
      expect(names(motif)).toEqual(['G4', 'E4', 'F4', 'D4', 'E4', 'C4']);
    });
  });

  describe('fragmentacion', () => {
    it('se queda con el trozo pedido', () => {
      const motif = Motif.parse('c4/q d4/q e4/q f4/q');
      expect(names(motif.fragment(0, 2))).toEqual(['C4', 'D4']);
      expect(names(motif.fragment(2, 2))).toEqual(['E4', 'F4']);
    });

    it('recorta si se pide mas de lo que hay', () => {
      const motif = Motif.parse('c4/q d4/q');
      expect(motif.fragment(1, 10).length).toBe(1);
      expect(motif.fragment(5, 2).length).toBe(0);
    });
  });

  describe('genealogia', () => {
    it('registra de donde sale cada variante', () => {
      const motif = Motif.parse('c4/q e4/q')
        .transposed(Interval.PERFECT_FIFTH)
        .retrograded()
        .augmented(2);

      expect(motif.derivation).toEqual([
        'origen',
        'transposicion P5',
        'retrogradacion',
        'aumentacion x2',
      ]);
    });
  });

  describe('composicion de transformaciones', () => {
    it('un desarrollo tematico completo mantiene la longitud esperada', () => {
      // Cabeza de 3 eventos (1/8 + 1/8 + 1/4 = media redonda).
      const head = Motif.parse('c4/e d4/e e4/q');
      expect(head.duration.equals(Duration.HALF)).toBe(true);

      // Secuencia de 3 pasos = 4 copias; aumentada x2 cada copia mide 1;
      // el fragmento de 6 eventos son 2 copias.
      const development = head
        .sequence(3, Interval.MAJOR_SECOND, cMajor)
        .augmented(2)
        .fragment(0, 6);

      expect(development.length).toBe(6);
      expect(development.duration.equals(Duration.of(2, 1))).toBe(true);
    });

    it('el motivo original sobrevive intacto a toda la cadena', () => {
      const head = Motif.parse('c4/e d4/e e4/q');
      head.sequence(3, Interval.MAJOR_SECOND, cMajor).augmented(2).retrograded().inverted();
      expect(head.notation).toBe('C4/e D4/e E4/q');
    });
  });
});
