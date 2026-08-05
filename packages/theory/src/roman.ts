import { DomainError, Interval, KeySignature, Pitch } from '@sinfo/core';
import { Chord, identifyChord, type ChordQuality } from './chord.js';
import { Scale } from './scale.js';

/**
 * Numero romano: la funcion de un acorde DENTRO de una tonalidad.
 *
 * Es lo que separa "un acorde de Sol mayor" de "la dominante de Do mayor". El
 * primero es un dato acustico; el segundo dice a donde quiere ir la musica.
 * Todo el analisis funcional y las cadencias dependen de esta distincion.
 */
export class RomanNumeral {
  /** Grado de la escala, 1 a 7. */
  readonly degree: number;
  /** Alteracion del grado: -1 en bVII, +1 en #iv. */
  readonly accidental: number;
  readonly quality: ChordQuality;
  readonly inversion: number;
  /**
   * Grado al que se aplica, en las dominantes secundarias. En `V/V` vale 5.
   * null cuando el acorde es diatonico de la tonalidad principal.
   */
  readonly appliedTo: number | null;

  private constructor(
    degree: number,
    accidental: number,
    quality: ChordQuality,
    inversion: number,
    appliedTo: number | null,
  ) {
    this.degree = degree;
    this.accidental = accidental;
    this.quality = quality;
    this.inversion = inversion;
    this.appliedTo = appliedTo;
    Object.freeze(this);
  }

  static of(
    degree: number,
    quality: ChordQuality,
    options: { accidental?: number; inversion?: number; appliedTo?: number | null } = {},
  ): RomanNumeral {
    if (!Number.isInteger(degree) || degree < 1 || degree > 7) {
      throw new DomainError('INVALID_KEY', 'El grado debe estar entre 1 y 7', { degree });
    }
    return new RomanNumeral(
      degree,
      options.accidental ?? 0,
      quality,
      options.inversion ?? 0,
      options.appliedTo ?? null,
    );
  }

