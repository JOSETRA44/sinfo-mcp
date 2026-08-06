import { INSTRUMENTS, parseVoice, Pitch, soundingPitch } from '@sinfo/core';
import { Chord } from '@sinfo/theory';
import { describe, expect, it } from 'vitest';
import {
  assignRoles,
  checkBalance,
  distributeChord,
  fitToRange,
  materialFor,
  type OrchestrationCandidate,
} from './orchestration.js';

const inst = (id: string) => INSTRUMENTS[id]!;

/** Alturas SONANTES de un pasaje ya escrito para un instrumento. */
function soundingOf(events: readonly { pitches: readonly Pitch[] }[], instrumentId: string) {
  return events.flatMap((event) =>
    event.pitches.map((pitch) => soundingPitch(inst(instrumentId), pitch)),
  );
}

describe('fitToRange', () => {
  it('deja el pasaje intacto si ya encaja', () => {
    const events = parseVoice('g4/q a4/q b4/q c5/q').events;
    const fit = fitToRange(events, inst('violin'));
    expect(fit.octaveShift).toBe(0);
    expect(fit.outOfRange).toBe(0);
  });

  // La operacion que hace un orquestador al pasar un tema de violin a fagot.
  it('baja por octavas un tema agudo para un instrumento grave', () => {
    const events = parseVoice('g5/q a5/q b5/q c6/q').events;
    const fit = fitToRange(events, inst('bassoon'));

    expect(fit.octaveShift).toBeLessThan(0);
    expect(fit.outOfRange).toBe(0);
    for (const pitch of soundingOf(fit.events, 'bassoon')) {
      expect(pitch.midi).toBeGreaterThanOrEqual(inst('bassoon').range.lowest.midi);
      expect(pitch.midi).toBeLessThanOrEqual(inst('bassoon').range.highest.midi);
    }
  });

  it('sube por octavas un tema grave para un instrumento agudo', () => {
    const fit = fitToRange(parseVoice('c2/q e2/q g2/q').events, inst('piccolo'));
    expect(fit.octaveShift).toBeGreaterThan(0);
    expect(fit.outOfRange).toBe(0);
  });

  it('solo desplaza octavas: la melodia no cambia de tonalidad', () => {
    const original = parseVoice('c5/q e5/q g5/q').events;
    const fit = fitToRange(original, inst('cello'));

    const classes = soundingOf(fit.events, 'cello').map((p) => p.pitchName);
    expect(classes).toEqual(['C', 'E', 'G']);
  });

  describe('instrumentos transpositores', () => {
    it('devuelve alturas ESCRITAS, no sonantes', () => {
      // Sol4 cae ya centrado en la tesitura del clarinete, asi que no hay
      // desplazamiento de octava que enturbie la comprobacion.
      const fit = fitToRange(parseVoice('g4/w').events, inst('clarinet'));
      expect(fit.octaveShift).toBe(0);
      // El clarinete en Sib suena una segunda mayor por debajo: para que suene
      // Sol4 hay que escribirle La4.
      expect(fit.events[0]!.pitches[0]!.name).toBe('A4');
      expect(soundingOf(fit.events, 'clarinet')[0]!.name).toBe('G4');
    });

    /**
     * El invariante que no depende del ajuste de octava: lo escrito y lo que
     * suena siempre difieren exactamente en la transposicion del instrumento.
     */
    it.each(['clarinet', 'horn', 'trumpet', 'english_horn', 'contrabass', 'piccolo'])(
      'en %s lo escrito y lo sonante difieren en su transposicion',
      (id) => {
        const fit = fitToRange(parseVoice('c4/q e4/q g4/q').events, inst(id));

        for (const event of fit.events) {
          for (const written of event.pitches) {
            const sounding = soundingPitch(inst(id), written);
            expect(written.intervalTo(sounding).chromatic).toBe(
              inst(id).transposition.chromatic,
            );
          }
        }
      },
    );

    it('lo que suena queda dentro del rango real del instrumento', () => {
      for (const id of ['clarinet', 'horn', 'trumpet', 'contrabass', 'piccolo', 'bass_clarinet']) {
        const fit = fitToRange(parseVoice('c4/q e4/q g4/q c5/q').events, inst(id));
        for (const pitch of soundingOf(fit.events, id)) {
          expect(pitch.midi, `${id}: ${pitch.name} fuera de rango`)
            .toBeGreaterThanOrEqual(inst(id).range.lowest.midi);
          expect(pitch.midi, `${id}: ${pitch.name} fuera de rango`)
            .toBeLessThanOrEqual(inst(id).range.highest.midi);
        }
      }
    });
  });

  it('conserva las duraciones y los silencios', () => {
    const fit = fitToRange(parseVoice('c5/q r/h g5/e').events, inst('cello'));
    expect(fit.events.map((e) => e.duration.toString())).toEqual(['1/4', '1/2', '1/8']);
    expect(fit.events[1]!.pitches).toHaveLength(0);
  });

  it('un pasaje vacio no rompe nada', () => {
    expect(fitToRange([], inst('flute')).octaveShift).toBe(0);
    expect(fitToRange(parseVoice('r/w').events, inst('flute')).outOfRange).toBe(0);
  });

  it('avisa cuando el pasaje es mas ancho que el instrumento', () => {
    // Cuatro octavas no caben en unos timbales.
    const fit = fitToRange(parseVoice('c1/q c3/q c5/q').events, inst('timpani'));
    expect(fit.outOfRange).toBeGreaterThan(0);
  });
});

