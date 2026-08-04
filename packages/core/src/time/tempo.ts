import { invalid } from '../errors.js';
import { Duration } from './duration.js';

/**
 * Tempo: pulsos por minuto referidos a una figura concreta.
 *
 * Guardar solo el numero no basta: negra = 120 y blanca = 120 son velocidades
 * distintas. La figura de referencia es parte del dato.
 */
export class Tempo {
  readonly bpm: number;
  readonly beatUnit: Duration;

  private constructor(bpm: number, beatUnit: Duration) {
    this.bpm = bpm;
    this.beatUnit = beatUnit;
    Object.freeze(this);
  }

  static of(bpm: number, beatUnit: Duration = Duration.QUARTER): Tempo {
    if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 800) {
      invalid('INVALID_TEMPO', 'El tempo debe estar entre 0 y 800 bpm', { bpm });
    }
    if (beatUnit.isZero || beatUnit.isNegative) {
      invalid('INVALID_TEMPO', 'La figura de referencia debe ser positiva', {
        beatUnit: beatUnit.toString(),
      });
    }
    return new Tempo(bpm, beatUnit);
  }

  /**
   * Interpreta una indicacion italiana comun. Devuelve un tempo por defecto
   * dentro del rango habitual de cada marca.
   */
  static fromMarking(marking: string): Tempo {
    const key = marking.trim().toLowerCase();
    const bpm = ITALIAN_MARKINGS[key];
    if (bpm === undefined) {
      invalid('INVALID_TEMPO', `Indicacion de tempo no reconocida: "${marking}"`, {
        marking,
        known: Object.keys(ITALIAN_MARKINGS),
      });
    }
    return Tempo.of(bpm);
  }

  /** Microsegundos por negra: el formato que exige el meta-evento MIDI. */
  get microsecondsPerQuarter(): number {
    return Math.round(60_000_000 / this.quarterNotesPerMinute);
  }

  /** Negras por minuto, normalizando la figura de referencia. */
  get quarterNotesPerMinute(): number {
    return this.bpm * (this.beatUnit.quarters);
  }

  /** Cuantos segundos dura la duracion dada a este tempo. */
  secondsFor(duration: Duration): number {
    return (duration.quarters / this.quarterNotesPerMinute) * 60;
  }

  /** Marca italiana mas cercana a este tempo. */
  get marking(): string {
    let best = 'moderato';
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [name, bpm] of Object.entries(ITALIAN_MARKINGS)) {
      const distance = Math.abs(bpm - this.quarterNotesPerMinute);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = name;
      }
    }
    return best;
  }

  equals(other: Tempo): boolean {
    return this.bpm === other.bpm && this.beatUnit.equals(other.beatUnit);
  }

  toString(): string {
    return `${this.beatUnit.toString()} = ${this.bpm}`;
  }

  toJSON(): { bpm: number; beatUnit: { num: number; den: number } } {
    return { bpm: this.bpm, beatUnit: this.beatUnit.toJSON() };
  }
}

/** Valor central del rango habitual de cada marca, en negras por minuto. */
const ITALIAN_MARKINGS: Readonly<Record<string, number>> = {
  grave: 35,
  largo: 50,
  lento: 55,
  adagio: 70,
  adagietto: 80,
  andante: 92,
  andantino: 100,
  moderato: 112,
  allegretto: 120,
  allegro: 140,
  vivace: 165,
  presto: 184,
  prestissimo: 210,
};
