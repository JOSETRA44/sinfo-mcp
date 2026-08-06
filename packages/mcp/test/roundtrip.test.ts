import {
  Duration,
  KeySignature,
  Score,
  Tempo,
  TimeSignature,
  getInstrument,
  isRest,
  note,
} from '@sinfo/core';
import { readMidi } from '@sinfo/mir';
import { performanceToScore } from '@sinfo/transcribe';
import { MidiFileRenderer } from '@sinfo/render';
import { describe, expect, it } from 'vitest';

/**
 * Ida y vuelta: componer, tocar, transcribir, comparar.
 *
 * Este archivo es la prueba mas valiosa de toda la fase, y sale casi gratis:
 * el motor de composicion genera la verdad de referencia que necesita el de
 * transcripcion. Componemos una obra, la exportamos a MIDI —opcionalmente con
 * humanizacion, que desplaza los ataques como lo haria un interprete—, la
 * volvemos a leer y exigimos recuperar exactamente lo escrito.
 *
 * Sin esto habria que salir a buscar un corpus anotado. Con esto, cada figura
 * que sepamos escribir se convierte automaticamente en un caso de prueba.
 */

/** Melodia de referencia: figuras variadas, incluido un tresillo, sin alteraciones. */
const MELODY: readonly [string, Duration][] = [
  ['C4', Duration.QUARTER],
  ['D4', Duration.QUARTER],
  ['E4', Duration.HALF],
  ['F4', Duration.EIGHTH],
  ['G4', Duration.EIGHTH],
  ['A4', Duration.QUARTER],
  ['B4', Duration.QUARTER],
  ['C5', Duration.QUARTER],
  // Tresillo de negra: tres notas en el tiempo de dos.
  ['B4', Duration.of(1, 6)],
  ['A4', Duration.of(1, 6)],
  ['G4', Duration.of(1, 6)],
  ['F4', Duration.HALF],
  // Cierra en la tonica. Terminar en la mediante dejaria la obra a medio
  // camino entre do mayor y la menor, que comparten las mismas notas: ninguna
  // estimacion de tonalidad puede resolver eso, y no es lo que mide este test.
  ['C4', Duration.WHOLE],
];

function buildReference(): Score {
  const score = new Score('referencia', { title: 'Ida y vuelta' });
  const movement = score.first;
  const start = movement.timeline.timeSignatureChanges[0]?.at ?? Duration.ZERO;
  movement.timeline.setTimeSignature(start, TimeSignature.of(4, 4));
  movement.timeline.setTempo(start, Tempo.of(120));
  movement.timeline.setKey(start, KeySignature.parse('C major'));

  const piano = getInstrument('piano');
  if (!piano) throw new Error('El catalogo deberia tener piano');
  const part = movement.addPart('piano', piano);
  const voice = part.voice('v1');
  for (const [pitch, duration] of MELODY) voice.append(note(pitch, duration));

  return score;
}

/** Notas de una partitura como (posicion, duracion, altura sonante). */
function extract(score: Score): string[] {
  const rows: string[] = [];
  for (const part of score.first.parts) {
    for (const voice of part.voices) {
      let cursor = Duration.ZERO;
      for (const event of voice.events) {
        if (!isRest(event)) {
          const midis = event.pitches.map((pitch) => pitch.midi).join('+');
          rows.push(`${cursor.toString()} ${event.duration.toString()} ${midis}`);
        }
        cursor = cursor.plus(event.duration);
      }
    }
  }
  return rows;
}

/** Alturas ESCRITAS, para comprobar la ortografia de alteraciones. */
function spellings(score: Score): string[] {
  const names: string[] = [];
  for (const part of score.first.parts) {
    for (const voice of part.voices) {
      for (const event of voice.events) {
        if (!isRest(event)) names.push(...event.pitches.map((pitch) => pitch.name));
      }
    }
  }
  return names;
}

function roundTrip(score: Score, humanize?: number): Score {
  const artifact = new MidiFileRenderer().render(score, {
    ...(humanize === undefined ? {} : { humanize, performanceSeed: 'ida-y-vuelta' }),
  });
  const performance = readMidi(artifact.data, { name: 'referencia.mid' });
  return performanceToScore(performance, { scoreId: 'vuelta' }).score;
}

describe('ida y vuelta: partitura -> MIDI -> partitura', () => {
  it('recupera exactamente el ritmo y las alturas de una ejecucion mecanica', () => {
    const reference = buildReference();
    expect(extract(roundTrip(reference))).toEqual(extract(reference));
  });

  it('recupera el tresillo como doceavos exactos, no como aproximacion', () => {
    // El caso que justifica la aritmetica racional: si el tresillo volviera
    // como 0,0833 la partitura quedaria descuadrada compases despues.
    const recovered = roundTrip(buildReference());
    const durations = extract(recovered).map((row) => row.split(' ')[1]);
    expect(durations).toContain('1/6');
  });

  it('recupera la obra aunque se toque con desajuste humano', () => {
    // `humanize` desplaza los ataques como un interprete real. Si el
    // cuantizador funciona, el resultado es indistinguible del mecanico.
    const reference = buildReference();
    expect(extract(roundTrip(reference, 0.3))).toEqual(extract(reference));
  });

  it('aguanta una humanizacion fuerte, de interprete inseguro', () => {
    const reference = buildReference();
    expect(extract(roundTrip(reference, 0.6))).toEqual(extract(reference));
  });

  it('conserva la ortografia diatonica: ni un sostenido inventado', () => {
    const reference = buildReference();
    expect(spellings(roundTrip(reference))).toEqual(spellings(reference));
  });

  it('recupera el compas y el tempo declarados', () => {
    const artifact = new MidiFileRenderer().render(buildReference());
    const result = performanceToScore(readMidi(artifact.data));
    expect(result.timeSignature.toString()).toBe('4/4');
    expect(result.tempo).toBeCloseTo(120, 1);
    expect(result.key.key.name).toBe('C major');
  });
});