describe('distributeChord', () => {
  const chord = Chord.of('C', 'major');

  it('el instrumento mas grave lleva la fundamental', () => {
    const spread = distributeChord(chord, [inst('violin'), inst('cello'), inst('viola')]);
    expect(spread[0]!.instrument.id).toBe('cello');
    expect(spread[0]!.degree).toBe(0);
    expect(spread[0]!.pitch.pitchName).toBe('C');
  });

  it('reparte las demas notas del acorde', () => {
    const spread = distributeChord(chord, [inst('violin'), inst('viola'), inst('cello')]);
    expect(new Set(spread.map((s) => s.pitch.pitchName))).toEqual(new Set(['C', 'E', 'G']));
  });

  it('coloca cada nota en la octava comoda del instrumento', () => {
    for (const entry of distributeChord(chord, [inst('piccolo'), inst('tuba'), inst('viola')])) {
      const { tessitura } = entry.instrument;
      const centre = (tessitura.lowest.midi + tessitura.highest.midi) / 2;
      expect(Math.abs(entry.pitch.midi - centre), entry.instrument.id).toBeLessThanOrEqual(12);
    }
  });

  it('con mas instrumentos que notas, dobla las superiores', () => {
    const spread = distributeChord(chord, [
      inst('flute'), inst('oboe'), inst('clarinet'), inst('bassoon'), inst('horn'),
    ]);
    expect(spread).toHaveLength(5);
    // La fundamental solo la lleva el mas grave; el resto son 3a y 5a.
    expect(spread.filter((s) => s.degree === 0)).toHaveLength(1);
  });

  it('funciona con acordes de septima', () => {
    const spread = distributeChord(Chord.of('G', 'dominant7'), [
      inst('violin'), inst('viola'), inst('cello'), inst('contrabass'),
    ]);
    expect(new Set(spread.map((s) => s.pitch.pitchName))).toEqual(
      new Set(['G', 'B', 'D', 'F']),
    );
  });

  it('sin instrumentos devuelve una lista vacia', () => {
    expect(distributeChord(chord, [])).toEqual([]);
  });
});

