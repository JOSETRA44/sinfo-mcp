import { DomainError, KeySignature, Pitch } from '@sinfo/core';
import { describe, expect, it } from 'vitest';
import { analyzeChord, classifyCadence, RomanNumeral } from './roman.js';

const C = KeySignature.parse('C major');
const Am = KeySignature.parse('A minor');
const Eb = KeySignature.parse('Eb major');

const pitchesOf = (names: string): Pitch[] => names.split(' ').map((n) => Pitch.parse(n));
const classes = (pitches: readonly Pitch[]): string[] => pitches.map((p) => p.pitchName);

describe('RomanNumeral', () => {
  describe('parse', () => {
    it('las mayusculas son mayor y las minusculas menor', () => {
      expect(RomanNumeral.parse('I', C).quality).toBe('major');
      expect(RomanNumeral.parse('ii', C).quality).toBe('minor');
      expect(RomanNumeral.parse('V', C).degree).toBe(5);
      expect(RomanNumeral.parse('vi', C).degree).toBe(6);
    });

    it('interpreta septimas y calidades marcadas', () => {
      expect(RomanNumeral.parse('V7', C).quality).toBe('dominant7');
      expect(RomanNumeral.parse('ii7', C).quality).toBe('minor7');
      expect(RomanNumeral.parse('vii°', C).quality).toBe('diminished');
      expect(RomanNumeral.parse('vii°7', C).quality).toBe('diminished7');
      expect(RomanNumeral.parse('viiø7', C).quality).toBe('halfDiminished7');
      expect(RomanNumeral.parse('III+', C).quality).toBe('augmented');
    });

    it('interpreta las alteraciones de grado', () => {
      expect(RomanNumeral.parse('bVII', C).accidental).toBe(-1);
      expect(RomanNumeral.parse('bVII', C).degree).toBe(7);
      expect(RomanNumeral.parse('#iv', C).accidental).toBe(1);
    });

    it('interpreta el cifrado de bajo como inversion', () => {
      expect(RomanNumeral.parse('I', C).inversion).toBe(0);
      expect(RomanNumeral.parse('I6', C).inversion).toBe(1);
      expect(RomanNumeral.parse('I64', C).inversion).toBe(2);
      expect(RomanNumeral.parse('V7', C).inversion).toBe(0);
      expect(RomanNumeral.parse('V65', C).inversion).toBe(1);
      expect(RomanNumeral.parse('V43', C).inversion).toBe(2);
      expect(RomanNumeral.parse('V42', C).inversion).toBe(3);
    });

    it('interpreta las dominantes secundarias', () => {
      const secondary = RomanNumeral.parse('V/V', C);
      expect(secondary.degree).toBe(5);
      expect(secondary.appliedTo).toBe(5);
      expect(secondary.fn).toBe('dominante-secundaria');
    });

    it('rechaza lo que no es un numero romano', () => {
      expect(() => RomanNumeral.parse('X', C)).toThrow(DomainError);
      expect(() => RomanNumeral.parse('8', C)).toThrow(DomainError);
    });
  });

  describe('realizacion en Do mayor', () => {
    // La serie diatonica de manual: I ii iii IV V vi vii°
    it.each([
      ['I', 'C E G'],
      ['ii', 'D F A'],
      ['iii', 'E G B'],
      ['IV', 'F A C'],
      ['V', 'G B D'],
      ['vi', 'A C E'],
      ['vii°', 'B D F'],
    ])('%s da %s', (symbol, expected) => {
      const chord = RomanNumeral.parse(symbol, C).realize(C);
      expect(classes(chord.pitches).join(' ')).toBe(expected);
    });

    it('V7 anade la septima menor', () => {
      expect(classes(RomanNumeral.parse('V7', C).realize(C).pitches).join(' ')).toBe('G B D F');
    });

    it('la inversion coloca la nota correcta en el bajo', () => {
      expect(RomanNumeral.parse('I6', C).realize(C).bass.pitchName).toBe('E');
      expect(RomanNumeral.parse('V65', C).realize(C).bass.pitchName).toBe('B');
      expect(RomanNumeral.parse('V42', C).realize(C).bass.pitchName).toBe('F');
    });
  });

  /**
   * El modo menor es donde mas se equivoca un analisis ingenuo: con la escala
   * natural, el V saldria menor y no habria cadencia autentica posible.
   */
  describe('realizacion en modo menor', () => {
    it('el V es MAYOR porque usa la sensible de la menor armonica', () => {
      const chord = RomanNumeral.parse('V', Am).realize(Am);
      expect(classes(chord.pitches).join(' ')).toBe('E G# B');
      expect(chord.quality).toBe('major');
    });

    it('el vii es disminuido, no mayor', () => {
      const chord = RomanNumeral.parse('vii°', Am).realize(Am);
      expect(classes(chord.pitches).join(' ')).toBe('G# B D');
    });

    it('la tonica sigue siendo menor', () => {
      expect(classes(RomanNumeral.parse('i', Am).realize(Am).pitches).join(' ')).toBe('A C E');
    });

    it('el VI y el III conservan las notas de la escala natural', () => {
      expect(classes(RomanNumeral.parse('VI', Am).realize(Am).pitches).join(' ')).toBe('F A C');
      expect(classes(RomanNumeral.parse('III', Am).realize(Am).pitches).join(' ')).toBe('C E G');
    });

    /**
     * El septimo grado es el unico cuya fundamental difiere entre la menor
     * natural y la armonica, y los dos acordes existen con sentidos distintos.
     */
    it('VII es la subtonica y vii° el acorde de sensible', () => {
      // Subtonica: Sol mayor, sonido modal, no resuelve por semitono.
      expect(classes(RomanNumeral.parse('VII', Am).realize(Am).pitches).join(' ')).toBe('G B D');
      // Sensible: Sol sostenido disminuido, empuja a la tonica.
      expect(classes(RomanNumeral.parse('vii°', Am).realize(Am).pitches).join(' ')).toBe('G# B D');
      expect(classes(RomanNumeral.parse('vii°7', Am).realize(Am).pitches).join(' ')).toBe(
        'G# B D F',
      );
    });

    it('la sensible del V viene de la calidad, no de la escala', () => {
      // El V es mayor tanto si se piensa desde la natural como desde la
      // armonica: su fundamental es Mi en las dos.
      expect(classes(RomanNumeral.parse('V', Am).realize(Am).pitches).join(' ')).toBe('E G# B');
      // Y el v menor, propio del sonido modal, tambien se puede escribir.
      expect(classes(RomanNumeral.parse('v', Am).realize(Am).pitches).join(' ')).toBe('E G B');
    });
  });

  describe('realizacion en tonalidades con bemoles', () => {
    it('conserva la ortografia de la armadura', () => {
      expect(classes(RomanNumeral.parse('I', Eb).realize(Eb).pitches).join(' ')).toBe('Eb G Bb');
      expect(classes(RomanNumeral.parse('V7', Eb).realize(Eb).pitches).join(' ')).toBe('Bb D F Ab');
      expect(classes(RomanNumeral.parse('ii', Eb).realize(Eb).pitches).join(' ')).toBe('F Ab C');
    });
  });

  describe('dominantes secundarias', () => {
    it('V/V en Do mayor es Re mayor, con el fa sostenido', () => {
      const chord = RomanNumeral.parse('V/V', C).realize(C);
      expect(classes(chord.pitches).join(' ')).toBe('D F# A');
    });

    it('V7/IV en Do mayor es Do septima', () => {
      const chord = RomanNumeral.parse('V7/IV', C).realize(C);
      expect(classes(chord.pitches).join(' ')).toBe('C E G Bb');
    });
  });

  describe('funcion tonal', () => {
    it.each([
      ['I', 'tonica'],
      ['iii', 'tonica'],
      ['vi', 'tonica'],
      ['ii', 'subdominante'],
      ['IV', 'subdominante'],
      ['V', 'dominante'],
      ['vii°', 'dominante'],
    ])('%s cumple funcion de %s', (symbol, fn) => {
      expect(RomanNumeral.parse(symbol, C).fn).toBe(fn);
    });
  });

  describe('escritura del simbolo', () => {
    it.each(['I', 'ii', 'V7', 'vii°', 'I6', 'V65', 'V43'])('reconstruye %s', (symbol) => {
      expect(RomanNumeral.parse(symbol, C).symbol).toBe(symbol);
    });
  });
});

