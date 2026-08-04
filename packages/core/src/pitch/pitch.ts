import { invalid } from '../errors.js';
import { Interval } from './interval.js';

export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

const STEPS: readonly Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_INDEX: Readonly<Record<Step, number>> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
/** Semitonos desde Do para cada grado natural. */
const NATURAL_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;
/** Clases de altura que se pueden escribir sin ninguna alteracion. */
const NATURAL_PITCH_CLASSES = new Set<number>(NATURAL_SEMITONES);

/**
 * Altura con ORTOGRAFIA, no numero MIDI.
 *
 * Do sostenido y Re bemol suenan igual (MIDI 61) pero son notas distintas: se
 * escriben distinto, cumplen funciones armonicas distintas y se transponen
 * distinto. Si el dominio guardara solo el 61, la partitura saldria mal escrita
 * y el analisis armonico seria imposible. El numero MIDI es una PROYECCION de
 * la altura, no la altura.
 *
 * Convencion de octava: notacion cientifica. C4 es el do central = MIDI 60.
 */
export class Pitch {
  /** Letra de la nota, sin alteracion. */
  readonly step: Step;
  /** Alteracion en semitonos: -2 doble bemol, -1 bemol, 0 natural, 1 sostenido, 2 doble sostenido. */
  readonly alter: number;
  /** Octava en notacion cientifica; C4 = do central. */
  readonly octave: number;

  private constructor(step: Step, alter: number, octave: number) {
    this.step = step;
    this.alter = alter;
    this.octave = octave;
    Object.freeze(this);
  }

  static of(step: Step, alter = 0, octave = 4): Pitch {
    if (!STEPS.includes(step)) {
      invalid('INVALID_PITCH', `Grado invalido: "${step}"`, { step });
    }
    if (!Number.isInteger(alter) || Math.abs(alter) > 3) {
      invalid('INVALID_PITCH', 'La alteracion debe ser un entero entre -3 y 3', { alter });
    }
    if (!Number.isInteger(octave) || octave < -1 || octave > 10) {
      invalid('INVALID_PITCH', 'La octava debe ser un entero entre -1 y 10', { octave });
    }
    return new Pitch(step, alter, octave);
  }

