import { DomainError, Interval, KeySignature, Pitch, type Mode } from '@sinfo/core';

/**
 * Tipos de escala.
 *
 * Los siete modos griegos mas las tres formas de la menor y las escalas de uso
 * frecuente fuera de la practica comun. La menor melodica se lista solo en su
 * forma ascendente: la descendente coincide con la natural, y guardar las dos
 * como una sola escala obligaria a que todo lo demas supiera en que direccion
 * va la melodia.
 */
export type ScaleType =
  | Mode
  | 'harmonicMinor'
  | 'melodicMinor'
  | 'majorPentatonic'
  | 'minorPentatonic'
  | 'blues'
  | 'wholeTone'
  | 'chromatic'
  | 'octatonic';

/** Intervalos desde la tonica, uno por grado. */
const SCALE_INTERVALS: Readonly<Record<ScaleType, readonly string[]>> = {
  major: ['P1', 'M2', 'M3', 'P4', 'P5', 'M6', 'M7'],
  ionian: ['P1', 'M2', 'M3', 'P4', 'P5', 'M6', 'M7'],
  dorian: ['P1', 'M2', 'm3', 'P4', 'P5', 'M6', 'm7'],
  phrygian: ['P1', 'm2', 'm3', 'P4', 'P5', 'm6', 'm7'],
  lydian: ['P1', 'M2', 'M3', 'A4', 'P5', 'M6', 'M7'],
  mixolydian: ['P1', 'M2', 'M3', 'P4', 'P5', 'M6', 'm7'],
  minor: ['P1', 'M2', 'm3', 'P4', 'P5', 'm6', 'm7'],
  aeolian: ['P1', 'M2', 'm3', 'P4', 'P5', 'm6', 'm7'],
  locrian: ['P1', 'm2', 'm3', 'P4', 'd5', 'm6', 'm7'],
  // La septima mayor de la menor armonica es lo que crea la sensible y hace
  // posible la cadena V-i en modo menor.
  harmonicMinor: ['P1', 'M2', 'm3', 'P4', 'P5', 'm6', 'M7'],
  melodicMinor: ['P1', 'M2', 'm3', 'P4', 'P5', 'M6', 'M7'],
  majorPentatonic: ['P1', 'M2', 'M3', 'P5', 'M6'],
  minorPentatonic: ['P1', 'm3', 'P4', 'P5', 'm7'],
  blues: ['P1', 'm3', 'P4', 'd5', 'P5', 'm7'],
  wholeTone: ['P1', 'M2', 'M3', 'A4', 'A5', 'A6'],
  chromatic: ['P1', 'm2', 'M2', 'm3', 'M3', 'P4', 'A4', 'P5', 'm6', 'M6', 'm7', 'M7'],
  octatonic: ['P1', 'M2', 'm3', 'P4', 'd5', 'm6', 'M6', 'M7'],
};

export const SCALE_TYPES = Object.keys(SCALE_INTERVALS) as ScaleType[];

/**
 * Escala: una tonica y un patron de intervalos.
 *
 * Las alturas se generan transponiendo, no listando semitonos, asi que la
 * escritura sale siempre correcta: Fa sostenido mayor da Mi sostenido como
 * sensible, no Fa natural.
 */
export class Scale {
  readonly tonic: Pitch;
  readonly type: ScaleType;

  private constructor(tonic: Pitch, type: ScaleType) {
    this.tonic = tonic;
    this.type = type;
    Object.freeze(this);
  }

  static of(tonic: Pitch | string, type: ScaleType = 'major'): Scale {
    if (!(type in SCALE_INTERVALS)) {
      throw new DomainError('INVALID_KEY', `Tipo de escala desconocido: "${type}"`, {
        type,
        known: SCALE_TYPES,
      });
    }
    const resolved =
      typeof tonic === 'string'
        ? Pitch.parse(/\d/.test(tonic) ? tonic : `${tonic}4`)
        : tonic;
    return new Scale(resolved, type);
  }

  /** Escala que corresponde a una armadura. */
  static fromKey(key: KeySignature): Scale {
    return Scale.of(key.tonic, key.mode);
  }

  /** Alturas de la escala en una octava, empezando por la tonica. */
  get pitches(): Pitch[] {
    return SCALE_INTERVALS[this.type].map((name) => this.tonic.transpose(Interval.parse(name)));
  }

  get size(): number {
    return SCALE_INTERVALS[this.type].length;
  }

  /**
   * Altura del grado pedido, base 1. Los grados fuera del rango envuelven a la
   * octava siguiente: el grado 9 es el 2 una octava arriba.
   */
  degree(number: number): Pitch {
    if (!Number.isInteger(number) || number < 1) {
      throw new DomainError('INVALID_KEY', 'El grado de la escala empieza en 1', { number });
    }
    const index = (number - 1) % this.size;
    const octaves = Math.floor((number - 1) / this.size);
    const pitch = this.pitches[index]!;
    return octaves === 0 ? pitch : pitch.withOctave(pitch.octave + octaves);
  }

  /** Grado que ocupa la altura, base 1, o null si no pertenece a la escala. */
  degreeOf(pitch: Pitch): number | null {
    const index = this.pitches.findIndex((member) => member.pitchClass === pitch.pitchClass);
    return index < 0 ? null : index + 1;
  }

  contains(pitch: Pitch): boolean {
    return this.degreeOf(pitch) !== null;
  }

  /** Alturas de la escala dentro de un rango, para generar melodias. */
  between(lowest: Pitch, highest: Pitch): Pitch[] {
    const result: Pitch[] = [];
    for (let octave = lowest.octave - 1; octave <= highest.octave + 1; octave++) {
      for (const pitch of this.pitches) {
        const candidate = pitch.withOctave(octave + (pitch.octave - this.tonic.octave));
        if (candidate.midi >= lowest.midi && candidate.midi <= highest.midi) {
          result.push(candidate);
        }
      }
    }
    return result.sort((a, b) => a.compare(b));
  }

  get name(): string {
    return `${this.tonic.pitchName} ${this.type}`;
  }

  toString(): string {
    return this.name;
  }

  toJSON(): { tonic: string; type: ScaleType; pitches: string[] } {
    return {
      tonic: this.tonic.pitchName,
      type: this.type,
      pitches: this.pitches.map((pitch) => pitch.pitchName),
    };
  }
}