describe('assignRoles', () => {
  const quartet: OrchestrationCandidate[] = [
    { partId: 'vln1', instrument: inst('violin') },
    { partId: 'vln2', instrument: inst('violin') },
    { partId: 'vla', instrument: inst('viola') },
    { partId: 'vc', instrument: inst('cello') },
  ];

  const orchestra: OrchestrationCandidate[] = [
    'piccolo', 'flute', 'oboe', 'clarinet', 'bassoon', 'contrabassoon',
    'horn', 'trumpet', 'trombone', 'tuba',
    'violin', 'viola', 'cello', 'contrabass',
  ].map((id, index) => ({ partId: `${id}-${index}`, instrument: inst(id) }));

  it('asigna un papel a cada instrumento', () => {
    const roles = assignRoles(quartet);
    expect(roles).toHaveLength(4);
    expect(roles.every((r) => r.role !== undefined)).toBe(true);
  });

  it('los graves llevan el bajo y los agudos la melodia', () => {
    const roles = assignRoles(orchestra, { seed: 'fijo' });
    const byPart = new Map(roles.map((r) => [r.partId, r]));

    const bass = roles.filter((r) => r.role === 'bajo');
    const melody = roles.filter((r) => r.role === 'melodia');

    expect(bass.length).toBeGreaterThan(0);
    expect(melody.length).toBeGreaterThan(0);

    const bassCentre = average(bass.map((r) => centreOf(r.instrument)));
    const melodyCentre = average(melody.map((r) => centreOf(r.instrument)));
    expect(melodyCentre).toBeGreaterThan(bassCentre);

    // La tuba nunca lleva la melodia en esta plantilla.
    expect(byPart.get('tuba-9')!.role).toBe('bajo');
  });

  it('el estilo coral da linea propia a cada voz', () => {
    const roles = assignRoles(quartet, { style: 'coral' });
    expect(roles.filter((r) => r.role === 'armonia')).toHaveLength(0);
  });

  it('el estilo tutti dobla mas la melodia que el de camara', () => {
    const tutti = assignRoles(orchestra, { style: 'tutti', seed: 'x' });
    const chamber = assignRoles(orchestra, { style: 'camara', seed: 'x' });

    const count = (rs: typeof tutti) => rs.filter((r) => r.role === 'melodia').length;
    expect(count(tutti)).toBeGreaterThan(count(chamber));
  });

  it('el estilo camara deja callar a parte del acompanamiento', () => {
    const roles = assignRoles(orchestra, { style: 'camara', seed: 'aligerar' });
    expect(roles.filter((r) => r.role === 'silencio').length).toBeGreaterThan(0);
  });

  it('no da la melodia a quien no cubre su rango', () => {
    const roles = assignRoles(orchestra, {
      melodyRange: { lowest: Pitch.parse('C4'), highest: Pitch.parse('C7') },
      seed: 'rango',
    });

    for (const role of roles.filter((r) => r.role === 'melodia')) {
      const capacity = role.instrument.range.highest.midi - role.instrument.range.lowest.midi;
      expect(capacity, role.instrument.id).toBeGreaterThanOrEqual(36);
    }
  });

  it('es reproducible con la misma semilla', () => {
    const a = assignRoles(orchestra, { style: 'camara', seed: 'igual' });
    const b = assignRoles(orchestra, { style: 'camara', seed: 'igual' });
    expect(a.map((r) => r.role)).toEqual(b.map((r) => r.role));
  });

  it('sin instrumentos no falla', () => {
    expect(assignRoles([])).toEqual([]);
  });
});

