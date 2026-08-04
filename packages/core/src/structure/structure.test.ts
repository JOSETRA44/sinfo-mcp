import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.js';
import { note, rest } from '../event/event.js';
import { INSTRUMENTS } from '../instrument/instrument.js';
import { KeySignature } from '../pitch/key-signature.js';
import { Duration } from '../time/duration.js';
import { Tempo } from '../time/tempo.js';
import { TimeSignature } from '../time/time-signature.js';
import { Score } from './score.js';
import { Timeline } from './timeline.js';
import { Voice } from './voice.js';

const Q = Duration.QUARTER;

describe('Voice', () => {
  it('acumula duracion al anadir eventos', () => {
    const voice = new Voice('v1');
    voice.append(note('C4', Q), note('D4', Q), rest(Q));
    expect(voice.length).toBe(3);
    expect(voice.duration.toString()).toBe('3/4');
  });

  it('rechaza eventos de duracion cero o negativa', () => {
    const voice = new Voice('v1');
    expect(() => voice.append(note('C4', Duration.ZERO))).toThrow(DomainError);
    expect(() => voice.append(note('C4', Duration.of(-1, 4)))).toThrow(DomainError);
  });

  it('calcula posiciones absolutas', () => {
    const voice = new Voice('v1');
    voice.append(note('C4', Q), note('D4', Duration.HALF), note('E4', Q));
    expect(voice.positioned().map((p) => p.position.toString())).toEqual(['0/1', '1/4', '3/4']);
  });

  it('encuentra el evento que suena en una posicion', () => {
    const voice = new Voice('v1');
    voice.append(note('C4', Q), note('D4', Duration.HALF), note('E4', Q));

    // La blanca ocupa [1/4, 3/4): la posicion 1/2 cae dentro.
    expect(voice.eventAt(Duration.of(1, 2))?.event.pitches[0]?.name).toBe('D4');
    // El limite 3/4 ya pertenece al evento siguiente.
    expect(voice.eventAt(Duration.of(3, 4))?.event.pitches[0]?.name).toBe('E4');
    expect(voice.eventAt(Duration.of(5, 4))).toBeNull();
  });

  it('padTo rellena con silencio solo si falta', () => {
    const voice = new Voice('v1');
    voice.append(note('C4', Q));

    expect(voice.padTo(Duration.WHOLE).toString()).toBe('3/4');
    expect(voice.duration.equals(Duration.WHOLE)).toBe(true);
    // Ya esta cubierto: no anade nada.
    expect(voice.padTo(Duration.HALF).isZero).toBe(true);
    expect(voice.duration.equals(Duration.WHOLE)).toBe(true);
  });

  it('between devuelve los eventos que arrancan en el rango', () => {
    const voice = new Voice('v1');
    voice.append(note('C4', Q), note('D4', Q), note('E4', Q), note('F4', Q));

    const middle = voice.between(Duration.QUARTER, Duration.of(3, 4));
    expect(middle.map((p) => p.event.pitches[0]?.name)).toEqual(['D4', 'E4']);
  });
});

describe('Timeline', () => {
  it('devuelve el valor vigente en cada posicion', () => {
    const timeline = new Timeline(TimeSignature.COMMON, Tempo.of(120), KeySignature.C_MAJOR);
    timeline.setTimeSignature(Duration.of(2, 1), TimeSignature.parse('3/4'));

    expect(timeline.timeSignatureAt(Duration.ZERO).toString()).toBe('4/4');
    expect(timeline.timeSignatureAt(Duration.of(1, 1)).toString()).toBe('4/4');
    expect(timeline.timeSignatureAt(Duration.of(2, 1)).toString()).toBe('3/4');
    expect(timeline.timeSignatureAt(Duration.of(9, 1)).toString()).toBe('3/4');
  });

  it('coloca las barras respetando un cambio de compas a mitad de obra', () => {
    const timeline = new Timeline(TimeSignature.COMMON);
    // Dos compases de 4/4 y luego 3/4.
    timeline.setTimeSignature(Duration.of(2, 1), TimeSignature.parse('3/4'));

    // 3.5 redondas = dos compases de 4/4 (0, 1) y dos de 3/4 (2, 2.75).
    // El 7/2 final es donde ACABA la musica, no donde empieza otro compas.
    const starts = timeline.measureStarts(Duration.of(7, 2));
    expect(starts.map(String)).toEqual(['0/1', '1/1', '2/1', '11/4']);
  });

  it('numera los compases desde 1', () => {
    const timeline = new Timeline(TimeSignature.COMMON);
    expect(timeline.measureNumberAt(Duration.ZERO)).toBe(1);
    expect(timeline.measureNumberAt(Duration.of(3, 4))).toBe(1);
    expect(timeline.measureNumberAt(Duration.of(1, 1))).toBe(2);
    expect(timeline.measureNumberAt(Duration.of(5, 2))).toBe(3);
  });

  it('measureStart es la inversa de measureNumberAt', () => {
    const timeline = new Timeline(TimeSignature.parse('6/8'));
    for (let measure = 1; measure <= 12; measure++) {
      expect(timeline.measureNumberAt(timeline.measureStart(measure))).toBe(measure);
    }
  });
});

