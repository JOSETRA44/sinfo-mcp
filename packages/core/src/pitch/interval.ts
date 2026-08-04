import { invalid } from '../errors.js';

/**
 * Intervalo musical con DOS componentes: diatonico y cromatico.
 *
 * Guardar solo los semitonos no basta. Una cuarta aumentada y una quinta
 * disminuida miden ambas 6 semitonos, pero escriben notas distintas: Fa-Si
 * frente a Fa-Do bemol. Si el intervalo no recuerda cuantos grados de la
 * escala abarca, la transposicion produce partituras mal escritas.
 *
 * - `diatonic`: grados de escala recorridos, con signo. 0 = unisono,
 *   1 = segunda, 4 = quinta, 7 = octava. Negativo = descendente.
 * - `chromatic`: semitonos, con signo.
 */
export class Interval {
  readonly diatonic: number;
  readonly chromatic: number;

  private constructor(diatonic: number, chromatic: number) {
    this.diatonic = diatonic;
    this.chromatic = chromatic;
    Object.freeze(this);
  }

  static of(diatonic: number, chromatic: number): Interval {
    if (!Number.isInteger(diatonic) || !Number.isInteger(chromatic)) {
      invalid('INVALID_INTERVAL', 'diatonic y chromatic deben ser enteros', {
        diatonic,
        chromatic,
      });
    }
    return new Interval(diatonic, chromatic);
  }

  static readonly UNISON = Interval.of(0, 0);
  static readonly MINOR_SECOND = Interval.of(1, 1);
  static readonly MAJOR_SECOND = Interval.of(1, 2);
  static readonly MINOR_THIRD = Interval.of(2, 3);
  static readonly MAJOR_THIRD = Interval.of(2, 4);
  static readonly PERFECT_FOURTH = Interval.of(3, 5);
  static readonly TRITONE = Interval.of(3, 6);
  static readonly PERFECT_FIFTH = Interval.of(4, 7);
  static readonly MINOR_SIXTH = Interval.of(5, 8);
  static readonly MAJOR_SIXTH = Interval.of(5, 9);
  static readonly MINOR_SEVENTH = Interval.of(6, 10);
  static readonly MAJOR_SEVENTH = Interval.of(6, 11);
  static readonly OCTAVE = Interval.of(7, 12);

  /**
   * Interpreta nombres estandar: `P5`, `m3`, `M6`, `A4`, `d5`, `P8`, `AA4`.
   * Un guion delante lo hace descendente: `-P5`.
   */
  static parse(name: string): Interval {
    const text = name.trim();
    const match = /^(-)?(P|M|m|A+|d+)(\d+)$/.exec(text);
    if (!match) {
      invalid('INVALID_INTERVAL', `Nombre de intervalo no reconocido: "${name}"`, { name });
    }
    const [, sign, quality, numberText] = match as unknown as [
      string,
      string | undefined,
      string,
      string,
    ];

    const number = Number.parseInt(numberText, 10);
    if (number < 1) {
      invalid('INVALID_INTERVAL', 'El numero de intervalo empieza en 1 (unisono)', { name });
    }

    const diatonic = number - 1;
    const degree = diatonic % 7;
    const octaves = Math.floor(diatonic / 7);
    const base = BASE_SEMITONES[degree]! + 12 * octaves;
    const perfectable = PERFECTABLE.has(degree);

    let offset: number;
    if (quality === 'P') {
      if (!perfectable) {
        invalid(
          'INVALID_INTERVAL',
          `Una ${number}a no puede ser justa; usa M o m`,
          { name },
        );
      }
      offset = 0;
    } else if (quality === 'M' || quality === 'm') {
      if (perfectable) {
        invalid(
          'INVALID_INTERVAL',
          `Una ${number}a no puede ser mayor ni menor; usa P`,
          { name },
        );
      }
      offset = quality === 'M' ? 0 : -1;
    } else if (quality.startsWith('A')) {
      offset = quality.length;
    } else {
      // Disminuido: desde justo baja 1, desde mayor baja 2 (pasa por menor).
      offset = perfectable ? -quality.length : -quality.length - 1;
    }

    const chromatic = base + offset;
    const signed = sign === '-' ? -1 : 1;
    return Interval.of(diatonic * signed, chromatic * signed);
  }

  // ------------------------------------------------------------- propiedades

  /** Numero del intervalo en notacion musical: 1 = unisono, 5 = quinta. */
  get number(): number {
    return Math.abs(this.diatonic) + 1;
  }

  get isDescending(): boolean {
    return this.diatonic < 0 || (this.diatonic === 0 && this.chromatic < 0);
  }

  /** Semitonos dentro de una octava, 0..11. */
  get pitchClassDistance(): number {
    return ((this.chromatic % 12) + 12) % 12;
  }

  /** Calidad: `P`, `M`, `m`, `A`/`AA`, `d`/`dd`. */
  get quality(): string {
    const absDiatonic = Math.abs(this.diatonic);
    const absChromatic = Math.abs(this.chromatic);
    const degree = absDiatonic % 7;
    const octaves = Math.floor(absDiatonic / 7);
    const base = BASE_SEMITONES[degree]! + 12 * octaves;
    const offset = absChromatic - base;
    const perfectable = PERFECTABLE.has(degree);

    if (offset === 0) return perfectable ? 'P' : 'M';
    if (!perfectable && offset === -1) return 'm';
    if (offset > 0) return 'A'.repeat(offset);
    return 'd'.repeat(perfectable ? -offset : -offset - 1);
  }

  get name(): string {
    return `${this.isDescending ? '-' : ''}${this.quality}${this.number}`;
  }

  // ------------------------------------------------------------- operaciones

  inverted(): Interval {
    return Interval.of(-this.diatonic, -this.chromatic);
  }

  plus(other: Interval): Interval {
    return Interval.of(this.diatonic + other.diatonic, this.chromatic + other.chromatic);
  }

  minus(other: Interval): Interval {
    return Interval.of(this.diatonic - other.diatonic, this.chromatic - other.chromatic);
  }

  equals(other: Interval): boolean {
    return this.diatonic === other.diatonic && this.chromatic === other.chromatic;
  }

  /** true si suena igual aunque se escriba distinto (4a aum. frente a 5a dism.). */
  isEnharmonicWith(other: Interval): boolean {
    return this.chromatic === other.chromatic;
  }

  get isConsonant(): boolean {
    return CONSONANT_QUALITIES.has(`${this.quality}${((this.number - 1) % 7) + 1}`);
  }

  toString(): string {
    return this.name;
  }

  toJSON(): { diatonic: number; chromatic: number; name: string } {
    return { diatonic: this.diatonic, chromatic: this.chromatic, name: this.name };
  }
}

/** Semitonos de cada grado en su forma justa o mayor. */
const BASE_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;

/** Grados que admiten calidad "justa" en vez de mayor/menor: 1a, 4a, 5a. */
const PERFECTABLE = new Set([0, 3, 4]);

/** Consonancias de la practica comun (la 4a justa es condicional; aqui no cuenta). */
const CONSONANT_QUALITIES = new Set(['P1', 'm3', 'M3', 'P5', 'm6', 'M6', 'P8']);