describe('checkBalance', () => {
  /**
   * El error de orquestacion que no se ve leyendo la partitura nota a nota:
   * cada linea es correcta y la melodia queda enterrada igualmente.
   */
  it('detecta que el acompanamiento tapa a la melodia', () => {
    const report = checkBalance([
      { partId: 'fl', instrument: inst('flute'), role: 'melodia', octaveShift: 0, chordDegree: null },
      { partId: 'tbn1', instrument: inst('trombone'), role: 'armonia', octaveShift: 0, chordDegree: 0 },
      { partId: 'tbn2', instrument: inst('trombone'), role: 'armonia', octaveShift: 0, chordDegree: 1 },
      { partId: 'tba', instrument: inst('tuba'), role: 'bajo', octaveShift: 0, chordDegree: null },
    ]);

    expect(report.issues.some((issue) => issue.includes('tapa a la melodia'))).toBe(true);
  });

  it('acepta un reparto equilibrado', () => {
    const report = checkBalance([
      { partId: 'vln', instrument: inst('violin'), role: 'melodia', octaveShift: 0, chordDegree: null },
      { partId: 'vla', instrument: inst('viola'), role: 'armonia', octaveShift: 0, chordDegree: 0 },
      { partId: 'vc', instrument: inst('cello'), role: 'bajo', octaveShift: 0, chordDegree: null },
    ]);
    expect(report.issues).toEqual([]);
  });

  it('avisa si nadie lleva la melodia', () => {
    const report = checkBalance([
      { partId: 'vla', instrument: inst('viola'), role: 'armonia', octaveShift: 0, chordDegree: 0 },
      { partId: 'vc', instrument: inst('cello'), role: 'bajo', octaveShift: 0, chordDegree: null },
    ]);
    expect(report.issues.some((issue) => issue.includes('primer plano'))).toBe(true);
  });

  it('avisa si nadie sostiene el bajo', () => {
    const report = checkBalance([
      { partId: 'fl', instrument: inst('flute'), role: 'melodia', octaveShift: 0, chordDegree: null },
      { partId: 'ob', instrument: inst('oboe'), role: 'armonia', octaveShift: 0, chordDegree: 0 },
      { partId: 'cl', instrument: inst('clarinet'), role: 'armonia', octaveShift: 0, chordDegree: 1 },
    ]);
    expect(report.issues.some((issue) => issue.includes('cimientos'))).toBe(true);
  });

  it('el peso tiene en cuenta el tamano de la seccion', () => {
    const report = checkBalance([
      { partId: 'vln', instrument: inst('violin'), role: 'melodia', octaveShift: 0, chordDegree: null },
      { partId: 'fl', instrument: inst('flute'), role: 'armonia', octaveShift: 0, chordDegree: 0 },
    ]);
    // Catorce violines pesan mucho mas que dos flautas.
    expect(report.weights['melodia']!).toBeGreaterThan(report.weights['armonia']!);
  });

  it('los que callan no cuentan en el balance', () => {
    const report = checkBalance([
      { partId: 'vln', instrument: inst('violin'), role: 'melodia', octaveShift: 0, chordDegree: null },
      { partId: 'vc', instrument: inst('cello'), role: 'bajo', octaveShift: 0, chordDegree: null },
      { partId: 'tbn', instrument: inst('trombone'), role: 'silencio', octaveShift: 0, chordDegree: null },
    ]);
    expect(report.weights['silencio']).toBeUndefined();
  });
});

describe('materialFor', () => {
  const melody = parseVoice('c5/q d5/q e5/q f5/q').events;
  const chords = [Chord.of('C', 'major'), Chord.of('F', 'major')];

  it('la melodia se pasa tal cual', () => {
    expect(materialFor('melodia', melody, chords, inst('flute'), 0)).toEqual(melody);
  });

  it('el silencio conserva las duraciones', () => {
    const result = materialFor('silencio', melody, chords, inst('flute'), 0);
    expect(result).toHaveLength(4);
    expect(result.every((e) => e.pitches.length === 0)).toBe(true);
  });

  it('el bajo toma la fundamental de cada acorde', () => {
    const result = materialFor('bajo', melody, chords, inst('cello'), 0);
    expect(result.map((e) => e.pitches[0]!.pitchName)).toEqual(['C', 'F']);
  });

  it('la armonia reparte segun el grado asignado', () => {
    const first = materialFor('armonia', melody, chords, inst('viola'), 0);
    const second = materialFor('armonia', melody, chords, inst('viola'), 1);
    expect(first[0]!.pitches[0]!.pitchName).not.toBe(second[0]!.pitches[0]!.pitchName);
  });

  it('el pedal sostiene la fundamental del primer acorde', () => {
    const result = materialFor('pedal', melody, chords, inst('horn'), 0);
    expect(new Set(result.map((e) => e.pitches[0]!.pitchName))).toEqual(new Set(['C']));
    expect(result).toHaveLength(4);
  });

  it('sin acordes, la armonia calla en vez de inventar', () => {
    const result = materialFor('armonia', melody, [], inst('viola'), 0);
    expect(result.every((e) => e.pitches.length === 0)).toBe(true);
  });
});

function centreOf(instrument: { tessitura: { lowest: Pitch; highest: Pitch } }): number {
  return (instrument.tessitura.lowest.midi + instrument.tessitura.highest.midi) / 2;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