  /**
   * Interpreta la notacion habitual: `I`, `ii`, `V7`, `vii°7`, `bVII`, `V/V`,
   * `V65`, `i6`, `IV64`.
   *
   * Las mayusculas indican acorde mayor y las minusculas menor, que es la
   * convencion de toda la teoria tonal desde el XIX. El cifrado de bajo
   * (`6`, `64`, `65`, `43`, `42`) da la inversion.
   */
  static parse(text: string, key: KeySignature): RomanNumeral {
    const trimmed = text.trim();

    // Dominante secundaria: la parte de la derecha dice a que grado se aplica.
    const slash = trimmed.indexOf('/');
    if (slash > 0) {
      const target = RomanNumeral.parse(trimmed.slice(slash + 1), key);
      const applied = RomanNumeral.parse(trimmed.slice(0, slash), key);
      return new RomanNumeral(
        applied.degree,
        applied.accidental,
        applied.quality,
        applied.inversion,
        target.degree,
      );
    }

    const match = /^(b+|#+)?([iIvV]+)(°|o|\+|ø)?(\d*)$/.exec(trimmed);
    if (!match) {
      throw new DomainError('INVALID_KEY', `Numero romano no reconocido: "${text}"`, {
        text,
        examples: ['I', 'ii', 'V7', 'vii°7', 'bVII', 'V/V', 'V65', 'i6'],
      });
    }
    const [, accidentalText, numeral, symbol, figures] = match as unknown as [
      string,
      string | undefined,
      string,
      string | undefined,
      string,
    ];

    const degree = ROMAN_TO_DEGREE[numeral.toUpperCase()];
    if (degree === undefined) {
      throw new DomainError('INVALID_KEY', `Grado romano invalido: "${numeral}"`, { text });
    }

    const accidental = accidentalText
      ? accidentalText.startsWith('b')
        ? -accidentalText.length
        : accidentalText.length
      : 0;

    const isUpperCase = numeral === numeral.toUpperCase();
    const quality = resolveQuality(isUpperCase, symbol, figures);
    const inversion = inversionFromFigures(figures, quality);

    return new RomanNumeral(degree, accidental, quality, inversion, null);
  }

  // ------------------------------------------------------------ realizacion

  /**
   * Convierte el numero romano en un acorde concreto de la tonalidad.
   *
   * En modo menor se usa la escala armonica y no la natural: es la que produce
   * la sensible, y sin ella el V seria menor y no habria cadencia autentica.
   * Esa eleccion es la diferencia entre sonar tonal y sonar modal.
   */
  realize(key: KeySignature): Chord {
    const scale = scaleFor(key);
    const targetKey = this.appliedTo === null ? key : keyOfDegree(key, this.appliedTo);
    const targetScale = this.appliedTo === null ? scale : scaleFor(targetKey);

    let root = rootForDegree(targetScale, targetKey, this.degree, this.quality);
    if (this.accidental !== 0) {
      root = Pitch.of(root.step, root.alter + this.accidental, root.octave);
    }

    return Chord.of(root, this.quality, this.inversion);
  }

  /** Grados de la escala que toca este acorde, base 1. */
  scaleDegrees(): number[] {
    const size = Chord.of(Pitch.parse('C4'), this.quality).size;
    return Array.from({ length: size }, (_, index) => ((this.degree - 1 + index * 2) % 7) + 1);
  }

  // ------------------------------------------------------------ presentacion

  get numeral(): string {
    const base = DEGREE_TO_ROMAN[this.degree - 1]!;
    return isMinorLikeQuality(this.quality) ? base.toLowerCase() : base;
  }

  get symbol(): string {
    const accidental =
      this.accidental === 0
        ? ''
        : this.accidental < 0
          ? 'b'.repeat(-this.accidental)
          : '#'.repeat(this.accidental);

    const mark =
      this.quality === 'diminished' || this.quality === 'diminished7'
        ? '°'
        : this.quality === 'halfDiminished7'
          ? 'ø'
          : this.quality === 'augmented'
            ? '+'
            : '';

    const figures = figuresFor(this.quality, this.inversion);
    const applied = this.appliedTo === null ? '' : `/${DEGREE_TO_ROMAN[this.appliedTo - 1]!}`;
    return `${accidental}${this.numeral}${mark}${figures}${applied}`;
  }

  /** Funcion tonal: a donde empuja el acorde. */
  get fn(): HarmonicFunction {
    if (this.appliedTo !== null) return 'dominante-secundaria';
    return FUNCTION_BY_DEGREE[this.degree - 1]!;
  }

  toString(): string {
    return this.symbol;
  }

  toJSON(): { symbol: string; degree: number; quality: ChordQuality; inversion: number; fn: string } {
    return {
      symbol: this.symbol,
      degree: this.degree,
      quality: this.quality,
      inversion: this.inversion,
      fn: this.fn,
    };
  }
}

export type HarmonicFunction =
  | 'tonica'
  | 'subdominante'
  | 'dominante'
  | 'dominante-secundaria';

/**
 * Funcion de cada grado.
 *
 * III y VI se agrupan con la tonica porque comparten dos de sus tres notas y
 * pueden sustituirla; II y IV preparan la dominante; VII es dominante sin
 * fundamental.
 */
const FUNCTION_BY_DEGREE: readonly HarmonicFunction[] = [
  'tonica',
  'subdominante',
  'tonica',
  'subdominante',
  'dominante',
  'tonica',
  'dominante',
];

// ------------------------------------------------------------------ analisis

export interface HarmonicAnalysis {
  readonly roman: RomanNumeral;
  readonly chord: Chord;
  readonly fn: HarmonicFunction;
  /** true si el acorde usa solo notas de la tonalidad. */
  readonly isDiatonic: boolean;
  readonly confidence: number;
}

/**
 * Averigua que funcion cumple un acorde en una tonalidad.
 *
 * Se identifica primero el acorde por sus alturas y luego se busca su grado.
 * Si la fundamental no es un grado de la escala, se expresa con alteracion
 * (`bVII`) en vez de darse por vencido: los acordes prestados son parte normal
 * del lenguaje tonal, no errores.
 */
export function analyzeChord(pitches: readonly Pitch[], key: KeySignature): HarmonicAnalysis | null {
  const match = identifyChord(pitches);
  if (!match) return null;

  const chord = match.chord;
  // El grado se busca en las DOS escalas del modo menor. Con solo la armonica,
  // Sol mayor en la menor (el VII, la subtonica) no encontraba grado y acababa
  // descrito como "bbI": un absurdo con la fundamental bajada dos veces.
  const degree =
    scaleFor(key).degreeOf(chord.root) ??
    Scale.of(key.tonic, key.isMinorLike ? 'minor' : 'major').degreeOf(chord.root);

  if (degree !== null) {
    const roman = RomanNumeral.of(degree, chord.quality, { inversion: chord.inversion });
    return {
      roman,
      chord,
      fn: roman.fn,
      isDiatonic: isDiatonicIn(chord.pitches, key),
      confidence: match.confidence,
    };
  }

  // Fundamental fuera de la escala: se busca el grado mas cercano y se
  // expresa la diferencia como alteracion.
  const natural = Scale.of(key.tonic, key.isMinorLike ? 'minor' : 'major');
  for (const accidental of [-1, 1, -2, 2]) {
    for (let candidate = 1; candidate <= 7; candidate++) {
      const shifted = natural.degree(candidate);
      const altered = Pitch.of(shifted.step, shifted.alter + accidental, shifted.octave);
      if (altered.pitchClass !== chord.root.pitchClass) continue;

      const roman = RomanNumeral.of(candidate, chord.quality, {
        accidental,
        inversion: chord.inversion,
      });
      return {
        roman,
        chord,
        fn: roman.fn,
        isDiatonic: false,
        confidence: match.confidence * 0.9,
      };
    }
  }

  return null;
}

// ------------------------------------------------------------------ cadencias

export type CadenceType =
  | 'autentica-perfecta'
  | 'autentica-imperfecta'
  | 'plagal'
  | 'semicadencia'
  | 'rota'
  | 'ninguna';

export interface CadenceResult {
  readonly type: CadenceType;
  readonly description: string;
}

/**
 * Clasifica el final de dos acordes.
 *
 * La distincion entre autentica perfecta e imperfecta no es academica: la
 * perfecta (V-I con la tonica en el bajo y en la voz superior) es la unica que
 * cierra de verdad. Las demas dejan la frase abierta, y confundirlas hace que
 * una obra termine sin sonar terminada.
 */
export function classifyCadence(
  penultimate: RomanNumeral,
  last: RomanNumeral,
  options: { sopranoIsTonic?: boolean } = {},
): CadenceResult {
  const isDominant = penultimate.degree === 5 || penultimate.degree === 7;
  const bothRootPosition = penultimate.inversion === 0 && last.inversion === 0;

  if (isDominant && last.degree === 1) {
    if (bothRootPosition && (options.sopranoIsTonic ?? true)) {
      return {
        type: 'autentica-perfecta',
        description: 'V-I en estado fundamental con la tonica en la voz superior: cierre completo',
      };
    }
    return {
      type: 'autentica-imperfecta',
      description: 'V-I invertido o sin la tonica arriba: concluye pero deja la frase abierta',
    };
  }

  if (isDominant && (last.degree === 6 || last.degree === 4)) {
    return {
      type: 'rota',
      description: `La dominante resuelve al grado ${last.degree} en vez de a la tonica: la frase sigue`,
    };
  }

  if (penultimate.degree === 4 && last.degree === 1) {
    return { type: 'plagal', description: 'IV-I: cierre suave, sin sensible' };
  }

  if (last.degree === 5) {
    return { type: 'semicadencia', description: 'Termina en la dominante: la frase queda suspendida' };
  }

  return { type: 'ninguna', description: 'La sucesion no forma una cadena cadencial reconocible' };
}

// ----------------------------------------------------------------- internos

const ROMAN_TO_DEGREE: Readonly<Record<string, number>> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7,
};

