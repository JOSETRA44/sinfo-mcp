/**
 * Catalogo orquestal como DATOS.
 *
 * Es un literal, no codigo: anadir un instrumento es anadir una entrada, y
 * nada del motor cambia. Se mantiene en TypeScript y no en JSON a proposito,
 * porque asi el compilador valida los nombres de familia y de clave, y una
 * altura mal escrita revienta el build en vez de fallar en tiempo de ejecucion
 * cuando alguien orqueste para ese instrumento.
 *
 * Rangos y tesituras en alturas SONANTES, tomados de la practica orquestal
 * habitual. Cuando hay discrepancia entre fuentes se toma el criterio
 * conservador: mejor que el aviso salte de mas que escribir algo intocable.
 */

/**
 * Familias instrumentales.
 *
 * Se declaran aqui, junto a los datos que las usan, y no en `instrument.ts`:
 * tenerlas alli creaba un ciclo (el catalogo importaba los tipos y el modulo
 * importaba los datos) que la comprobacion de arquitectura detecto. El
 * vocabulario pertenece al sitio donde vive el vocabulario.
 */
export type InstrumentFamily =
  | 'woodwind'
  | 'brass'
  | 'percussion'
  | 'keyboard'
  | 'strings'
  | 'voice'
  | 'plucked'
  | 'electronic';

export type Clef = 'treble' | 'bass' | 'alto' | 'tenor' | 'percussion';

export interface InstrumentSpec {
  readonly name: string;
  readonly family: InstrumentFamily;
  /** Programa General MIDI 0..127. */
  readonly midiProgram: number;
  /** Rango fisico completo: [mas grave, mas agudo], SONANTE. */
  readonly range: readonly [string, string];
  /** Rango comodo, SONANTE. */
  readonly tessitura: readonly [string, string];
  /** Intervalo del sonido respecto a lo escrito. Ausente = instrumento en Do. */
  readonly transposition?: string;
  readonly clef?: Clef;
  readonly isPercussion?: boolean;
  readonly velocityOffset?: number;
  /**
   * Cuantos ejecutantes tiene la seccion en una orquesta sinfonica.
   * Es lo que decide el balance: catorce violines primeros tapan a una flauta
   * por mucho que las dos toquen mezzoforte.
   */
  readonly sectionSize?: number;
  /**
   * Peso dinamico relativo, 1 = referencia. Un trombon proyecta mucho mas que
   * una viola aunque toquen la misma dinamica escrita.
   */
  readonly weight?: number;
}

