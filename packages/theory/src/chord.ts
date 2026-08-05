import { DomainError, Interval, Pitch } from '@sinfo/core';

/**
 * Calidades de acorde de la practica comun.
 *
 * La lista no pretende ser exhaustiva: cubre lo que aparece en armonia tonal
 * y en musica popular. Anadir una calidad es anadir una entrada a
 * CHORD_INTERVALS; nada mas del modulo cambia.
 */
export type ChordQuality =
  | 'major'
  | 'minor'
  | 'diminished'
  | 'augmented'
  | 'sus2'
  | 'sus4'
  | 'major6'
  | 'minor6'
  | 'dominant7'
  | 'major7'
  | 'minor7'
  | 'halfDiminished7'
  | 'diminished7'
  | 'minorMajor7'
  | 'augmented7';

/**
 * Intervalos de cada calidad desde la fundamental.
 *
 * Se guardan como INTERVALOS, no como semitonos, y ahi esta todo el asunto: la
 * septima disminuida del acorde de septima disminuida son 9 semitonos, igual
 * que una sexta mayor, pero se escribe como septima. Con semitonos, un
 * Si dim7 daria Si-Re-Fa-Sol# en vez de Si-Re-Fa-Lab, y el analisis armonico
 * dejaria de reconocerlo.
 */
const CHORD_INTERVALS: Readonly<Record<ChordQuality, readonly string[]>> = {
  major: ['P1', 'M3', 'P5'],
  minor: ['P1', 'm3', 'P5'],
  diminished: ['P1', 'm3', 'd5'],
  augmented: ['P1', 'M3', 'A5'],
  sus2: ['P1', 'M2', 'P5'],
  sus4: ['P1', 'P4', 'P5'],
  major6: ['P1', 'M3', 'P5', 'M6'],
  minor6: ['P1', 'm3', 'P5', 'M6'],
  dominant7: ['P1', 'M3', 'P5', 'm7'],
  major7: ['P1', 'M3', 'P5', 'M7'],
  minor7: ['P1', 'm3', 'P5', 'm7'],
  halfDiminished7: ['P1', 'm3', 'd5', 'm7'],
  diminished7: ['P1', 'm3', 'd5', 'd7'],
  minorMajor7: ['P1', 'm3', 'P5', 'M7'],
  augmented7: ['P1', 'M3', 'A5', 'm7'],
};

/** Sufijo con el que se escribe cada calidad en un cifrado. */
const QUALITY_SYMBOLS: Readonly<Record<ChordQuality, string>> = {
  major: '',
  minor: 'm',
  diminished: 'dim',
  augmented: 'aug',
  sus2: 'sus2',
  sus4: 'sus4',
  major6: '6',
  minor6: 'm6',
  dominant7: '7',
  major7: 'maj7',
  minor7: 'm7',
  halfDiminished7: 'm7b5',
  diminished7: 'dim7',
  minorMajor7: 'mMaj7',
  augmented7: 'aug7',
};

export const CHORD_QUALITIES = Object.keys(CHORD_INTERVALS) as ChordQuality[];

/**
 * Un acorde: fundamental, calidad e inversion.
 *
 * La inversion no reordena las notas por capricho. En armonia, el BAJO es lo
 * que define la inversion y condiciona lo que puede venir despues: un V6 no
 * resuelve como un V. Guardarla explicitamente permite que el analisis lo
 * distinga en vez de ver solo un conjunto de alturas.
 */
export class Chord {
  readonly root: Pitch;
  readonly quality: ChordQuality;
  /** 0 fundamental, 1 primera inversion, 2 segunda, 3 tercera. */
  readonly inversion: number;

  private constructor(root: Pitch, quality: ChordQuality, inversion: number) {
    this.root = root;
    this.quality = quality;
    this.inversion = inversion;
    Object.freeze(this);
  }

  static of(root: Pitch | string, quality: ChordQuality = 'major', inversion = 0): Chord {
    const resolved = typeof root === 'string' ? parseRootName(root) : root;
    const size = CHORD_INTERVALS[quality]?.length;
    if (size === undefined) {
      throw new DomainError('INVALID_STRUCTURE', `Calidad de acorde desconocida: "${quality}"`, {
        quality,
        known: CHORD_QUALITIES,
      });
    }
    if (!Number.isInteger(inversion) || inversion < 0 || inversion >= size) {
      throw new DomainError(
        'INVALID_STRUCTURE',
        `Un acorde de ${size} notas admite inversiones 0 a ${size - 1}, no ${inversion}`,
        { quality, inversion, size },
      );
    }
    return new Chord(resolved, quality, inversion);
  }

