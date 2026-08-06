import { Duration } from '@sinfo/core';
import { describe, expect, it } from 'vitest';
import type { QuantizedNote } from './quantize.js';
import { separateVoices } from './voices.js';

/** Nota en negras: posicion y duracion se leen mejor asi que en redondas. */
const note = (quarters: number, lengthQuarters: number, midi: number): QuantizedNote => ({
  position: Duration.of(quarters, 4),
  duration: Duration.of(lengthQuarters, 4),
  midi,
  velocity: 80,
  confidence: 1,
});

const shape = (voices: readonly { midis: readonly number[] }[][]): number[][][] =>
  voices.map((voice) => voice.map((group) => [...group.midis]));

describe('separateVoices', () => {
  it('deja una melodia sola en una unica voz', () => {
    const voices = separateVoices([note(0, 1, 60), note(1, 1, 62), note(2, 1, 64)]);
    expect(voices).toHaveLength(1);
    expect(shape(voices)).toEqual([[[60], [62], [64]]]);
  });

  it('funde en acorde las notas que empiezan y acaban a la vez', () => {
    const voices = separateVoices([note(0, 2, 60), note(0, 2, 64), note(0, 2, 67)]);
    expect(voices).toHaveLength(1);
    expect(shape(voices)).toEqual([[[60, 64, 67]]]);
  });

  it('separa en voces lo que empieza junto pero dura distinto', () => {
    // Un bajo tenido bajo dos negras de melodia. Convertirlo en acorde le
    // robaria la duracion a uno de los dos.
    const voices = separateVoices([note(0, 4, 48), note(0, 2, 72), note(2, 2, 74)]);
    expect(voices).toHaveLength(2);
    expect(shape(voices)).toEqual([
      [[72], [74]],
      [[48]],
    ]);
  });

  it('devuelve las voces de aguda a grave', () => {
    const voices = separateVoices([note(0, 4, 48), note(0, 1, 72), note(0, 2, 60)]);
    expect(shape(voices)).toEqual([[[72]], [[60]], [[48]]]);
  });

  it('reutiliza una voz en cuanto queda libre, sin abrir otra', () => {
    const voices = separateVoices([note(0, 1, 60), note(1, 1, 62), note(2, 1, 61)]);
    expect(voices).toHaveLength(1);
  });

  it('mantiene cada linea en su registro en vez de saltar a la mas cercana', () => {
    // Melodia aguda en negras sobre un bajo en blancas. Sin memoria de
    // registro, la asignacion voraz iria trenzando las dos lineas.
    const notes: QuantizedNote[] = [];
    for (let i = 0; i < 6; i += 1) notes.push(note(i, 1, 72 + (i % 3)));
    for (let i = 0; i < 6; i += 2) notes.push(note(i, 2, 48 + (i % 3)));

    const voices = separateVoices(notes);
    expect(voices).toHaveLength(2);
    const [high, low] = voices;
    expect(high?.every((group) => (group.midis[0] ?? 0) >= 72)).toBe(true);
    expect(low?.every((group) => (group.midis[0] ?? 0) < 60)).toBe(true);
  });

  it('funde en acorde lo que cabe en una mano', () => {
    // Mismo ataque, misma duracion y a distancia de acorde: es un acorde.
    const notes: QuantizedNote[] = [];
    for (let i = 0; i < 4; i += 1) notes.push(note(i, 1, 67), note(i, 1, 60));
    const voices = separateVoices(notes);
    expect(voices).toHaveLength(1);
    expect(shape(voices)[0]?.[0]).toEqual([60, 67]);
  });

  it('NO funde melodia y bajo aunque caigan a la vez', () => {
    // El caso del vals de piano: melodia y bajo coinciden en el primer tiempo
    // de cada compas. Fundirlos daria un acorde de dos octavas de ancho en vez
    // de las dos lineas que son, y ningun copista lo escribiria asi.
    const notes: QuantizedNote[] = [];
    for (let i = 0; i < 4; i += 1) notes.push(note(i, 1, 82), note(i, 1, 46));

    const voices = separateVoices(notes);
    expect(voices).toHaveLength(2);
    expect(voices[0]?.every((group) => group.midis.length === 1)).toBe(true);
    expect(voices[1]?.every((group) => group.midis.length === 1)).toBe(true);
  });

  it('parte el acorde solo por el hueco, conservando los racimos', () => {
    // Tres notas juntas abajo y una suelta muy arriba: acorde y linea, no un
    // unico bloque ni cuatro voces sueltas.
    const voices = separateVoices([
      note(0, 1, 48),
      note(0, 1, 52),
      note(0, 1, 55),
      note(0, 1, 84),
    ]);
    expect(shape(voices)).toEqual([[[84]], [[48, 52, 55]]]);
  });

  it('ninguna voz se solapa consigo misma, que es el invariante de Voice', () => {
    // Material denso a proposito: acordes con duraciones dispares encadenados.
    const notes: QuantizedNote[] = [];
    for (let i = 0; i < 8; i += 1) {
      notes.push(note(i, 4, 40 + i), note(i, 2, 55 + i), note(i, 1, 70 + i));
    }
    for (const voice of separateVoices(notes)) {
      for (let i = 1; i < voice.length; i += 1) {
        const previous = voice[i - 1];
        const current = voice[i];
        if (previous === undefined || current === undefined) continue;
        const end = previous.position.plus(previous.duration);
        expect(end.greaterThan(current.position)).toBe(false);
      }
    }
  });

  it('respeta el tope de voces recortando en vez de abrir otra', () => {
    // Seis notas largas que se van encabalgando. Al llegar al tope, la voz
    // mas cercana en registro cede el final de su nota.
    const notes: QuantizedNote[] = [];
    for (let i = 0; i < 6; i += 1) notes.push(note(i, 8, 50 + i * 3));
    const voices = separateVoices(notes, { maxVoices: 3 });
    expect(voices).toHaveLength(3);
    expect(voices.flat()).toHaveLength(6);
  });

  it('se salta el tope antes que perder una nota o solapar dos', () => {
    // Seis ataques simultaneos: recortar no puede abrir hueco porque no hay
    // hueco que abrir. El tope es legibilidad; el invariante de Voice no se
    // negocia, asi que gana el invariante.
    const notes: QuantizedNote[] = [];
    for (let i = 0; i < 6; i += 1) notes.push(note(0, 8 - i, 50 + i * 4));
    const voices = separateVoices(notes, { maxVoices: 3 });
    expect(voices.flat()).toHaveLength(6);
    expect(voices.length).toBeGreaterThan(3);
  });

  it('no falla con una entrada vacia', () => {
    expect(separateVoices([])).toEqual([]);
  });
});