const DEGREE_TO_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;

function isMinorLikeQuality(quality: ChordQuality): boolean {
  return (
    quality === 'minor' ||
    quality === 'diminished' ||
    quality === 'minor7' ||
    quality === 'diminished7' ||
    quality === 'halfDiminished7' ||
    quality === 'minorMajor7' ||
    quality === 'minor6'
  );
}

/**
 * En modo menor se CONSTRUYEN los acordes con la escala armonica.
 *
 * Con la natural, el grado V daria un acorde menor y el vii no seria
 * disminuido: desaparecerian la sensible y la cadencia autentica, que son la
 * base de toda la armonia tonal en menor.
 */
function scaleFor(key: KeySignature): Scale {
  return key.isMinorLike ? Scale.of(key.tonic, 'harmonicMinor') : Scale.fromKey(key);
}

/** Calidades que implican el septimo grado ELEVADO, es decir, la sensible. */
const LEADING_TONE_QUALITIES = new Set<ChordQuality>([
  'diminished',
  'diminished7',
  'halfDiminished7',
  'augmented',
]);

/**
 * Fundamental del grado pedido, resolviendo la ambiguedad del septimo grado
 * en modo menor.
 *
 * Es el UNICO grado cuya fundamental cambia entre la menor natural y la
 * armonica: Sol frente a Sol sostenido en la menor. Y los dos se usan, con
 * significados distintos: `VII` es la subtonica (Sol mayor, sonido modal) y
 * `vii°` es el acorde de sensible (Sol sostenido disminuido, que resuelve a la
 * tonica). Elegir siempre la armonica convertia el VII en un Sol sostenido
 * mayor que no existe en el repertorio.
 *
 * Los demas grados tienen la misma fundamental en ambas escalas: en el V, la
 * sensible es la TERCERA del acorde y la aporta la calidad, no la escala.
 */
