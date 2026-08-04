import { invalid } from '../errors.js';

/**
 * Duracion musical como fraccion EXACTA, en unidades de redonda.
 *
 * Redonda = 1/1, blanca = 1/2, negra = 1/4, corchea = 1/8, tresillo de
 * corchea = 1/12. Un compas de 4/4 mide exactamente 1; uno de 3/4, 3/4.
 *
 * Por que fracciones y no flotantes: un tresillo en coma flotante vale
 * 0.08333333333333333, y ese error se acumula. En una sinfonia de 2000
 * compases eso desalinea las barras de compas y rompe la exportacion a
 * MusicXML. Con racionales, 1/12 + 1/12 + 1/12 es 1/4 exacto, siempre.
 *
 * Inmutable: toda operacion devuelve una Duration nueva.
 */
export class Duration {
  /** Numerador, siempre normalizado por MCD. Puede ser negativo. */
  readonly num: number;
  /** Denominador, siempre positivo y normalizado por MCD. */
  readonly den: number;

  private constructor(num: number, den: number) {
    this.num = num;
    this.den = den;
    Object.freeze(this);
  }

  // ---------------------------------------------------------------- fabricas

  /** Construye a partir de numerador/denominador en unidades de redonda. */
  static of(num: number, den = 1): Duration {
    if (!Number.isInteger(num) || !Number.isInteger(den)) {
      invalid('INVALID_DURATION', 'Numerador y denominador deben ser enteros', { num, den });
    }
    if (den === 0) {
      invalid('INVALID_DURATION', 'El denominador no puede ser cero', { num, den });
    }
    // Normaliza el signo en el numerador para que la comparacion sea trivial.
    let n = den < 0 ? -num : num;
    let d = Math.abs(den);
    const g = gcd(Math.abs(n), d);
    if (g > 1) {
      n /= g;
      d /= g;
    }
    return new Duration(n, d);
  }

  static readonly ZERO = Duration.of(0, 1);
  static readonly WHOLE = Duration.of(1, 1);
  static readonly HALF = Duration.of(1, 2);
  static readonly QUARTER = Duration.of(1, 4);
  static readonly EIGHTH = Duration.of(1, 8);
  static readonly SIXTEENTH = Duration.of(1, 16);
  static readonly THIRTY_SECOND = Duration.of(1, 32);
  static readonly SIXTY_FOURTH = Duration.of(1, 64);

  /** Duracion en negras (util para tempo y para MIDI). */
  static fromQuarters(quarters: number): Duration {
    if (!Number.isInteger(quarters)) {
      invalid('INVALID_DURATION', 'fromQuarters espera un entero; usa Duration.of para fracciones', {
        quarters,
      });
    }
    return Duration.of(quarters, 4);
  }

  static fromTicks(ticks: number, ppq: number): Duration {
    if (ppq <= 0 || !Number.isInteger(ppq)) {
      invalid('INVALID_DURATION', 'ppq debe ser un entero positivo', { ppq });
    }
    return Duration.of(Math.round(ticks), ppq * 4);
  }

  // ------------------------------------------------------------- aritmetica

  plus(other: Duration): Duration {
    return Duration.of(this.num * other.den + other.num * this.den, this.den * other.den);
  }

  minus(other: Duration): Duration {
    return Duration.of(this.num * other.den - other.num * this.den, this.den * other.den);
  }

  /** Multiplica por un entero o por una fraccion `num/den`. */
  times(num: number, den = 1): Duration {
    return Duration.of(this.num * num, this.den * den);
  }

  dividedBy(num: number, den = 1): Duration {
    if (num === 0) {
      invalid('INVALID_DURATION', 'Division por cero', { num, den });
    }
    return Duration.of(this.num * den, this.den * num);
  }

  negated(): Duration {
    return Duration.of(-this.num, this.den);
  }

  /**
   * Aplica puntillos. Un puntillo suma la mitad; dos, la mitad y el cuarto.
   * `q.` = 3/8, `q..` = 7/16.
   */
  dotted(count = 1): Duration {
    if (!Number.isInteger(count) || count < 0 || count > 4) {
      invalid('INVALID_DURATION', 'El numero de puntillos debe estar entre 0 y 4', { count });
    }
    // Formula cerrada: valor * (2^(n+1) - 1) / 2^n
    const factor = 2 ** (count + 1) - 1;
    return this.times(factor, 2 ** count);
  }

  /**
   * Convierte en grupo irregular: `actual` notas en el tiempo de `normal`.
   * Un tresillo es `tuplet(3, 2)`; un quintillo sobre negra, `tuplet(5, 4)`.
   */
  tuplet(actual: number, normal: number): Duration {
    if (!Number.isInteger(actual) || !Number.isInteger(normal) || actual <= 0 || normal <= 0) {
      invalid('INVALID_DURATION', 'actual y normal deben ser enteros positivos', { actual, normal });
    }
    return this.times(normal, actual);
  }

  // ------------------------------------------------------------ comparacion

  /** Negativo si `this < other`, 0 si iguales, positivo si mayor. */
  compare(other: Duration): number {
    return this.num * other.den - other.num * this.den;
  }

  equals(other: Duration): boolean {
    return this.num === other.num && this.den === other.den;
  }

  lessThan(other: Duration): boolean {
    return this.compare(other) < 0;
  }

  greaterThan(other: Duration): boolean {
    return this.compare(other) > 0;
  }

  get isZero(): boolean {
    return this.num === 0;
  }

  get isNegative(): boolean {
    return this.num < 0;
  }

  // ------------------------------------------------------------ conversion

  /** Valor en redondas como flotante. Solo para mostrar o comparar aproximado. */
  get value(): number {
    return this.num / this.den;
  }

  /** Valor en negras como flotante. */
  get quarters(): number {
    return (this.num * 4) / this.den;
  }

  /**
   * Ticks MIDI, redondeado. Para posiciones absolutas usa esto UNA vez sobre
   * la posicion acumulada, nunca sumando duraciones ya redondeadas: redondear
   * cada delta por separado hace que el error se acumule.
   */
  toTicks(ppq: number): number {
    return Math.round((this.num * 4 * ppq) / this.den);
  }

  /** true si la duracion cae exactamente en la rejilla de ticks dada. */
  isExactInTicks(ppq: number): boolean {
    return (this.num * 4 * ppq) % this.den === 0;
  }

  valueOf(): number {
    return this.value;
  }

  toString(): string {
    return `${this.num}/${this.den}`;
  }

  toJSON(): { num: number; den: number } {
    return { num: this.num, den: this.den };
  }
}

// -------------------------------------------------------------------- suma

/** Suma exacta de una lista de duraciones. */
export function sumDurations(durations: readonly Duration[]): Duration {
  let total = Duration.ZERO;
  for (const d of durations) total = total.plus(d);
  return total;
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a === 0 ? 1 : a;
}