export const INSTRUMENT_SPECS: Readonly<Record<string, InstrumentSpec>> = {
  // ------------------------------------------------------------- maderas
  piccolo: {
    name: 'Flautin', family: 'woodwind', midiProgram: 72,
    range: ['D5', 'C8'], tessitura: ['G5', 'A7'],
    transposition: 'P8', velocityOffset: -8, weight: 1.3,
  },
  flute: {
    name: 'Flauta', family: 'woodwind', midiProgram: 73,
    range: ['C4', 'D7'], tessitura: ['D4', 'G6'],
    velocityOffset: -4, sectionSize: 2, weight: 0.8,
  },
  alto_flute: {
    name: 'Flauta en Sol', family: 'woodwind', midiProgram: 73,
    range: ['G3', 'G6'], tessitura: ['A3', 'C6'],
    transposition: '-P4', velocityOffset: -6, weight: 0.6,
  },
  oboe: {
    name: 'Oboe', family: 'woodwind', midiProgram: 68,
    range: ['Bb3', 'A6'], tessitura: ['D4', 'D6'],
    sectionSize: 2, weight: 1.1,
  },
  english_horn: {
    name: 'Corno ingles', family: 'woodwind', midiProgram: 69,
    range: ['E3', 'A5'], tessitura: ['G3', 'D5'],
    transposition: '-P5', weight: 1,
  },
  clarinet: {
    name: 'Clarinete en Sib', family: 'woodwind', midiProgram: 71,
    range: ['D3', 'Bb6'], tessitura: ['E3', 'C6'],
    transposition: '-M2', sectionSize: 2, weight: 0.9,
  },
  clarinet_a: {
    name: 'Clarinete en La', family: 'woodwind', midiProgram: 71,
    range: ['C#3', 'A6'], tessitura: ['D3', 'B5'],
    transposition: '-m3', sectionSize: 2, weight: 0.9,
  },
  bass_clarinet: {
    name: 'Clarinete bajo', family: 'woodwind', midiProgram: 71,
    range: ['Bb1', 'F5'], tessitura: ['D2', 'C5'],
    transposition: '-M9', clef: 'treble', weight: 0.9,
  },
  bassoon: {
    name: 'Fagot', family: 'woodwind', midiProgram: 70,
    range: ['Bb1', 'Eb5'], tessitura: ['C2', 'C4'],
    clef: 'bass', sectionSize: 2, weight: 0.9,
  },
  contrabassoon: {
    name: 'Contrafagot', family: 'woodwind', midiProgram: 70,
    range: ['Bb0', 'Bb3'], tessitura: ['C1', 'F3'],
    transposition: '-P8', clef: 'bass', weight: 1,
  },
  soprano_sax: {
    name: 'Saxofon soprano', family: 'woodwind', midiProgram: 64,
    range: ['Ab3', 'E6'], tessitura: ['Bb3', 'C6'], transposition: '-M2', weight: 1.1,
  },
  alto_sax: {
    name: 'Saxofon alto', family: 'woodwind', midiProgram: 65,
    range: ['Db3', 'A5'], tessitura: ['Eb3', 'F5'], transposition: '-M6', weight: 1.2,
  },
  tenor_sax: {
    name: 'Saxofon tenor', family: 'woodwind', midiProgram: 66,
    range: ['Ab2', 'E5'], tessitura: ['Bb2', 'C5'], transposition: '-M9', weight: 1.2,
  },
  baritone_sax: {
    name: 'Saxofon baritono', family: 'woodwind', midiProgram: 67,
    range: ['C2', 'A4'], tessitura: ['Eb2', 'F4'],
    transposition: '-P12', clef: 'bass', weight: 1.2,
  },

  // -------------------------------------------------------------- metales
  horn: {
    name: 'Trompa en Fa', family: 'brass', midiProgram: 60,
    range: ['B1', 'F5'], tessitura: ['C3', 'C5'],
    transposition: '-P5', sectionSize: 4, weight: 1.4,
  },
  trumpet: {
    name: 'Trompeta en Sib', family: 'brass', midiProgram: 56,
    range: ['E3', 'D6'], tessitura: ['G3', 'Bb5'],
    transposition: '-M2', velocityOffset: 6, sectionSize: 3, weight: 1.8,
  },
  trumpet_c: {
    name: 'Trompeta en Do', family: 'brass', midiProgram: 56,
    range: ['F#3', 'E6'], tessitura: ['A3', 'C6'],
    velocityOffset: 6, sectionSize: 3, weight: 1.8,
  },
  trombone: {
    name: 'Trombon', family: 'brass', midiProgram: 57,
    range: ['E2', 'F5'], tessitura: ['G2', 'Bb4'],
    clef: 'bass', velocityOffset: 5, sectionSize: 3, weight: 1.8,
  },
  bass_trombone: {
    name: 'Trombon bajo', family: 'brass', midiProgram: 57,
    range: ['Bb1', 'Bb4'], tessitura: ['C2', 'F4'],
    clef: 'bass', velocityOffset: 5, weight: 1.9,
  },
  tuba: {
    name: 'Tuba', family: 'brass', midiProgram: 58,
    range: ['D1', 'F4'], tessitura: ['F1', 'F3'],
    clef: 'bass', velocityOffset: 4, weight: 1.7,
  },
  euphonium: {
    name: 'Bombardino', family: 'brass', midiProgram: 58,
    range: ['E2', 'Bb4'], tessitura: ['G2', 'F4'], clef: 'bass', weight: 1.4,
  },

  // ------------------------------------------------------------ percusion
  timpani: {
    name: 'Timbales', family: 'percussion', midiProgram: 47,
    range: ['D2', 'C4'], tessitura: ['F2', 'F3'], clef: 'bass', weight: 1.5,
  },
  glockenspiel: {
    name: 'Glockenspiel', family: 'percussion', midiProgram: 9,
    range: ['G5', 'C8'], tessitura: ['C6', 'C8'], transposition: 'P15', weight: 1.1,
  },
  xylophone: {
    name: 'Xilofono', family: 'percussion', midiProgram: 13,
    range: ['F4', 'C8'], tessitura: ['C5', 'C7'], transposition: 'P8', weight: 1.2,
  },
  vibraphone: {
    name: 'Vibrafono', family: 'percussion', midiProgram: 11,
    range: ['F3', 'F6'], tessitura: ['C4', 'C6'], weight: 0.8,
  },
  marimba: {
    name: 'Marimba', family: 'percussion', midiProgram: 12,
    range: ['C2', 'C7'], tessitura: ['C3', 'C6'], weight: 0.8,
  },
  tubular_bells: {
    name: 'Campanas tubulares', family: 'percussion', midiProgram: 14,
    range: ['C4', 'F5'], tessitura: ['C4', 'F5'], weight: 1.5,
  },
  drums: {
    name: 'Bateria', family: 'percussion', midiProgram: 0,
    range: ['C1', 'B5'], tessitura: ['C1', 'B5'],
    clef: 'percussion', isPercussion: true, weight: 1.5,
  },
  percussion: {
    name: 'Percusion', family: 'percussion', midiProgram: 0,
    range: ['C1', 'B5'], tessitura: ['C1', 'B5'],
    clef: 'percussion', isPercussion: true, weight: 1.3,
  },

  // ------------------------------------------------- teclado y pulsados
  piano: {
    name: 'Piano', family: 'keyboard', midiProgram: 0,
    range: ['A-1', 'C7'], tessitura: ['C1', 'C6'], weight: 1,
  },
  harpsichord: {
    name: 'Clave', family: 'keyboard', midiProgram: 6,
    range: ['F1', 'F6'], tessitura: ['C2', 'C6'], weight: 0.7,
  },
  celesta: {
    name: 'Celesta', family: 'keyboard', midiProgram: 8,
    range: ['C3', 'C7'], tessitura: ['C4', 'C7'], transposition: 'P8', weight: 0.6,
  },
  organ: {
    name: 'Organo', family: 'keyboard', midiProgram: 19,
    range: ['C1', 'C7'], tessitura: ['C2', 'C6'], weight: 1.6,
  },
  harp: {
    name: 'Arpa', family: 'plucked', midiProgram: 46,
    range: ['Cb1', 'G#7'], tessitura: ['C2', 'C7'], weight: 0.6,
  },
  guitar: {
    name: 'Guitarra', family: 'plucked', midiProgram: 24,
    range: ['E2', 'B5'], tessitura: ['E2', 'E5'], transposition: '-P8', weight: 0.5,
  },
  bass_guitar: {
    name: 'Bajo electrico', family: 'plucked', midiProgram: 33,
    range: ['E1', 'G4'], tessitura: ['E1', 'C4'],
    transposition: '-P8', clef: 'bass', weight: 1.1,
  },

  // -------------------------------------------------------------- cuerdas
  violin: {
    name: 'Violin', family: 'strings', midiProgram: 40,
    range: ['G3', 'A7'], tessitura: ['G3', 'E6'], sectionSize: 14, weight: 1,
  },
  viola: {
    name: 'Viola', family: 'strings', midiProgram: 41,
    range: ['C3', 'E6'], tessitura: ['C3', 'A5'], clef: 'alto', sectionSize: 10, weight: 0.9,
  },
  cello: {
    name: 'Violonchelo', family: 'strings', midiProgram: 42,
    range: ['C2', 'C6'], tessitura: ['C2', 'A4'], clef: 'bass', sectionSize: 8, weight: 1.1,
  },
  contrabass: {
    name: 'Contrabajo', family: 'strings', midiProgram: 43,
    range: ['C1', 'C4'], tessitura: ['E1', 'G3'],
    transposition: '-P8', clef: 'bass', velocityOffset: 4, sectionSize: 6, weight: 1.1,
  },

  // ----------------------------------------------------------------- voz
  soprano: {
    name: 'Soprano', family: 'voice', midiProgram: 52,
    range: ['C4', 'C6'], tessitura: ['E4', 'G5'], weight: 1 },
  alto_voice: {
    name: 'Contralto', family: 'voice', midiProgram: 52,
    range: ['F3', 'F5'], tessitura: ['A3', 'D5'], weight: 1 },
  tenor_voice: {
    name: 'Tenor', family: 'voice', midiProgram: 53,
    range: ['C3', 'C5'], tessitura: ['E3', 'G4'], clef: 'treble', weight: 1 },
  bass_voice: {
    name: 'Bajo', family: 'voice', midiProgram: 53,
    range: ['E2', 'E4'], tessitura: ['G2', 'C4'], clef: 'bass', weight: 1 },

  // -------------------------------------------------------------- sintesis
  synth_bass: {
    name: 'Bajo sintetizado', family: 'electronic', midiProgram: 38,
    range: ['C1', 'C4'], tessitura: ['E1', 'G3'], clef: 'bass', weight: 1.2,
  },
  synth_lead: {
    name: 'Lead sintetizado', family: 'electronic', midiProgram: 80,
    range: ['C2', 'C7'], tessitura: ['C3', 'C6'], weight: 1.3,
  },
  synth_pad: {
    name: 'Pad sintetizado', family: 'electronic', midiProgram: 89,
    range: ['C1', 'C7'], tessitura: ['C2', 'C6'], weight: 0.7,
  },
};

