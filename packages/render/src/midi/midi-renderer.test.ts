import {
  Duration,
  INSTRUMENTS,
  KeySignature,
  note,
  parseGrid,
  parseVoice,
  Score,
  Tempo,
  TimeSignature,
} from '@sinfo/core';
import { parseMidi, type MidiEvent } from 'midi-file';
import { describe, expect, it } from 'vitest';
import { MidiFileRenderer } from './midi-renderer.js';

const renderer = new MidiFileRenderer();

/** Los tests fijan velocity explicita para no depender de la curva de dinamicas. */
function withVelocity(source: string, velocity = 80) {
  return parseVoice(source).events.map((event) => ({ ...event, velocity }));
}

function build(configure: (score: Score) => void): Score {
  const score = new Score('s1', { title: 'Prueba', composer: 'Claude' });
  configure(score);
  return score;
}

/** Posiciones absolutas en ticks, reconstruidas desde los tiempos delta. */
function absoluteEvents(track: readonly MidiEvent[]): { tick: number; event: MidiEvent }[] {
  let tick = 0;
  return track.map((event) => {
    tick += event.deltaTime;
    return { tick, event };
  });
}

function noteOnsOf(track: readonly MidiEvent[]) {
  return absoluteEvents(track).filter(
    (entry): entry is { tick: number; event: MidiEvent & { type: 'noteOn' } } =>
      entry.event.type === 'noteOn',
  );
}

