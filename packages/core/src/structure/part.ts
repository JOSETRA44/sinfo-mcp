import { DomainError } from '../errors.js';
import type { Instrument } from '../instrument/instrument.js';
import { Duration } from '../time/duration.js';
import { Voice } from './voice.js';

/**
 * Parte: un instrumento y las voces que toca.
 *
 * Varias voces en una misma parte no es un caso raro: un piano tiene mano
 * derecha e izquierda, un pentagrama de violines primeros puede llevar
 * divisi, y una fuga a cuatro voces cabe en dos partes.
 */
export class Part {
  readonly id: string;
  name: string;
  instrument: Instrument;
  /** Canal MIDI 0..15 fijado a mano; si no, lo asigna el exportador. */
  midiChannel: number | undefined;
  private readonly voiceMap = new Map<string, Voice>();

  constructor(id: string, instrument: Instrument, name?: string) {
    this.id = id;
    this.instrument = instrument;
    this.name = name ?? instrument.name;
    this.midiChannel = undefined;
    // Toda parte nace con una voz: el caso comun no deberia exigir ceremonias.
    this.voiceMap.set(DEFAULT_VOICE_ID, new Voice(DEFAULT_VOICE_ID));
  }

  // ---------------------------------------------------------------- voces

  get voices(): readonly Voice[] {
    return [...this.voiceMap.values()];
  }

  get voiceIds(): readonly string[] {
    return [...this.voiceMap.keys()];
  }

  /** Voz principal, la que se usa cuando no se especifica ninguna. */
  get mainVoice(): Voice {
    return this.voiceMap.get(DEFAULT_VOICE_ID) ?? this.voices[0]!;
  }

  voice(id: string = DEFAULT_VOICE_ID): Voice {
    const found = this.voiceMap.get(id);
    if (!found) {
      throw new DomainError('NOT_FOUND', `La parte "${this.id}" no tiene la voz "${id}"`, {
        part: this.id,
        voice: id,
        available: this.voiceIds,
      });
    }
    return found;
  }

  hasVoice(id: string): boolean {
    return this.voiceMap.has(id);
  }

  /** Devuelve la voz, creandola si no existe. */
  ensureVoice(id: string): Voice {
    const existing = this.voiceMap.get(id);
    if (existing) return existing;
    const created = new Voice(id);
    this.voiceMap.set(id, created);
    return created;
  }

  removeVoice(id: string): boolean {
    if (id === DEFAULT_VOICE_ID) {
      throw new DomainError('INVALID_STRUCTURE', 'No se puede eliminar la voz principal', {
        part: this.id,
      });
    }
    return this.voiceMap.delete(id);
  }

  // --------------------------------------------------------------- lectura

  /** Duracion de la voz mas larga. */
  get duration(): Duration {
    let longest = Duration.ZERO;
    for (const voice of this.voiceMap.values()) {
      if (voice.duration.greaterThan(longest)) longest = voice.duration;
    }
    return longest;
  }

  get isEmpty(): boolean {
    return this.voices.every((voice) => voice.isEmpty);
  }

  get eventCount(): number {
    let total = 0;
    for (const voice of this.voiceMap.values()) total += voice.length;
    return total;
  }

  clone(id: string = this.id): Part {
    const copy = new Part(id, this.instrument, this.name);
    copy.midiChannel = this.midiChannel;
    copy.voiceMap.clear();
    for (const [voiceId, voice] of this.voiceMap) {
      copy.voiceMap.set(voiceId, voice.clone());
    }
    return copy;
  }
}

export const DEFAULT_VOICE_ID = 'v1';
