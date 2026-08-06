import { KeySignature } from '@sinfo/core';
import { describe, expect, it } from 'vitest';
import { estimateKey, pitchClassProfile } from './key-estimate.js';
import { spellPitch, spellSequence, tonalCenter } from './spell.js';

const key = (text: string): KeySignature => KeySignature.parse(text);

/** Nota con peso uniforme, para pruebas donde la duracion no es lo medido. */
const even = (midis: readonly number[]) => midis.map((midi) => ({ midi, weight: 1 }));

describe('estimateKey', () => {
  it('reconoce do mayor en una escala de do', () => {
    const result = estimateKey(even([60, 62, 64, 65, 67, 69, 71, 72]));
    expect(result.key.name).toBe('C major');
  });

  it('reconoce la menor por la sensible alterada', () => {
    // Los mismos grados que do mayor: lo que decide es el sol sostenido y el
    // peso de la tonica.
    const result = estimateKey([
      { midi: 69, weight: 4 },
      { midi: 71, weight: 1 },
      { midi: 72, weight: 1 },
      { midi: 74, weight: 2 },
      { midi: 76, weight: 3 },
      { midi: 77, weight: 1 },
      { midi: 68, weight: 2 },
      { midi: 69, weight: 4 },
    ]);
    expect(result.key.name).toBe('A minor');
  });

  it('pondera por duracion y no por numero de notas', () => {
    // Cuatro fa sostenidos de paso, rapidos, contra un sol largo. Contando
    // cabezas ganaria sol mayor; contando tiempo, do mayor.
    const notes = [
      { midi: 66, weight: 0.05 },
      { midi: 66, weight: 0.05 },
      { midi: 66, weight: 0.05 },
      { midi: 66, weight: 0.05 },
      { midi: 60, weight: 4 },
      { midi: 64, weight: 3 },
      { midi: 67, weight: 3 },
      { midi: 65, weight: 2 },
    ];
    expect(estimateKey(notes).key.name).toBe('C major');
  });

  it('distingue el relativo menor cuando el material lo deja claro', () => {
    // Do mayor y la menor tienen las MISMAS notas: lo unico que las separa es
    // donde reposa la musica. Aqui reposa en la, con la sensible sol
    // sostenido, y eso si es decidible.
    const aMinor = estimateKey([
      { midi: 69, weight: 6 },
      { midi: 72, weight: 2 },
      { midi: 76, weight: 3 },
      { midi: 68, weight: 2 },
      { midi: 71, weight: 1 },
      { midi: 74, weight: 1 },
    ]);
    expect(aMinor.key.name).toBe('A minor');
  });

  it('avisa con poco margen cuando mayor y relativo menor empatan', () => {
    // Escala de do que reposa en mi, la mediante: ni do mayor ni la menor
    // pueden ganar de forma limpia porque comparten todas las notas. Ninguna
    // estimacion de tonalidad resuelve esto, y lo honesto es que el margen lo
    // delate en vez de dar una respuesta firme y equivocada.
    const ambiguous = estimateKey([
      { midi: 60, weight: 1 },
      { midi: 62, weight: 1 },
      { midi: 64, weight: 6 },
      { midi: 65, weight: 2 },
      { midi: 67, weight: 1 },
      { midi: 69, weight: 2 },
      { midi: 71, weight: 2 },
    ]);
    expect(ambiguous.margin).toBeLessThan(0.15);
  });

  it('devuelve do mayor sin notas, que es el defecto del sistema', () => {
    const result = estimateKey([]);
    expect(result.key.name).toBe('C major');
    expect(result.correlation).toBe(0);
  });

  it('avisa con poca correlacion cuando la musica es muy cromatica', () => {
    const chromatic = estimateKey(even([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71]));
    expect(chromatic.correlation).toBeLessThan(0.5);
  });

  it('reparte el perfil por clases de altura', () => {
    const profile = pitchClassProfile([
      { midi: 60, weight: 2 },
      { midi: 72, weight: 3 },
    ]);
    expect(profile[0]).toBe(5);
  });
});

describe('tonalCenter', () => {
  it('situa do mayor en 2, no en la tonica', () => {
    // Si fuera la tonica (0), fa sostenido y sol bemol empatarian siempre.
    expect(tonalCenter(key('C major'))).toBe(2);
  });

  it('desplaza el centro del modo menor hacia los sostenidos', () => {
    // Por la sensible alterada: sin ella, todo sol sostenido saldria la bemol.
    expect(tonalCenter(key('A minor'))).toBeCloseTo(2.75, 10);
  });
});

describe('spellPitch', () => {
  it('escribe las notas de la escala sin alteraciones', () => {
    expect(spellPitch(62, key('C major')).pitchName).toBe('D');
    expect(spellPitch(65, key('C major')).pitchName).toBe('F');
  });

  it('elige sostenido en tonalidad de sostenidos', () => {
    expect(spellPitch(61, key('C major')).pitchName).toBe('C#');
    expect(spellPitch(66, key('G major')).pitchName).toBe('F#');
  });

  it('elige bemol en tonalidad de bemoles', () => {
    // La misma tecla que el caso anterior, escrita al reves porque el centro
    // tonal esta al otro lado del circulo de quintas.
    expect(spellPitch(61, key('Eb major')).pitchName).toBe('Db');
    expect(spellPitch(70, key('F major')).pitchName).toBe('Bb');
  });

  it('escribe la sensible del modo menor como sostenido', () => {
    expect(spellPitch(68, key('A minor')).pitchName).toBe('G#');
    expect(spellPitch(73, key('D minor')).pitchName).toBe('C#');
  });

  it('desempata por la direccion de la melodia', () => {
    // Misma tecla, misma tonalidad, distinta nota: lo que la define es hacia
    // donde resuelve.
    expect(spellPitch(68, key('C major'), 1).pitchName).toBe('G#');
    expect(spellPitch(68, key('C major'), -1).pitchName).toBe('Ab');
  });

  it('conserva la octava correcta al cambiar de grado', () => {
    // Si 61 se escribe re bemol, sigue estando en la octava 4.
    const pitch = spellPitch(61, key('Eb major'));
    expect(pitch.octave).toBe(4);
    expect(pitch.midi).toBe(61);
  });

  it('nunca cambia la altura sonante, sea cual sea la grafia', () => {
    for (const name of ['C major', 'Eb major', 'B major', 'F# major', 'A minor']) {
      for (let midi = 55; midi <= 80; midi += 1) {
        expect(spellPitch(midi, key(name)).midi).toBe(midi);
      }
    }
  });

  it('evita dobles alteraciones cuando existe una grafia simple', () => {
    for (const name of ['C major', 'G major', 'F major', 'D minor']) {
      for (let midi = 60; midi <= 72; midi += 1) {
        expect(Math.abs(spellPitch(midi, key(name)).alter)).toBeLessThan(2);
      }
    }
  });
});

describe('spellSequence', () => {
  it('deduce la direccion de cada nota por la siguiente', () => {
    // Sube al la: sostenido. Baja al sol: bemol. La misma tecla, 68.
    const ascending = spellSequence([67, 68, 69], key('C major'));
    expect(ascending.map((p) => p.pitchName)).toEqual(['G', 'G#', 'A']);

    const descending = spellSequence([69, 68, 67], key('C major'));
    expect(descending.map((p) => p.pitchName)).toEqual(['A', 'Ab', 'G']);
  });

  it('no altera las alturas sonantes de la secuencia', () => {
    const midis = [60, 63, 66, 68, 70, 73];
    const spelled = spellSequence(midis, key('Bb major'));
    expect(spelled.map((p) => p.midi)).toEqual(midis);
  });
});
