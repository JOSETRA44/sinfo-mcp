import { invalid } from '../errors.js';
import { Pitch, type Step } from './pitch.js';

export type Mode =
  | 'major'
  | 'minor'
  | 'ionian'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'aeolian'
  | 'locrian';

/**
 * Desplazamiento de cada modo respecto a su mayor con la misma tonica, en
 * pasos del circulo de quintas. Re dorico usa la armadura de Do (2 - 2 = 0).
 */
const MODE_OFFSET: Readonly<Record<Mode, number>> = {
  major: 0,
  ionian: 0,
  lydian: 1,
  mixolydian: -1,
  dorian: -2,
  minor: -3,
  aeolian: -3,
  phrygian: -4,
  locrian: -5,
};

/** Posicion de cada nota natural en el circulo de quintas. */
const STEP_FIFTHS: Readonly<Record<Step, number>> = {
  F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5,
};

/**
 * Armadura: tonica y modo.
 *
 * `fifths` (-7..+7) es la representacion que piden tanto MusicXML como el
 * meta-evento de armadura de MIDI, asi que se calcula aqui una sola vez en
 * lugar de reimplementarla en cada exportador.
 */
export class KeySignature {
  /** Tonica; solo cuentan grado y alteracion, la octava se ignora. */
  readonly tonic: Pitch;
  readonly mode: Mode;

  private constructor(tonic: Pitch, mode: Mode) {
    this.tonic = tonic;
    this.mode = mode;
    Object.freeze(this);
  }

  static of(tonic: Pitch | string, mode: Mode = 'major'): KeySignature {
    const pitch = typeof tonic === 'string' ? parseTonic(tonic) : tonic;
    if (!(mode in MODE_OFFSET)) {
      invalid('INVALID_KEY', `Modo desconocido: "${mode}"`, {
        mode,
        known: Object.keys(MODE_OFFSET),
      });
    }
    const key = new KeySignature(pitch.withOctave(4), mode);
    if (Math.abs(key.fifths) > 7) {
      invalid(
        'INVALID_KEY',
        `${key.name} necesitaria ${Math.abs(key.fifths)} alteraciones; usa la tonalidad enarmonica`,
        { tonic: pitch.name, mode, fifths: key.fifths },
      );
    }
    return key;
  }

  /** Interpreta `"C"`, `"Cmaj"`, `"F# minor"`, `"Bb major"`, `"D dorian"`. */
  static parse(text: string): KeySignature {
    const trimmed = text.trim();
    const match = /^([A-Ga-g][#sb]*)\s*(.*)$/.exec(trimmed);
    if (!match) {
      invalid('INVALID_KEY', `Tonalidad no reconocida: "${text}"`, { text });
    }
    const [, tonicText, modeText] = match as unknown as [string, string, string];

    const normalized = modeText.trim().toLowerCase();
    const mode = MODE_ALIASES[normalized];
    if (mode === undefined) {
      invalid('INVALID_KEY', `Modo no reconocido en "${text}"`, {
        text,
        known: Object.keys(MODE_ALIASES).filter(Boolean),
      });
    }
    return KeySignature.of(parseTonic(tonicText), mode);
  }

  static readonly C_MAJOR = KeySignature.of('C', 'major');
  static readonly A_MINOR = KeySignature.of('A', 'minor');

  /**
   * Numero de alteraciones en la armadura: positivo sostenidos, negativo
   * bemoles. Do mayor = 0, Sol mayor = 1, Fa mayor = -1, La menor = 0.
   */
  get fifths(): number {
    return STEP_FIFTHS[this.tonic.step] + 7 * this.tonic.alter + MODE_OFFSET[this.mode];
  }

  get sharps(): number {
    return Math.max(0, this.fifths);
  }

  get flats(): number {
    return Math.max(0, -this.fifths);
  }

  /** Escritura preferida en esta tonalidad, para elegir Fa# frente a Solb. */
  get accidentalPreference(): 'sharp' | 'flat' {
    return this.fifths < 0 ? 'flat' : 'sharp';
  }

  get isMinorLike(): boolean {
    return this.mode === 'minor' || this.mode === 'aeolian';
  }

  get name(): string {
    return `${this.tonic.pitchName} ${this.mode}`;
  }

  equals(other: KeySignature): boolean {
    return this.tonic.equals(other.tonic) && this.mode === other.mode;
  }

  toString(): string {
    return this.name;
  }

  toJSON(): { tonic: string; mode: Mode; fifths: number } {
    return { tonic: this.tonic.pitchName, mode: this.mode, fifths: this.fifths };
  }
}

/** La tonalidad no tiene octava; se acepta `"Bb"` sin numero. */
function parseTonic(text: string): Pitch {
  return Pitch.parse(/\d/.test(text) ? text : `${text}4`);
}

const MODE_ALIASES: Readonly<Record<string, Mode | undefined>> = {
  '': 'major',
  maj: 'major',
  major: 'major',
  m: 'minor',
  min: 'minor',
  minor: 'minor',
  ionian: 'ionian',
  dorian: 'dorian',
  phrygian: 'phrygian',
  lydian: 'lydian',
  mixolydian: 'mixolydian',
  aeolian: 'aeolian',
  locrian: 'locrian',
};