function rootForDegree(
  scale: Scale,
  key: KeySignature,
  degree: number,
  quality: ChordQuality,
): Pitch {
  if (!key.isMinorLike || degree !== 7) return scale.degree(degree);
  return LEADING_TONE_QUALITIES.has(quality)
    ? Scale.of(key.tonic, 'harmonicMinor').degree(7)
    : Scale.of(key.tonic, 'minor').degree(7);
}

/**
 * Decide si un acorde es diatonico de la tonalidad.
 *
 * En modo menor NO basta con una escala. El modo menor de la practica comun no
 * tiene siete notas sino ocho: las de la menor natural mas la sensible. Usar
 * solo la armonica marcaba el III (el relativo mayor, Do en la menor) como
 * acorde prestado, porque su Sol natural no esta en la armonica. Y usar solo la
 * natural marcaria el V, que es el acorde mas caracteristico del modo.
 *
 * La sexta elevada queda FUERA a proposito: cuando aparece si significa color
 * de menor melodica, y merece senalarse.
 */
function isDiatonicIn(pitches: readonly Pitch[], key: KeySignature): boolean {
  const allowed = diatonicPitchClasses(key);
  return pitches.every((pitch) => allowed.has(pitch.pitchClass));
}

function diatonicPitchClasses(key: KeySignature): Set<number> {
  const collection = new Set<number>();

  if (!key.isMinorLike) {
    for (const pitch of Scale.fromKey(key).pitches) collection.add(pitch.pitchClass);
    return collection;
  }

  for (const pitch of Scale.of(key.tonic, 'minor').pitches) collection.add(pitch.pitchClass);
  // La sensible: septima elevada de la menor armonica.
  collection.add(Scale.of(key.tonic, 'harmonicMinor').degree(7).pitchClass);
  return collection;
}

/** Tonalidad en la que un grado se convierte en tonica, para las secundarias. */
function keyOfDegree(key: KeySignature, degree: number): KeySignature {
  const root = scaleFor(key).degree(degree);
  // Una dominante secundaria trata a su objetivo como tonica mayor: V/ii es
  // la dominante de re menor, pero el acorde V se construye igual.
  return KeySignature.of(root, 'major');
}

function resolveQuality(
  isUpperCase: boolean,
  symbol: string | undefined,
  figures: string,
): ChordQuality {
  const hasSeventh = SEVENTH_FIGURES.has(figures);

  if (symbol === '°' || symbol === 'o') return hasSeventh ? 'diminished7' : 'diminished';
  if (symbol === 'ø') return 'halfDiminished7';
  if (symbol === '+') return 'augmented';

  if (isUpperCase) return hasSeventh ? 'dominant7' : 'major';
  return hasSeventh ? 'minor7' : 'minor';
}

/** Cifrados de bajo que indican acorde de septima. */
const SEVENTH_FIGURES = new Set(['7', '65', '43', '42', '2']);

/**
 * Inversion segun el cifrado de bajo.
 *
 * En las triadas, 6 es primera inversion y 64 segunda. En las septimas, 7 es
 * estado fundamental, 65 primera, 43 segunda y 42 tercera. Los numeros salen
 * de los intervalos que hay sobre el bajo, no de una convencion arbitraria.
 */
function inversionFromFigures(figures: string, quality: ChordQuality): number {
  const isSeventh = SEVENTH_FIGURES.has(figures) || quality.includes('7');

  if (isSeventh) {
    if (figures === '65') return 1;
    if (figures === '43') return 2;
    if (figures === '42' || figures === '2') return 3;
    return 0;
  }

  if (figures === '6') return 1;
  if (figures === '64') return 2;
  return 0;
}

function figuresFor(quality: ChordQuality, inversion: number): string {
  const isSeventh = quality.includes('7');
  if (isSeventh) return ['7', '65', '43', '42'][inversion] ?? '7';
  return ['', '6', '64'][inversion] ?? '';
}

export { Interval };
