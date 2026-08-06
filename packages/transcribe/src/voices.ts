import type { Duration } from '@sinfo/core';
import type { QuantizedNote } from './quantize.js';

/**
 * Separacion de voces: de un monton de notas a lineas independientes.
 *
 * Hace falta porque una `Voice` es una sucesion: no admite huecos ni
 * solapamientos. Un piano tocando una melodia sobre acordes produce notas que
 * se pisan en el tiempo, y meterlas en la misma voz es imposible.
 *
 * El problema tiene dos mitades que conviene no confundir. Notas que empiezan
 * y acaban a la vez son un ACORDE, una sola cosa con varias alturas. Notas que
 * se solapan pero no coinciden son VOCES distintas, dos cosas simultaneas.
 * Tratar lo primero como voces llena la partitura de lineas fantasma; tratar
 * lo segundo como acordes se come notas.
 */

/** Un ataque: una nota, o varias a la vez que forman acorde. */
export interface NoteGroup {
  readonly position: Duration;
  readonly duration: Duration;
  /** Alturas MIDI, de grave a aguda. Una sola si no es acorde. */
  readonly midis: readonly number[];
  readonly velocity: number;
  readonly confidence: number;
}

export interface SeparateOptions {
  /**
   * Tope de voces simultaneas. Al llegar al tope, en vez de abrir otra se
   * recorta la nota anterior de la voz mas adecuada, que es lo que hace un
   * copista cuando el pentagrama no da para mas.
   */
  readonly maxVoices?: number | undefined;
  /**
   * Cuanto penaliza que dos voces se crucen. Subirlo mantiene las lineas
   * ordenadas por registro aunque salten mas; bajarlo prefiere saltos cortos
   * aunque las voces se enreden.
   */
  readonly crossingPenalty?: number | undefined;
}

const DEFAULTS = { maxVoices: 4, crossingPenalty: 12 } as const;

/**
 * Reparte las notas en voces, cada una una sucesion sin solapes.
 *
 * Devuelve las voces ordenadas de aguda a grave, que es el orden en que se
 * escriben en un pentagrama.
 */
export function separateVoices(
  notes: readonly QuantizedNote[],
  options: SeparateOptions = {},
): NoteGroup[][] {
  const maxVoices = options.maxVoices ?? DEFAULTS.maxVoices;
  const crossingPenalty = options.crossingPenalty ?? DEFAULTS.crossingPenalty;

  const groups = mergeChords(notes);
  if (groups.length === 0) return [];

  const voices: NoteGroup[][] = [];
  /** Final y altura de la ultima nota de cada voz, para decidir la siguiente. */
  const state: { end: Duration; pitch: number }[] = [];

  for (const group of groups) {
    const top = group.midis[group.midis.length - 1] ?? 0;

    let bestIndex = -1;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let v = 0; v < voices.length; v += 1) {
      const current = state[v];
      if (current === undefined) continue;
      // Ocupada: esta voz todavia esta sonando cuando entra este ataque.
      if (current.end.greaterThan(group.position)) continue;

      const cost =
        Math.abs(top - current.pitch) + crossingPenalty * crossings(state, v, top, group.position);
      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = v;
      }
    }

    if (bestIndex === -1 && voices.length < maxVoices) {
      voices.push([group]);
      state.push({ end: group.position.plus(group.duration), pitch: top });
      continue;
    }

    if (bestIndex === -1) {
      // Todas ocupadas y sin cupo: recortar la voz mas cercana en registro.
      const candidate = nearestByPitch(state, top);
      const voice = voices[candidate];
      const last = voice?.[voice.length - 1];
      const trimmed = last === undefined ? null : group.position.minus(last.position);

      if (voice === undefined || last === undefined || trimmed === null || trimmed.isNegative || trimmed.isZero) {
        // Recortar no abre hueco: el ataque anterior empieza justo aqui. Antes
        // que perder la nota o dejar dos sonando a la vez en la misma voz
        // —que `Voice.append` rechazaria—, se abre otra. El tope es una
        // preferencia de legibilidad, no un invariante.
        voices.push([group]);
        state.push({ end: group.position.plus(group.duration), pitch: top });
        continue;
      }

      voice[voice.length - 1] = { ...last, duration: trimmed };
      bestIndex = candidate;
    }

    voices[bestIndex]?.push(group);
    const slot = state[bestIndex];
    if (slot !== undefined) {
      slot.end = group.position.plus(group.duration);
      slot.pitch = top;
    }
  }

  // De aguda a grave: es el orden en que se leen las voces de un pentagrama.
  return voices
    .map((voice, index) => ({ voice, pitch: state[index]?.pitch ?? 0 }))
    .sort((a, b) => averagePitch(b.voice) - averagePitch(a.voice))
    .map((entry) => entry.voice);
}

// --------------------------------------------------------------- interiores

/**
 * Funde en acordes las notas que empiezan Y acaban a la vez.
 *
 * Exigir que coincidan tambien al final no es quisquilloseria: un bajo tenido
 * bajo una melodia empieza con ella pero dura mas, y convertirlo en acorde le
 * robaria la duracion a uno de los dos. Al quedar en voces distintas, cada uno
 * conserva la suya.
 */
function mergeChords(notes: readonly QuantizedNote[]): NoteGroup[] {
  const buckets = new Map<string, QuantizedNote[]>();
  for (const note of notes) {
    const key = `${note.position.toString()}|${note.duration.toString()}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [note]);
    else bucket.push(note);
  }

  const groups: NoteGroup[] = [];
  for (const bucket of buckets.values()) {
    const first = bucket[0];
    if (first === undefined) continue;
    const midis = bucket.map((note) => note.midi).sort((a, b) => a - b);
    groups.push({
      position: first.position,
      duration: first.duration,
      midis,
      velocity: Math.round(
        bucket.reduce((sum, note) => sum + note.velocity, 0) / bucket.length,
      ),
      confidence: Math.min(...bucket.map((note) => note.confidence)),
    });
  }

  return groups.sort(
    (a, b) => a.position.compare(b.position) || (a.midis[0] ?? 0) - (b.midis[0] ?? 0),
  );
}

/**
 * Cuantas voces quedarian desordenadas si este ataque fuese a la voz `target`.
 *
 * Solo cuentan las voces que estan sonando ahora mismo: cruzarse con una voz
 * que lleva dos compases callada no es un cruce, es una entrada.
 */
function crossings(
  state: readonly { end: Duration; pitch: number }[],
  target: number,
  pitch: number,
  position: Duration,
): number {
  const reference = state[target];
  if (reference === undefined) return 0;
  let count = 0;
  for (let v = 0; v < state.length; v += 1) {
    if (v === target) continue;
    const other = state[v];
    if (other === undefined || !other.end.greaterThan(position)) continue;
    // La voz aguda debe quedar arriba y la grave abajo; si el orden por indice
    // y el orden por altura discrepan, hay cruce.
    const wasAbove = reference.pitch > other.pitch;
    const wouldBeAbove = pitch > other.pitch;
    if (wasAbove !== wouldBeAbove) count += 1;
  }
  return count;
}

function nearestByPitch(state: readonly { pitch: number }[], pitch: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let v = 0; v < state.length; v += 1) {
    const distance = Math.abs((state[v]?.pitch ?? 0) - pitch);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = v;
    }
  }
  return best;
}

function averagePitch(voice: readonly NoteGroup[]): number {
  if (voice.length === 0) return 0;
  let sum = 0;
  let count = 0;
  for (const group of voice) {
    for (const midi of group.midis) {
      sum += midi;
      count += 1;
    }
  }
  return count === 0 ? 0 : sum / count;
}
