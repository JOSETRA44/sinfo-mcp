import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.js';
import { isChord, isRest, type MusicalEvent } from '../event/event.js';
import { Duration } from '../time/duration.js';
import { formatDurationToken, parseDurationToken } from './duration-token.js';
import { parseGrid, PERCUSSION_MAP } from './grid.js';
import { parseVoice, serializeVoice, validateBarlines } from './sinfoscript.js';

describe('tokens de duracion', () => {
  it('interpreta figuras base', () => {
    expect(parseDurationToken('w').toString()).toBe('1/1');
    expect(parseDurationToken('q').toString()).toBe('1/4');
    expect(parseDurationToken('s').toString()).toBe('1/16');
  });

  it('interpreta puntillos', () => {
    expect(parseDurationToken('q.').toString()).toBe('3/8');
    expect(parseDurationToken('q..').toString()).toBe('7/16');
  });

  it('interpreta grupos irregulares', () => {
    // n notas ocupan el espacio de la mayor potencia de 2 que no lo supera:
    // el tresillo ocupa 2, el quintillo y el septillo ocupan 4.
    expect(parseDurationToken('e3').toString()).toBe('1/12'); // 3 en el sitio de 2
    expect(parseDurationToken('s5').toString()).toBe('1/20'); // 5 en el sitio de 4
    expect(parseDurationToken('e7').toString()).toBe('1/14'); // 7 corcheas = 1 blanca
    expect(parseDurationToken('s7').toString()).toBe('1/28'); // 7 semicorcheas = 1 negra
  });

  it('el grupo irregular completo cuadra con la figura que ocupa', () => {
    const septuplet = parseDurationToken('s7');
    expect(septuplet.times(7).equals(Duration.QUARTER)).toBe(true);

    const triplet = parseDurationToken('e3');
    expect(triplet.times(3).equals(Duration.QUARTER)).toBe(true);
  });

  it('rechaza tokens invalidos', () => {
    expect(() => parseDurationToken('z')).toThrow(DomainError);
    expect(() => parseDurationToken('q1')).toThrow(DomainError);
  });

  it('escribir y volver a leer da la misma duracion', () => {
    for (const token of ['w', 'h', 'q', 'e', 's', 't', 'x', 'q.', 'h..', 'e3', 's5']) {
      const duration = parseDurationToken(token);
      expect(formatDurationToken(duration)).toBe(token);
    }
  });

  it('prefiere la escritura mas simple entre varias equivalentes', () => {
    // `q.3` (negra con puntillo en tresillo) vale 1/4, igual que una negra
    // pelada. Al escribir se elige siempre la forma sin adornos.
    expect(parseDurationToken('q.3').equals(parseDurationToken('q'))).toBe(true);
    expect(formatDurationToken(parseDurationToken('q.3'))).toBe('q');
  });

  it('devuelve null si la duracion no cabe en una figura', () => {
    // 5/16 necesita dos figuras atadas.
    expect(formatDurationToken(Duration.of(5, 16))).toBeNull();
  });
});