describe('analyzeChord', () => {
  it('reconoce la funcion de los acordes diatonicos', () => {
    expect(analyzeChord(pitchesOf('C4 E4 G4'), C)?.roman.symbol).toBe('I');
    expect(analyzeChord(pitchesOf('G3 B3 D4'), C)?.roman.symbol).toBe('V');
    expect(analyzeChord(pitchesOf('D4 F4 A4'), C)?.roman.symbol).toBe('ii');
    expect(analyzeChord(pitchesOf('A3 C4 E4'), C)?.roman.symbol).toBe('vi');
  });

  it('reconoce la dominante con septima', () => {
    const analysis = analyzeChord(pitchesOf('G2 B3 D4 F4'), C);
    expect(analysis?.roman.symbol).toBe('V7');
    expect(analysis?.fn).toBe('dominante');
  });

  it('reconoce la inversion por el bajo', () => {
    expect(analyzeChord(pitchesOf('E3 G3 C4'), C)?.roman.symbol).toBe('I6');
    expect(analyzeChord(pitchesOf('B2 D3 G3 F4'), C)?.roman.symbol).toBe('V65');
  });

  it('marca como no diatonico lo que sale de la tonalidad', () => {
    // Sib mayor en Do mayor: el acorde prestado bVII.
    const analysis = analyzeChord(pitchesOf('Bb3 D4 F4'), C);
    expect(analysis?.roman.symbol).toBe('bVII');
    expect(analysis?.isDiatonic).toBe(false);
  });

  it('analiza correctamente en modo menor', () => {
    expect(analyzeChord(pitchesOf('A3 C4 E4'), Am)?.roman.symbol).toBe('i');
    // Mi mayor en La menor es el V, gracias a la sensible sol sostenido.
    expect(analyzeChord(pitchesOf('E3 G#3 B3'), Am)?.roman.symbol).toBe('V');
  });

  /**
   * El modo menor no tiene siete notas sino ocho: la escala natural mas la
   * sensible. Medir el diatonismo con una sola de las dos escalas deja fuera
   * la mitad del repertorio propio del modo.
   */
  describe('diatonismo en modo menor', () => {
    it('el relativo mayor es diatonico, aunque lleve el septimo grado sin alterar', () => {
      // Do mayor en la menor: su Sol natural no esta en la menor armonica.
      const analysis = analyzeChord(pitchesOf('C4 E4 G4'), Am);
      expect(analysis?.roman.symbol).toBe('III');
      expect(analysis?.isDiatonic).toBe(true);
    });

    it('la dominante mayor es diatonica, aunque lleve la sensible', () => {
      // Mi mayor en la menor: su Sol# no esta en la menor natural.
      const analysis = analyzeChord(pitchesOf('E3 G#3 B3'), Am);
      expect(analysis?.isDiatonic).toBe(true);
    });

    it.each([
      ['A3 C4 E4', 'i'],
      ['D3 F3 A3', 'iv'],
      ['F3 A3 C4', 'VI'],
      ['G3 B3 D4', 'VII'],
      ['G#3 B3 D4', 'vii°'],
    ])('%s es diatonico en la menor', (notes, symbol) => {
      const analysis = analyzeChord(pitchesOf(notes), Am);
      expect(analysis?.roman.symbol).toBe(symbol);
      expect(analysis?.isDiatonic).toBe(true);
    });

    it('la sexta elevada si se senala: es color de menor melodica', () => {
      // Si menor en la menor necesita Fa#, que no pertenece al modo.
      const analysis = analyzeChord(pitchesOf('B3 D4 F#4'), Am);
      expect(analysis?.isDiatonic).toBe(false);
    });

    it('en modo mayor sigue bastando la escala mayor', () => {
      expect(analyzeChord(pitchesOf('C4 E4 G4'), C)?.isDiatonic).toBe(true);
      expect(analyzeChord(pitchesOf('Bb3 D4 F4'), C)?.isDiatonic).toBe(false);
    });
  });

  it('devuelve null cuando no hay acorde reconocible', () => {
    expect(analyzeChord(pitchesOf('C4 D4 E4 F#4'), C)).toBeNull();
  });
});

