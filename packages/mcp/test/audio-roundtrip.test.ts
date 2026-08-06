import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duration, isRest } from '@sinfo/core';
import { AudioFileLoader } from '@sinfo/mir';
import { performanceToScore } from '@sinfo/transcribe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Ida y vuelta por audio: sintetizar, escuchar, transcribir, comparar.
 *
 * El mismo truco que con el MIDI, un escalon mas abajo: se genera la senal a
 * partir de notas conocidas, asi que la verdad de referencia sale gratis y no
 * hace falta ningun corpus grabado.
 *
 * Aqui se comprueba lo que este camino SI puede hacer —una linea melodica
 * sola, que es para lo que sirve un detector monofonico— y tambien se fija por
 * escrito lo que NO, para que nadie lo descubra por sorpresa.
 */

const RATE = 44100;
const BPM = 120;
/** A 120 negras por minuto, la negra dura medio segundo. */
const BEAT = 60 / BPM;

/** Melodia de referencia: cinco negras ascendentes en do mayor. */
const MELODY = [
  { name: 'C4', midi: 60 },
  { name: 'D4', midi: 62 },
  { name: 'E4', midi: 64 },
  { name: 'F4', midi: 65 },
  { name: 'G4', midi: 67 },
];

const frequency = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/**
 * Sintetiza la melodia con armonicos y envolvente.
 *
 * Se le pone envolvente por dos motivos: un tono que arranca de golpe produce
 * un chasquido de banda ancha que despista al detector, y el decaimiento es lo
 * que permite comprobar que el reataque se detecta como debe.
 */
function synthesize(beatsPerNote = 1, gap = 0.12): Float32Array {
  const noteSeconds = BEAT * beatsPerNote;
  const total = Math.round(MELODY.length * noteSeconds * RATE);
  const samples = new Float32Array(total);

  MELODY.forEach((note, index) => {
    const start = Math.round(index * noteSeconds * RATE);
    const sounding = Math.round(noteSeconds * (1 - gap) * RATE);
    const f0 = frequency(note.midi);

    for (let i = 0; i < sounding; i += 1) {
      const t = i / RATE;
      let value = 0;
      for (let h = 1; h <= 6; h += 1) value += Math.sin(2 * Math.PI * f0 * h * t) / h;

      // Ataque de 5 ms y caida suave hasta el final de la nota.
      const attack = Math.min(1, i / (0.005 * RATE));
      const decay = 0.55 + 0.45 * (1 - i / sounding);
      samples[start + i] = value * 0.22 * attack * decay;
    }
  });

  return samples;
}

/** WAV mono de 16 bits: la cabecera minima que hace falta. */
function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  tag(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return bytes;
}

let directory: string;

async function writeClip(name: string, samples: Float32Array): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, encodeWav(samples, RATE));
  return path;
}

/** Notas escritas de una partitura, en orden. */
function written(score: ReturnType<typeof performanceToScore>['score']): string[] {
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

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sinfo-audio-'));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('ida y vuelta por audio', () => {
  it('recupera las alturas de una melodia monofonica', async () => {
    const path = await writeClip('escala.wav', synthesize());
    const performance = await new AudioFileLoader().load(path, { bpm: BPM });

    expect(performance.tracks[0]?.notes).toHaveLength(MELODY.length);

    const result = performanceToScore(performance);
    expect(written(result.score)).toEqual(MELODY.map((note) => note.name));
  });

  it('recupera el ritmo cuando se le declara el tempo', async () => {
    const path = await writeClip('escala.wav', synthesize());
    const performance = await new AudioFileLoader().load(path, { bpm: BPM });
    const result = performanceToScore(performance);

    const onsets = performance.tracks[0]?.notes.map((note) => note.onset) ?? [];
    onsets.forEach((onset, index) => {
      expect(onset).toBeCloseTo(index * BEAT, 1);
    });
    expect(result.timeSignature.toString()).toBe('4/4');
  });

  it('afina cada nota dentro de un cuarto de tono', async () => {
    const path = await writeClip('escala.wav', synthesize());
    const performance = await new AudioFileLoader().load(path, { bpm: BPM });

    performance.tracks[0]?.notes.forEach((note, index) => {
      const expected = MELODY[index]?.midi ?? 0;
      expect(Math.abs(note.midi - expected)).toBeLessThan(0.5);
    });
  });

  it('separa notas repetidas de la misma altura por el reataque', async () => {
    // Sin deteccion de reataque, dos negras iguales seguidas saldrian como una
    // blanca y el ritmo se descuadraria a partir de ahi.
    const noteSeconds = BEAT;
    const samples = new Float32Array(Math.round(2 * noteSeconds * RATE));
    for (let n = 0; n < 2; n += 1) {
      const start = Math.round(n * noteSeconds * RATE);
      const sounding = Math.round(noteSeconds * 0.88 * RATE);
      for (let i = 0; i < sounding; i += 1) {
        const t = i / RATE;
        let value = 0;
        for (let h = 1; h <= 6; h += 1) value += Math.sin(2 * Math.PI * 440 * h * t) / h;
        const attack = Math.min(1, i / (0.005 * RATE));
        samples[start + i] = value * 0.22 * attack * (0.55 + 0.45 * (1 - i / sounding));
      }
    }

    const path = await writeClip('repetida.wav', samples);
    const performance = await new AudioFileLoader().load(path, { bpm: BPM });
    expect(performance.tracks[0]?.notes).toHaveLength(2);
  });

  it('avisa de que ha supuesto el tempo cuando no se le declara', async () => {
    // Sin rejilla no hay contra que medir. El aviso es la unica forma de que
    // el agente sepa que el ritmo puede no significar nada.
    const path = await writeClip('escala.wav', synthesize());
    const performance = await new AudioFileLoader().load(path);
    const result = performanceToScore(performance);

    expect(result.warnings.some((warning) => warning.includes('rejilla de pulso'))).toBe(true);
  });

  it('rechaza un archivo mudo con un mensaje util', async () => {
    const path = await writeClip('mudo.wav', new Float32Array(RATE));
    await expect(new AudioFileLoader().load(path)).rejects.toThrow(/mudo/);
  });

  it('rechaza formatos comprimidos en vez de intentarlo a medias', async () => {
    const path = join(directory, 'cancion.mp3');
    await writeFile(path, new Uint8Array([0, 1, 2]));
    await expect(new AudioFileLoader().load(path)).rejects.toThrow(/WAV sin comprimir/);
  });

  it('ante un acorde devuelve una sola nota, que es su limite conocido', async () => {
    // Se fija por escrito para que el limite este documentado y probado, no
    // descubierto por sorpresa en una cancion real.
    const samples = new Float32Array(RATE);
    for (let i = 0; i < samples.length; i += 1) {
      const t = i / RATE;
      samples[i] =
        0.2 *
        (Math.sin(2 * Math.PI * frequency(60) * t) +
          Math.sin(2 * Math.PI * frequency(64) * t) +
          Math.sin(2 * Math.PI * frequency(67) * t)) /
        3;
    }

    const path = await writeClip('acorde.wav', samples);
    const performance = await new AudioFileLoader().load(path, { bpm: BPM });
    const simultaneous = performance.tracks[0]?.notes.filter((note) => note.onset < 0.3) ?? [];
    expect(simultaneous.length).toBeLessThanOrEqual(1);
  });
});