  /**
   * Interpreta notacion cientifica: `C4`, `F#3`, `Bb5`, `Ebb2`, `G##4`.
   * Acepta `#` o `s` para sostenido, `b` para bemol.
   *
   * Deliberadamente NO se acepta `-` como bemol, aunque MusicXML lo use: en
   * `C-1` seria imposible saber si el guion es la alteracion o el signo de la
   * octava. La ambiguedad se resolvia silenciosamente como Do bemol 1, que
   * corrompe toda la octava -1 sin dar ningun error.
   */
  static parse(name: string): Pitch {
    const match = /^([A-Ga-g])([#sb]*)(-?\d+)$/.exec(name.trim());
    if (!match) {
      invalid('INVALID_PITCH', `Nombre de nota no reconocido: "${name}"`, { name });
    }
    const [, letter, accidentals, octaveText] = match as unknown as [string, string, string, string];

    let alter = 0;
    for (const ch of accidentals) {
      if (ch === '#' || ch === 's') alter += 1;
      else alter -= 1;
    }

    return Pitch.of(letter.toUpperCase() as Step, alter, Number.parseInt(octaveText, 10));
  }

  /**
   * Construye desde un numero MIDI eligiendo una escritura por defecto.
   *
   * Usar solo al IMPORTAR archivos MIDI, que no llevan ortografia. En
   * cualquier otro caso construye la altura con su escritura correcta: aqui
   * la informacion ya se perdio y hay que adivinar.
   */
  static fromMidi(midi: number, prefer: 'sharp' | 'flat' = 'sharp'): Pitch {
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
      invalid('INVALID_PITCH', 'El numero MIDI debe ser un entero entre 0 y 127', { midi });
    }
    const octave = Math.floor(midi / 12) - 1;
    const semitone = midi % 12;
    const spelling = prefer === 'sharp' ? SHARP_SPELLING : FLAT_SPELLING;
    const [step, alter] = spelling[semitone]!;
    return Pitch.of(step, alter, octave);
  }

  // ------------------------------------------------------------- propiedades

  /**
   * Posicion en la escala diatonica global: octava * 7 + grado.
   * Es la coordenada que hace posible transponer conservando la escritura.
   */
  get diatonicIndex(): number {
    return this.octave * 7 + STEP_INDEX[this.step];
  }

  /** Numero de nota MIDI. Proyeccion con perdida: descarta la ortografia. */
  get midi(): number {
    return (this.octave + 1) * 12 + NATURAL_SEMITONES[STEP_INDEX[this.step]]! + this.alter;
  }

  /** Clase de altura 0..11 (Do = 0). */
  get pitchClass(): number {
    return ((this.midi % 12) + 12) % 12;
  }

  /** Frecuencia en Hz con La4 = 440 (afinacion temperada). */
  frequency(a4 = 440): number {
    return a4 * 2 ** ((this.midi - 69) / 12);
  }

  /** Nombre cientifico: `C4`, `F#3`, `Bb5`. */
  get name(): string {
    return `${this.step}${this.accidentalSymbol}${this.octave}`;
  }

  /** Nombre sin octava: `C`, `F#`, `Bb`. */
  get pitchName(): string {
    return `${this.step}${this.accidentalSymbol}`;
  }

  get accidentalSymbol(): string {
    if (this.alter === 0) return '';
    return this.alter > 0 ? '#'.repeat(this.alter) : 'b'.repeat(-this.alter);
  }

  // ------------------------------------------------------------- operaciones

  /**
   * Transpone conservando la escritura correcta.
   *
   * El truco: el intervalo aporta cuantos GRADOS avanzar (fija la letra) y
   * cuantos SEMITONOS (fija la alteracion). La alteracion sale de la
   * diferencia entre ambos. Por eso Do + 3a mayor da Mi, y Do + 4a
   * disminuida da Fa bemol, aunque suenen a distancia distinta de la esperada.
   */
  transpose(interval: Interval): Pitch {
    const targetDiatonic = this.diatonicIndex + interval.diatonic;
    const targetMidi = this.midi + interval.chromatic;

    const octave = Math.floor(targetDiatonic / 7);
    const stepIndex = ((targetDiatonic % 7) + 7) % 7;
    const step = STEPS[stepIndex]!;

    const naturalMidi = (octave + 1) * 12 + NATURAL_SEMITONES[stepIndex]!;
    const alter = targetMidi - naturalMidi;

    return Pitch.of(step, alter, octave);
  }

  /** Intervalo desde esta altura hasta `other`. */
  intervalTo(other: Pitch): Interval {
    return Interval.of(other.diatonicIndex - this.diatonicIndex, other.midi - this.midi);
  }

  /**
   * Reescribe con el minimo de alteraciones manteniendo el mismo sonido.
   *
   * Si la escritura actual ya es minima se devuelve tal cual, para no
   * convertir Fa# en Solb sin motivo. Si no, se reescribe: Si# pasa a Do
   * (cero alteraciones en vez de una), Fabb pasa a Mib.
   */
  simplified(prefer: 'sharp' | 'flat' = 'sharp'): Pitch {
    if (this.isMinimallySpelled) return this;
    return Pitch.fromMidi(this.midi, prefer);
  }

  /** true si no existe otra escritura de este sonido con menos alteraciones. */
  get isMinimallySpelled(): boolean {
    if (this.alter === 0) return true;
    if (Math.abs(this.alter) > 1) return false;
    // Una alteracion simple solo es minima si el sonido no es una nota natural.
    return !NATURAL_PITCH_CLASSES.has(this.pitchClass);
  }

  withOctave(octave: number): Pitch {
    return Pitch.of(this.step, this.alter, octave);
  }

  // ------------------------------------------------------------- comparacion

  /** Igualdad estricta: incluye la escritura. Do# NO es igual a Reb. */
  equals(other: Pitch): boolean {
    return this.step === other.step && this.alter === other.alter && this.octave === other.octave;
  }

  /** Igualdad al oido: Do# SI es enarmonico de Reb. */
  isEnharmonicWith(other: Pitch): boolean {
    return this.midi === other.midi;
  }

  /** Ordena por altura sonora. */
  compare(other: Pitch): number {
    return this.midi - other.midi || this.diatonicIndex - other.diatonicIndex;
  }

  toString(): string {
    return this.name;
  }

  toJSON(): { step: Step; alter: number; octave: number; name: string; midi: number } {
    return {
      step: this.step,
      alter: this.alter,
      octave: this.octave,
      name: this.name,
      midi: this.midi,
    };
  }
}

const SHARP_SPELLING: readonly (readonly [Step, number])[] = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0],
  ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
];

const FLAT_SPELLING: readonly (readonly [Step, number])[] = [
  ['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0],
  ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
];