  /**
   * Interpreta un cifrado: `C`, `Am`, `G7`, `F#m7b5`, `Bbmaj7`, `Ddim7`, `Dsus4`.
   *
   * Un cifrado NO lleva octava. Se intento admitirla y resulto imposible: en
   * `C6` el 6 es la sexta del acorde, no la octava sexta, y lo mismo pasa con
   * 7, 9, 11 y 13. La altura concreta se decide al distribuir el acorde, que
   * es donde corresponde, con `voicing(bassOctave)`.
   *
   * Tampoco se acepta `s` como sostenido, aunque `Pitch` si lo haga: en
   * `Dsus4` la ese pertenece a "sus", y la raiz se quedaba con `Ds` dejando un
   * sufijo `us4` sin sentido.
   */
  static parse(symbol: string): Chord {
    const match = /^([A-Ga-g](?:#{1,2}|b{1,2})?)(.*)$/.exec(symbol.trim());
    if (!match) {
      throw new DomainError('INVALID_STRUCTURE', `Cifrado no reconocido: "${symbol}"`, { symbol });
    }
    const [, rootName, suffix] = match as unknown as [string, string, string];

    const quality = qualityFromSuffix(suffix.trim());
    if (quality === undefined) {
      throw new DomainError(
        'INVALID_STRUCTURE',
        `Sufijo de acorde no reconocido: "${suffix}" en "${symbol}"`,
        { symbol, suffix, known: [...new Set(Object.values(QUALITY_SYMBOLS))] },
      );
    }
    return Chord.of(Pitch.parse(`${rootName}4`), quality);
  }

  // ------------------------------------------------------------ propiedades

  /** Intervalos desde la fundamental, en orden. */
  get intervals(): Interval[] {
    return CHORD_INTERVALS[this.quality].map((name) => Interval.parse(name));
  }

  /** Numero de notas distintas. */
  get size(): number {
    return CHORD_INTERVALS[this.quality].length;
  }

  get isSeventh(): boolean {
    return this.size === 4;
  }

  get isTriad(): boolean {
    return this.size === 3;
  }

  /**
   * Alturas en estado fundamental, de grave a agudo desde la fundamental.
   * La inversion no se aplica aqui: para eso esta `voicing`.
   */
  get pitches(): Pitch[] {
    return this.intervals.map((interval) => this.root.transpose(interval));
  }

  /** Nota que va al bajo segun la inversion. */
  get bass(): Pitch {
    return this.pitches[this.inversion]!;
  }

  /** Quinta del acorde, o null si la calidad no la tiene definida. */
  get fifth(): Pitch | null {
    return this.pitches[2] ?? null;
  }

  get third(): Pitch {
    return this.pitches[1]!;
  }

  get seventh(): Pitch | null {
    return this.isSeventh ? this.pitches[3]! : null;
  }

  /** Cifrado convencional: `C`, `Am7`, `F#dim`. Con `/` si esta invertido. */
  get symbol(): string {
    const base = `${this.root.pitchName}${QUALITY_SYMBOLS[this.quality]}`;
    return this.inversion === 0 ? base : `${base}/${this.bass.pitchName}`;
  }

  // ------------------------------------------------------------ operaciones

  /**
   * Distribuye el acorde en alturas concretas, respetando la inversion.
   *
   * Las notas que quedan por debajo del bajo suben una octava, que es lo que
   * significa invertir: la misma armonia con otra nota abajo.
   */
  voicing(bassOctave = 3): Pitch[] {
    const bass = this.bass.withOctave(bassOctave);
    const result: Pitch[] = [bass];

    for (let step = 1; step < this.size; step++) {
      const pitch = this.pitches[(this.inversion + step) % this.size]!;
      let candidate = pitch.withOctave(bassOctave);
      // Cada nota se coloca por encima de la anterior, subiendo octavas hasta
      // que lo este: asi el acorde suena cerrado y en el orden correcto.
      while (candidate.midi <= result[result.length - 1]!.midi) {
        candidate = candidate.withOctave(candidate.octave + 1);
      }
      result.push(candidate);
    }
    return result;
  }

  withInversion(inversion: number): Chord {
    return Chord.of(this.root, this.quality, inversion);
  }

  transpose(interval: Interval): Chord {
    return Chord.of(this.root.transpose(interval), this.quality, this.inversion);
  }

  /** true si la altura pertenece al acorde, ignorando la octava. */
  contains(pitch: Pitch): boolean {
    return this.pitches.some((member) => member.pitchClass === pitch.pitchClass);
  }

  equals(other: Chord): boolean {
    return (
      this.root.pitchClass === other.root.pitchClass &&
      this.quality === other.quality &&
      this.inversion === other.inversion
    );
  }

  toString(): string {
    return this.symbol;
  }

  toJSON(): { root: string; quality: ChordQuality; inversion: number; symbol: string } {
    return {
      root: this.root.pitchName,
      quality: this.quality,
      inversion: this.inversion,
      symbol: this.symbol,
    };
  }
}

// ------------------------------------------------------------ identificacion

export interface ChordMatch {
  readonly chord: Chord;
  /** Alturas dadas que no pertenecen al acorde. */
  readonly extraPitches: readonly Pitch[];
  /** Notas del acorde que faltan. */
  readonly missing: number;
  /** 1 cuando encaja exacto; baja con cada nota sobrante o ausente. */
  readonly confidence: number;
}

/**
 * Identifica que acorde forman unas alturas.
 *
 * Se prueban todas las fundamentales candidatas y todas las calidades, y se
 * puntua el encaje. Es fuerza bruta, pero el espacio es diminuto (12 notas por
 * 15 calidades) y a cambio no hay que mantener tablas de reconocimiento.
 *
 * La nota mas grave marca la inversion, que es como funciona en la practica:
 * lo que define un acorde de sexta es que la tercera esta en el bajo.
 */
export function identifyChord(pitches: readonly Pitch[]): ChordMatch | null {
  if (pitches.length < 2) return null;

  const sorted = [...pitches].sort((a, b) => a.compare(b));
  const classes = new Set(sorted.map((pitch) => pitch.pitchClass));
  const bass = sorted[0]!;

  let best: ChordMatch | null = null;

  for (const candidate of sorted) {
    for (const quality of CHORD_QUALITIES) {
      const chord = Chord.of(candidate, quality);
      const chordClasses = chord.pitches.map((pitch) => pitch.pitchClass);

      const missing = chordClasses.filter((pc) => !classes.has(pc)).length;
      const extras = [...classes].filter((pc) => !chordClasses.includes(pc));
      // Con notas ajenas no es ese acorde: seria adivinar.
      if (extras.length > 0) continue;
      // Falta mas de una nota: demasiado ambiguo para afirmarlo.
      if (missing > 1) continue;

      const inversion = chordClasses.indexOf(bass.pitchClass);
      if (inversion < 0) continue;

      const confidence = 1 - missing * 0.25 - (chord.size - classes.size) * 0.05;
      if (best === null || confidence > best.confidence) {
        best = {
          chord: Chord.of(candidate, quality, inversion),
          extraPitches: [],
          missing,
          confidence,
        };
      }
    }
  }

  return best;
}

// ----------------------------------------------------------------- internos

function parseRootName(name: string): Pitch {
  return Pitch.parse(/\d/.test(name) ? name : `${name}4`);
}

/** Sufijos aceptados, incluidos los alias habituales de cada calidad. */
const SUFFIX_ALIASES: Readonly<Record<string, ChordQuality>> = {
  '': 'major',
  M: 'major',
  maj: 'major',
  m: 'minor',
  min: 'minor',
  '-': 'minor',
  dim: 'diminished',
  'o': 'diminished',
  '°': 'diminished',
  aug: 'augmented',
  '+': 'augmented',
  sus2: 'sus2',
  sus4: 'sus4',
  sus: 'sus4',
  '6': 'major6',
  m6: 'minor6',
  min6: 'minor6',
  '7': 'dominant7',
  dom7: 'dominant7',
  maj7: 'major7',
  M7: 'major7',
  'Δ7': 'major7',
  m7: 'minor7',
  min7: 'minor7',
  '-7': 'minor7',
  m7b5: 'halfDiminished7',
  'ø7': 'halfDiminished7',
  'ø': 'halfDiminished7',
  halfdim: 'halfDiminished7',
  dim7: 'diminished7',
  'o7': 'diminished7',
  '°7': 'diminished7',
  mMaj7: 'minorMajor7',
  mM7: 'minorMajor7',
  aug7: 'augmented7',
  '7#5': 'augmented7',
};

function qualityFromSuffix(suffix: string): ChordQuality | undefined {
  return SUFFIX_ALIASES[suffix] ?? SUFFIX_ALIASES[suffix.toLowerCase()];
}
