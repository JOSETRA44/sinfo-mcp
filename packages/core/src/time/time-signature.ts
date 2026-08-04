import { invalid } from '../errors.js';
import { Duration } from './duration.js';

/** Denominadores admitidos: solo potencias de dos son figuras reales. */
const VALID_DENOMINATORS = new Set([1, 2, 4, 8, 16, 32, 64]);

/**
 * Compas (indicacion de compas).
 *
 * `numerator/denominator` en el sentido habitual: 4/4, 3/4, 6/8, 7/8, 2/2.
 */
export class TimeSignature {
  readonly numerator: number;
  readonly denominator: number;

  private constructor(numerator: number, denominator: number) {
    this.numerator = numerator;
    this.denominator = denominator;
    Object.freeze(this);
  }

  static of(numerator: number, denominator: number): TimeSignature {
    if (!Number.isInteger(numerator) || numerator < 1 || numerator > 64) {
      invalid('INVALID_TIME_SIGNATURE', 'El numerador debe ser un entero entre 1 y 64', {
        numerator,
      });
    }
    if (!VALID_DENOMINATORS.has(denominator)) {
      invalid(
        'INVALID_TIME_SIGNATURE',
        `El denominador debe ser una potencia de dos entre 1 y 64, no ${denominator}`,
        { denominator },
      );
    }
    return new TimeSignature(numerator, denominator);
  }

  /** Interpreta `"4/4"`, `"6/8"`, `"C"` (comun) o `"C|"` (partido). */
  static parse(text: string): TimeSignature {
    const trimmed = text.trim();
    if (trimmed === 'C') return TimeSignature.COMMON;
    if (trimmed === 'C|' || trimmed === '¢') return TimeSignature.CUT;

    const match = /^(\d+)\s*\/\s*(\d+)$/.exec(trimmed);
    if (!match) {
      invalid('INVALID_TIME_SIGNATURE', `Compas no reconocido: "${text}"`, { text });
    }
    const [, num, den] = match as unknown as [string, string, string];
    return TimeSignature.of(Number.parseInt(num, 10), Number.parseInt(den, 10));
  }

  static readonly COMMON = TimeSignature.of(4, 4);
  static readonly CUT = TimeSignature.of(2, 2);
  static readonly WALTZ = TimeSignature.of(3, 4);

  /** Duracion exacta de un compas completo, en redondas. */
  get measureDuration(): Duration {
    return Duration.of(this.numerator, this.denominator);
  }

  /** Figura que representa un pulso: negra en 4/4, negra con puntillo en 6/8. */
  get beatUnit(): Duration {
    const unit = Duration.of(1, this.denominator);
    return this.isCompound ? unit.dotted() : unit;
  }

  /** Pulsos reales por compas: 4 en 4/4, 2 en 6/8 (no 6). */
  get beatsPerMeasure(): number {
    return this.isCompound ? this.numerator / 3 : this.numerator;
  }

  /** Compas compuesto: numerador multiplo de 3 mayor que 3 y denominador >= 8. */
  get isCompound(): boolean {
    return this.numerator % 3 === 0 && this.numerator > 3 && this.denominator >= 8;
  }

  /** Compas irregular: 5/8, 7/8, 11/16... */
  get isIrregular(): boolean {
    return !this.isCompound && ![2, 3, 4].includes(this.numerator);
  }

  equals(other: TimeSignature): boolean {
    return this.numerator === other.numerator && this.denominator === other.denominator;
  }

  toString(): string {
    return `${this.numerator}/${this.denominator}`;
  }

  toJSON(): { numerator: number; denominator: number } {
    return { numerator: this.numerator, denominator: this.denominator };
  }
}