describe('Score', () => {
  it('nace con un movimiento; una cancion no es un caso aparte', () => {
    const score = new Score('s1', { title: 'Prueba' });
    expect(score.movementCount).toBe(1);
    expect(score.first.id).toBe('m1');
  });

  it('un movimiento nuevo hereda compas, tempo y tonalidad del anterior', () => {
    const score = new Score('s1', { title: 'Sinfonia' });
    score.first.timeline.setTempo(Duration.ZERO, Tempo.of(60));
    score.first.timeline.setKey(Duration.ZERO, KeySignature.parse('Eb major'));

    const second = score.addMovement('m2', 'Andante');
    expect(second.timeline.tempoAt(Duration.ZERO).bpm).toBe(60);
    expect(second.timeline.keyAt(Duration.ZERO).name).toBe('Eb major');
  });

  it('las lineas de tiempo heredadas son independientes', () => {
    const score = new Score('s1', { title: 'Sinfonia' });
    const second = score.addMovement('m2', 'Andante');
    second.timeline.setTempo(Duration.ZERO, Tempo.of(200));

    expect(score.first.timeline.tempoAt(Duration.ZERO).bpm).not.toBe(200);
  });

  it('no permite quedarse sin movimientos', () => {
    const score = new Score('s1', { title: 'Prueba' });
    expect(() => score.removeMovement('m1')).toThrow(DomainError);
  });

  it('rechaza ids duplicados', () => {
    const score = new Score('s1', { title: 'Prueba' });
    expect(() => score.addMovement('m1', 'Otro')).toThrow(DomainError);
    score.first.addPart('vln', INSTRUMENTS['violin']!);
    expect(() => score.first.addPart('vln', INSTRUMENTS['viola']!)).toThrow(DomainError);
  });

  it('da errores utiles cuando algo no existe', () => {
    const score = new Score('s1', { title: 'Prueba' });
    score.first.addPart('vln', INSTRUMENTS['violin']!);

    try {
      score.first.part('cello');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('NOT_FOUND');
      // El error dice que SI existe, no solo que fallo.
      expect((error as DomainError).details['available']).toEqual(['vln']);
    }
  });

  it('resume sin volcar la partitura entera', () => {
    const score = new Score('s1', { title: 'Cuarteto', composer: 'Claude' });
    const part = score.first.addPart('vln1', INSTRUMENTS['violin']!);
    part.mainVoice.append(note('C4', Q), note('D4', Q), note('E4', Q), note('F4', Q));

    const summary = score.summary();
    expect(summary.title).toBe('Cuarteto');
    expect(summary.eventCount).toBe(4);
    expect(summary.movements[0]?.parts[0]).toMatchObject({
      id: 'vln1',
      instrument: 'violin',
      events: 4,
      measures: 1,
    });
    // El resumen no contiene ni una sola altura.
    expect(JSON.stringify(summary)).not.toContain('C4');
  });
});

describe('Part', () => {
  it('nace con una voz principal', () => {
    const score = new Score('s1', { title: 'Prueba' });
    const part = score.first.addPart('pno', INSTRUMENTS['piano']!);
    expect(part.voiceIds).toEqual(['v1']);
    expect(part.mainVoice.id).toBe('v1');
  });

  it('ensureVoice crea o devuelve sin duplicar', () => {
    const score = new Score('s1', { title: 'Prueba' });
    const part = score.first.addPart('pno', INSTRUMENTS['piano']!);

    const left = part.ensureVoice('lh');
    left.append(note('C2', Q));
    expect(part.ensureVoice('lh')).toBe(left);
    expect(part.voiceIds).toEqual(['v1', 'lh']);
  });

  it('la duracion de la parte es la de su voz mas larga', () => {
    const score = new Score('s1', { title: 'Prueba' });
    const part = score.first.addPart('pno', INSTRUMENTS['piano']!);
    part.mainVoice.append(note('C4', Q));
    part.ensureVoice('lh').append(note('C2', Duration.WHOLE));

    expect(part.duration.equals(Duration.WHOLE)).toBe(true);
  });

  it('no deja borrar la voz principal', () => {
    const score = new Score('s1', { title: 'Prueba' });
    const part = score.first.addPart('pno', INSTRUMENTS['piano']!);
    expect(() => part.removeVoice('v1')).toThrow(DomainError);
  });
});