describe('MidiFileRenderer', () => {
  it('produce un archivo MIDI que se puede volver a leer', () => {
    const score = build((s) => {
      const part = s.first.addPart('vln', INSTRUMENTS['violin']!);
      part.mainVoice.append(...withVelocity('c4/q e4/q g4/q c5/q'));
    });

    const artifact = renderer.render(score);
    expect(artifact.format).toBe('midi');
    expect(artifact.mimeType).toBe('audio/midi');
    expect(artifact.filename).toBe('prueba.mid');

    const parsed = parseMidi(artifact.data);
    expect(parsed.header.format).toBe(1);
    expect(parsed.header.ticksPerBeat).toBe(480);
    // Pista 0 de director + una por parte.
    expect(parsed.tracks).toHaveLength(2);
  });

  it('escribe tempo, compas y armadura en la pista de director', () => {
    const score = build((s) => {
      s.first.timeline.setTempo(Duration.ZERO, Tempo.of(120));
      s.first.timeline.setTimeSignature(Duration.ZERO, TimeSignature.parse('3/4'));
      s.first.timeline.setKey(Duration.ZERO, KeySignature.parse('Eb major'));
      s.first.addPart('vln', INSTRUMENTS['violin']!).mainVoice.append(...withVelocity('c4/q'));
    });

    const parsed = parseMidi(renderer.render(score).data);
    const conductor = parsed.tracks[0]!;

    const tempo = conductor.find((e) => e.type === 'setTempo');
    expect(tempo).toMatchObject({ microsecondsPerBeat: 500_000 });

    const timeSignature = conductor.find((e) => e.type === 'timeSignature');
    expect(timeSignature).toMatchObject({ numerator: 3, denominator: 4 });

    // Mi bemol mayor son tres bemoles: fifths = -3, escala mayor = 0.
    const key = conductor.find((e) => e.type === 'keySignature');
    expect(key).toMatchObject({ key: -3, scale: 0 });
  });

  it('coloca las notas en su posicion exacta', () => {
    const score = build((s) => {
      s.first
        .addPart('vln', INSTRUMENTS['violin']!)
        .mainVoice.append(...withVelocity('c4/q e4/h g4/q'));
    });

    const parsed = parseMidi(renderer.render(score).data);
    expect(noteOnsOf(parsed.tracks[1]!).map((entry) => entry.tick)).toEqual([0, 480, 1440]);
  });

  // La razon de ser de la aritmetica racional, comprobada de extremo a extremo.
  it('no acumula deriva en 200 compases de tresillos', () => {
    const tripletEighth = Duration.EIGHTH.tuplet(3, 2);
    const score = build((s) => {
      const voice = s.first.addPart('vln', INSTRUMENTS['violin']!).mainVoice;
      for (let i = 0; i < 200 * 12; i++) {
        voice.append(note('C4', tripletEighth, { velocity: 80 }));
      }
    });

    const onsets = noteOnsOf(parseMidi(renderer.render(score).data).tracks[1]!);
    expect(onsets).toHaveLength(2400);

    // Cada tresillo de corchea son 160 ticks exactos; la ultima nota del
    // compas 200 debe caer en 2399*160, sin un solo tick de desfase.
    expect(onsets.at(-1)?.tick).toBe(2399 * 160);
    // Y cada compas empieza justo donde toca.
    expect(onsets[12 * 199]?.tick).toBe(199 * 1920);
  });

  it('los instrumentos transpositores suenan donde deben', () => {
    const score = build((s) => {
      // El clarinete en Sib suena una segunda mayor por debajo de lo escrito.
      s.first
        .addPart('cl', INSTRUMENTS['clarinet']!)
        .mainVoice.append(...withVelocity('c4/q'));
    });

    const parsed = parseMidi(renderer.render(score).data);
    const [first] = noteOnsOf(parsed.tracks[1]!);
    // Do4 escrito (60) suena Sib3 (58).
    expect(first?.event.noteNumber).toBe(58);
  });

  it('la percusion va al canal 10 y no transpone', () => {
    const score = build((s) => {
      const part = s.first.addPart('dr', INSTRUMENTS['drums']!);
      part.mainVoice.append(...parseGrid('kick x...x...').events);
    });

    const parsed = parseMidi(renderer.render(score).data);
    const onsets = noteOnsOf(parsed.tracks[1]!);

    // Indice 9 = canal 10 de General MIDI.
    expect(onsets[0]?.event.channel).toBe(9);
    expect(onsets[0]?.event.noteNumber).toBe(36);
    // Sin programChange: en percusion el canal ya determina el kit.
    expect(parsed.tracks[1]!.some((e) => e.type === 'programChange')).toBe(false);
  });

  it('asigna el programa General MIDI de cada instrumento', () => {
    const score = build((s) => {
      s.first.addPart('fl', INSTRUMENTS['flute']!).mainVoice.append(...withVelocity('c5/q'));
    });

    const parsed = parseMidi(renderer.render(score).data);
    const program = parsed.tracks[1]!.find((e) => e.type === 'programChange');
    expect(program).toMatchObject({ programNumber: 73 });
  });

  it('el staccato acorta lo que suena pero no mueve la nota siguiente', () => {
    const score = build((s) => {
      s.first
        .addPart('vln', INSTRUMENTS['violin']!)
        .mainVoice.append(...withVelocity('c4/q+stacc e4/q'));
    });

    const parsed = parseMidi(renderer.render(score).data);
    const events = absoluteEvents(parsed.tracks[1]!);

    const firstOff = events.find((e) => e.event.type === 'noteOff');
    // Media negra: 240 ticks en vez de 480.
    expect(firstOff?.tick).toBe(240);
    // La segunda nota sigue empezando en su sitio.
    expect(noteOnsOf(parsed.tracks[1]!)[1]?.tick).toBe(480);
  });

  it('cada parte va en su propia pista con su nombre', () => {
    const score = build((s) => {
      s.first.addPart('vln1', INSTRUMENTS['violin']!, 'Violin I').mainVoice
        .append(...withVelocity('c5/q'));
      s.first.addPart('vc', INSTRUMENTS['cello']!, 'Violonchelo').mainVoice
        .append(...withVelocity('c3/q'));
    });

    const parsed = parseMidi(renderer.render(score).data);
    expect(parsed.tracks).toHaveLength(3);

    const names = parsed.tracks.map(
      (track) => track.find((e) => e.type === 'trackName') as { text?: string } | undefined,
    );
    expect(names.map((n) => n?.text)).toEqual(['Prueba', 'Violin I', 'Violonchelo']);
  });

  it('concatena los movimientos uno detras de otro', () => {
    const score = build((s) => {
      s.first.addPart('vln', INSTRUMENTS['violin']!).mainVoice.append(...withVelocity('c4/w'));
      const second = s.addMovement('m2', 'Andante');
      second.addPart('vln', INSTRUMENTS['violin']!).mainVoice.append(...withVelocity('e4/w'));
    });

    const parsed = parseMidi(renderer.render(score).data);
    // Una sola pista de violin, con las notas de los dos movimientos.
    expect(parsed.tracks).toHaveLength(2);

    const onsets = noteOnsOf(parsed.tracks[1]!);
    expect(onsets.map((o) => o.tick)).toEqual([0, 1920]);
    expect(onsets.map((o) => o.event.noteNumber)).toEqual([60, 64]);
  });

  it('permite exportar un solo movimiento', () => {
    const score = build((s) => {
      s.first.addPart('vln', INSTRUMENTS['violin']!).mainVoice.append(...withVelocity('c4/w'));
      s.addMovement('m2', 'Andante')
        .addPart('vln', INSTRUMENTS['violin']!)
        .mainVoice.append(...withVelocity('e4/w'));
    });

    const parsed = parseMidi(renderer.render(score, { movementId: 'm2' }).data);
    const onsets = noteOnsOf(parsed.tracks[1]!);
    expect(onsets).toHaveLength(1);
    expect(onsets[0]?.event.noteNumber).toBe(64);
  });

  it('las notas repetidas se apagan antes de volver a sonar', () => {
    const score = build((s) => {
      s.first
        .addPart('vln', INSTRUMENTS['violin']!)
        .mainVoice.append(...withVelocity('c4/q c4/q'));
    });

    const parsed = parseMidi(renderer.render(score).data);
    const events = absoluteEvents(parsed.tracks[1]!).filter(
      (e) => e.event.type === 'noteOn' || e.event.type === 'noteOff',
    );

    // En el tick 480 coinciden el apagado de la primera y el encendido de la
    // segunda: el noteOff tiene que ir primero o la nota se corta sola.
    const atBoundary = events.filter((e) => e.tick === 480);
    expect(atBoundary.map((e) => e.event.type)).toEqual(['noteOff', 'noteOn']);
  });

  it('informa de lo exportado sin volcar la partitura', () => {
    const score = build((s) => {
      s.first
        .addPart('vln', INSTRUMENTS['violin']!)
        .mainVoice.append(...withVelocity('c4/q e4/q g4/q c5/q'));
    });

    const { meta } = renderer.render(score);
    expect(meta).toMatchObject({ ppq: 480, tracks: 2, parts: 1, movements: 1, noteCount: 4 });
  });
});