/**
 * Plantillas de conjunto.
 *
 * Montar una orquesta sinfonica llamando veinte veces a `part_add` es trabajo
 * repetido y propenso a olvidos. Los ids repetidos se numeran solos
 * (`violin`, `violin2`), que es justo lo que hace falta para violines primeros
 * y segundos, o para dos flautas.
 */
export interface EnsemblePreset {
  readonly name: string;
  readonly description: string;
  /** Instrumentos en ORDEN DE PARTITURA: maderas, metales, percusion, cuerdas. */
  readonly instruments: readonly string[];
}

export const ENSEMBLE_PRESETS: Readonly<Record<string, EnsemblePreset>> = {
  solo_piano: {
    name: 'Piano solo',
    description: 'Un piano.',
    instruments: ['piano'],
  },
  string_quartet: {
    name: 'Cuarteto de cuerda',
    description: 'Dos violines, viola y violonchelo.',
    instruments: ['violin', 'violin', 'viola', 'cello'],
  },
  string_orchestra: {
    name: 'Orquesta de cuerda',
    description: 'Cuerda completa con contrabajos.',
    instruments: ['violin', 'violin', 'viola', 'cello', 'contrabass'],
  },
  wind_quintet: {
    name: 'Quinteto de viento',
    description: 'Flauta, oboe, clarinete, trompa y fagot.',
    instruments: ['flute', 'oboe', 'clarinet', 'horn', 'bassoon'],
  },
  brass_quintet: {
    name: 'Quinteto de metales',
    description: 'Dos trompetas, trompa, trombon y tuba.',
    instruments: ['trumpet', 'trumpet', 'horn', 'trombone', 'tuba'],
  },
  piano_trio: {
    name: 'Trio con piano',
    description: 'Violin, violonchelo y piano.',
    instruments: ['violin', 'cello', 'piano'],
  },
  chamber_orchestra: {
    name: 'Orquesta de camara',
    description: 'Maderas a dos, dos trompas y cuerda.',
    instruments: [
      'flute', 'flute', 'oboe', 'oboe', 'clarinet', 'clarinet', 'bassoon', 'bassoon',
      'horn', 'horn',
      'violin', 'violin', 'viola', 'cello', 'contrabass',
    ],
  },
  symphony_orchestra: {
    name: 'Orquesta sinfonica',
    description: 'Plantilla romantica: maderas a dos, metales completos, timbales y cuerda.',
    instruments: [
      'piccolo', 'flute', 'flute', 'oboe', 'oboe', 'english_horn',
      'clarinet', 'clarinet', 'bass_clarinet', 'bassoon', 'bassoon', 'contrabassoon',
      'horn', 'horn', 'horn', 'horn', 'trumpet', 'trumpet',
      'trombone', 'trombone', 'bass_trombone', 'tuba',
      'timpani', 'percussion', 'harp',
      'violin', 'violin', 'viola', 'cello', 'contrabass',
    ],
  },
  big_band: {
    name: 'Big band',
    description: 'Saxos, metales y seccion ritmica.',
    instruments: [
      'alto_sax', 'alto_sax', 'tenor_sax', 'tenor_sax', 'baritone_sax',
      'trumpet', 'trumpet', 'trumpet', 'trombone', 'trombone',
      'piano', 'bass_guitar', 'drums',
    ],
  },
  rock_band: {
    name: 'Banda de rock',
    description: 'Guitarra, bajo, teclado y bateria.',
    instruments: ['guitar', 'bass_guitar', 'piano', 'drums'],
  },
  satb_choir: {
    name: 'Coro mixto',
    description: 'Soprano, contralto, tenor y bajo.',
    instruments: ['soprano', 'alto_voice', 'tenor_voice', 'bass_voice'],
  },
};