describe('SinfoScript', () => {
  it('interpreta una linea sencilla', () => {
    const { events } = parseVoice('c4/q e4/q g4/h');
    expect(events).toHaveLength(3);
    expect(events[0]?.pitches[0]?.name).toBe('C4');
    expect(events[2]?.duration.toString()).toBe('1/2');
  });

  it('interpreta silencios', () => {
    const { events } = parseVoice('c4/q r/q r/h');
    expect(isRest(events[1]!)).toBe(true);
    expect(events[2]?.duration.toString()).toBe('1/2');
  });

  it('interpreta acordes', () => {
    const { events } = parseVoice('[c4,e4,g4]/h');
    expect(isChord(events[0]!)).toBe(true);
    expect(events[0]?.pitches.map((p) => p.name)).toEqual(['C4', 'E4', 'G4']);
  });

  it('ordena las notas del acorde de grave a agudo', () => {
    const { events } = parseVoice('[g4,c4,e4]/h');
    expect(events[0]?.pitches.map((p) => p.name)).toEqual(['C4', 'E4', 'G4']);
  });

  it('la dinamica rige hasta la siguiente y se marca solo al cambiar', () => {
    const { events } = parseVoice('mf c4/q e4/q ff g4/q');
    expect(events[0]?.dynamic).toBe('mf');
    expect(events[1]?.dynamic).toBeUndefined();
    expect(events[2]?.dynamic).toBe('ff');
  });

  it('interpreta articulaciones y sus abreviaturas', () => {
    const { events } = parseVoice('c4/q+stacc d4/q+accent+ten');
    expect(events[0]?.articulations).toEqual(['staccato']);
    expect(events[1]?.articulations).toEqual(['accent', 'tenuto']);
  });

  it('interpreta ligaduras', () => {
    const { events } = parseVoice('c4/q~ c4/h');
    expect(events[0]?.tie).toBe('start');
    expect(events[1]?.tie).toBeUndefined();
  });

  it('ignora comentarios y espacios sobrantes', () => {
    const { events } = parseVoice(`
      # tema principal
      c4/q  e4/q   # inciso
      g4/h
    `);
    expect(events).toHaveLength(3);
  });

  // Regresion: `#` era a la vez sostenido y comentario, y `C#4/s` se
  // truncaba a `C` antes de llegar al parser.
  it('el sostenido no abre un comentario', () => {
    const { events } = parseVoice('C#4/q F#4/q  # esto si es comentario');
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.pitches[0]?.name)).toEqual(['C#4', 'F#4']);
  });

  it('distingue una dinamica de una nota que empieza por la misma letra', () => {
    // "f" es forte; "f4/q" es la nota fa.
    const { events } = parseVoice('f f4/q p e4/q');
    expect(events).toHaveLength(2);
    expect(events[0]?.pitches[0]?.name).toBe('F4');
    expect(events[0]?.dynamic).toBe('f');
    expect(events[1]?.dynamic).toBe('p');
  });

  it('da errores utiles ante tokens sin sentido', () => {
    expect(() => parseVoice('c4')).toThrow(DomainError);
    expect(() => parseVoice('c4/q+inventada')).toThrow(DomainError);
    expect(() => parseVoice('[c4,e4/q')).toThrow(DomainError);
  });

  describe('ida y vuelta', () => {
    const cases = [
      'c4/q e4/q g4/h',
      'mf c4/q~ c4/e r/e ff [c4,e4,g4]/h',
      'c4/q+stacc d4/e+accent e4/e3 f4/e3 g4/e3',
      'r/w',
      'Bb3/q. C#4/s Ebb5/e',
    ];

    it.each(cases)('conserva todo en %s', (source) => {
      const first = parseVoice(source);
      const written = serializeVoice(first.events);
      const second = parseVoice(written);

      expect(second.events).toEqual(first.events);
    });

    it('conserva la escritura enarmonica', () => {
      const { events } = parseVoice('C#4/q');
      expect(serializeVoice(events)).toBe('C#4/q');
      expect(serializeVoice(parseVoice('Db4/q').events)).toBe('Db4/q');
    });
  });

  describe('validacion de compases', () => {
    const fourFour = Duration.WHOLE;

    it('acepta compases que cuadran', () => {
      const parsed = parseVoice('c4/q e4/q g4/q c5/q | d5/h e5/h');
      expect(validateBarlines(parsed, fourFour)).toEqual([]);
    });

    // El fallo mas comun de un modelo escribiendo musica.
    it('detecta un compas con tiempos de mas', () => {
      const parsed = parseVoice('c4/q e4/q g4/q c5/q e5/q | d5/h e5/h');
      const issues = validateBarlines(parsed, fourFour);

      expect(issues).toHaveLength(1);
      expect(issues[0]?.measure).toBe(1);
      expect(issues[0]?.actual).toBe('5/4');
      expect(issues[0]?.expected).toBe('1/1');
    });

    it('detecta un compas con tiempos de menos', () => {
      const parsed = parseVoice('c4/q e4/q | d5/h e5/h');
      expect(validateBarlines(parsed, fourFour)).toHaveLength(1);
    });

    it('permite que el ultimo compas quede a medias', () => {
      const parsed = parseVoice('c4/q e4/q g4/q c5/q | d5/h');
      expect(validateBarlines(parsed, fourFour)).toEqual([]);
    });

    it('sin barras no valida nada', () => {
      const parsed = parseVoice('c4/q e4/q');
      expect(validateBarlines(parsed, fourFour)).toEqual([]);
    });

    it('funciona en compas de tres por cuatro', () => {
      const threeFour = Duration.of(3, 4);
      expect(validateBarlines(parseVoice('c4/q e4/q g4/q | d5/h.'), threeFour)).toEqual([]);
      expect(validateBarlines(parseVoice('c4/q e4/q | d5/h.'), threeFour)).toHaveLength(1);
    });
  });
});