describe('classifyCadence', () => {
  const r = (symbol: string, key = C): RomanNumeral => RomanNumeral.parse(symbol, key);

  it('V-I en estado fundamental es autentica perfecta', () => {
    expect(classifyCadence(r('V'), r('I')).type).toBe('autentica-perfecta');
    expect(classifyCadence(r('V7'), r('I')).type).toBe('autentica-perfecta');
  });

  // La distincion que decide si una obra suena terminada.
  it('V-I invertido es autentica imperfecta', () => {
    expect(classifyCadence(r('V65'), r('I')).type).toBe('autentica-imperfecta');
    expect(classifyCadence(r('V'), r('I6')).type).toBe('autentica-imperfecta');
  });

  it('V-I sin la tonica en la voz superior es imperfecta', () => {
    expect(classifyCadence(r('V'), r('I'), { sopranoIsTonic: false }).type).toBe(
      'autentica-imperfecta',
    );
  });

  it('V-vi es cadencia rota', () => {
    expect(classifyCadence(r('V'), r('vi')).type).toBe('rota');
  });

  it('IV-I es plagal', () => {
    expect(classifyCadence(r('IV'), r('I')).type).toBe('plagal');
  });

  it('terminar en la dominante es semicadencia', () => {
    expect(classifyCadence(r('ii'), r('V')).type).toBe('semicadencia');
    expect(classifyCadence(r('IV'), r('V')).type).toBe('semicadencia');
  });

  it('vii°-i tambien cierra: es dominante sin fundamental', () => {
    expect(classifyCadence(r('vii°', Am), r('i', Am)).type).toBe('autentica-perfecta');
  });

  it('una sucesion sin funcion cadencial no se fuerza', () => {
    expect(classifyCadence(r('I'), r('vi')).type).toBe('ninguna');
  });

  it('cada resultado explica por que', () => {
    expect(classifyCadence(r('V'), r('I')).description).toContain('cierre');
    expect(classifyCadence(r('V'), r('vi')).description).toContain('tonica');
  });
});