describe('rejilla de percusion', () => {
  it('interpreta un patron basico', () => {
    const { events, lanes, stepCount } = parseGrid(`
      kick   x...x...x...x...
      snare  ....x.......x...
    `);

    expect(lanes).toHaveLength(2);
    expect(stepCount).toBe(16);
    expect(lanes[0]?.pitch.midi).toBe(PERCUSSION_MAP['kick']);
  });

  it('agrupa los golpes simultaneos en un acorde', () => {
    const { events } = parseGrid(`
      kick   x...
      snare  x...
    `);
    expect(isChord(events[0]!)).toBe(true);
    expect(events[0]?.pitches).toHaveLength(2);
  });

  it('agrupa los silencios consecutivos en uno solo', () => {
    const { events } = parseGrid('kick x...');
    expect(events).toHaveLength(2);
    expect(isRest(events[1]!)).toBe(true);
    // Tres semicorcheas seguidas se escriben como una corchea con puntillo.
    expect(events[1]?.duration.toString()).toBe('3/16');
  });

  it('los simbolos marcan intensidades distintas', () => {
    const { events } = parseGrid('snare Xxo.');
    const velocities = events.slice(0, 3).map((e: MusicalEvent) => e.velocity);
    expect(velocities[0]).toBeGreaterThan(velocities[1]!);
    expect(velocities[1]).toBeGreaterThan(velocities[2]!);
  });

  it('repite en bucle las filas mas cortas', () => {
    const { events, stepCount } = parseGrid(`
      kick   x...x...x...x...
      hihat  x.
    `);
    expect(stepCount).toBe(16);
    // El charles suena en las 8 casillas pares: nunca hay silencio de 2 seguidas.
    expect(events.every((e: MusicalEvent) => e.duration.toString() === '1/16')).toBe(true);
  });

  it('la duracion total sale de las casillas', () => {
    const { events } = parseGrid('kick x...x...x...x...');
    const total = events.reduce(
      (sum: Duration, e: MusicalEvent) => sum.plus(e.duration),
      Duration.ZERO,
    );
    expect(total.equals(Duration.WHOLE)).toBe(true);
  });

  it('admite alturas directas para lineas de bajo', () => {
    const { lanes } = parseGrid('C2 x...x...');
    expect(lanes[0]?.pitch.name).toBe('C2');
  });

  it('acepta barras de compas como separador visual', () => {
    const withBars = parseGrid('kick x...|x...|x...|x...');
    const without = parseGrid('kick x...x...x...x...');
    expect(withBars.stepCount).toBe(without.stepCount);
  });

  it('rechaza simbolos y nombres desconocidos', () => {
    expect(() => parseGrid('kick x?..')).toThrow(DomainError);
    expect(() => parseGrid('trompeta_magica x...')).toThrow(DomainError);
  });

  it('se puede cambiar la figura de casilla', () => {
    const { events } = parseGrid('kick x...', { step: Duration.EIGHTH });
    expect(events[0]?.duration.toString()).toBe('1/8');
  });
});
