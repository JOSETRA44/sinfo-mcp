import { Interval } from '../pitch/interval.js';
import { Pitch } from '../pitch/pitch.js';

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

/**
 * Instrumento: lo que hace posible orquestar sin escribir notas imposibles.
 *
 * Dos rangos, no uno. `range` es lo fisicamente tocable; `tessitura` es donde
 * el instrumento suena bien y el interprete no sufre. Escribir un pasaje largo
 * en el extremo del rango es tecnicamente valido y musicalmente un error, y
 * distinguirlos permite que `check_ranges` avise sin bloquear.
 *
 * `transposition` es el intervalo de SONIDO respecto a lo escrito: el clarinete
 * en Si bemol suena una segunda mayor por debajo de lo que lee.
 */
export interface Instrument {
  readonly id: string;
  readonly name: string;
  readonly family: InstrumentFamily;
  /** Programa General MIDI 0..127. */
  readonly midiProgram: number;
  /** Rango fisico completo, en alturas SONANTES. */
  readonly range: { readonly lowest: Pitch; readonly highest: Pitch };
  /** Rango comodo, en alturas SONANTES. */
  readonly tessitura: { readonly lowest: Pitch; readonly highest: Pitch };
  /** Del sonido respecto a lo escrito. Unisono en los instrumentos en Do. */
  readonly transposition: Interval;
  readonly clef: Clef;
  /** Los instrumentos de percusion van al canal MIDI 10 y no usan programa. */
  readonly isPercussion: boolean;
  /** Ajuste de velocity para compensar el volumen natural del instrumento. */
  readonly velocityOffset: number;
}

interface InstrumentSpec {
  readonly name: string;
  readonly family: InstrumentFamily;
  readonly midiProgram: number;
  readonly range: readonly [string, string];
  readonly tessitura: readonly [string, string];
  readonly transposition?: string;
  readonly clef?: Clef;
  readonly isPercussion?: boolean;
  readonly velocityOffset?: number;
}

function define(id: string, spec: InstrumentSpec): Instrument {
  return Object.freeze({
    id,
    name: spec.name,
    family: spec.family,
    midiProgram: spec.midiProgram,
    range: Object.freeze({
      lowest: Pitch.parse(spec.range[0]),
      highest: Pitch.parse(spec.range[1]),
    }),
    tessitura: Object.freeze({
      lowest: Pitch.parse(spec.tessitura[0]),
      highest: Pitch.parse(spec.tessitura[1]),
    }),
    transposition: spec.transposition ? Interval.parse(spec.transposition) : Interval.UNISON,
    clef: spec.clef ?? 'treble',
    isPercussion: spec.isPercussion ?? false,
    velocityOffset: spec.velocityOffset ?? 0,
  });
}

/**
 * Catalogo inicial. En la fase de orquestacion esto pasa a un JSON de datos
 * con la orquesta completa; la forma del tipo ya esta preparada para eso, asi
 * que anadir instrumentos no obligara a tocar codigo.
 */
export const INSTRUMENTS: Readonly<Record<string, Instrument>> = Object.freeze({
  piano: define('piano', {
    name: 'Piano', family: 'keyboard', midiProgram: 0,
    range: ['A-1', 'C7'], tessitura: ['C1', 'C6'], clef: 'treble',
  }),
  violin: define('violin', {
    name: 'Violin', family: 'strings', midiProgram: 40,
    range: ['G3', 'A7'], tessitura: ['G3', 'E6'], clef: 'treble',
  }),
  viola: define('viola', {
    name: 'Viola', family: 'strings', midiProgram: 41,
    range: ['C3', 'E6'], tessitura: ['C3', 'A5'], clef: 'alto',
  }),
  cello: define('cello', {
    name: 'Violonchelo', family: 'strings', midiProgram: 42,
    range: ['C2', 'C6'], tessitura: ['C2', 'A4'], clef: 'bass',
  }),
  contrabass: define('contrabass', {
    name: 'Contrabajo', family: 'strings', midiProgram: 43,
    range: ['C1', 'C4'], tessitura: ['E1', 'G3'], clef: 'bass',
    transposition: '-P8', velocityOffset: 4,
  }),
  flute: define('flute', {
    name: 'Flauta', family: 'woodwind', midiProgram: 73,
    range: ['C4', 'D7'], tessitura: ['D4', 'G6'], clef: 'treble', velocityOffset: -4,
  }),
  oboe: define('oboe', {
    name: 'Oboe', family: 'woodwind', midiProgram: 68,
    range: ['Bb3', 'A6'], tessitura: ['D4', 'D6'], clef: 'treble',
  }),
  clarinet: define('clarinet', {
    name: 'Clarinete en Sib', family: 'woodwind', midiProgram: 71,
    range: ['D3', 'Bb6'], tessitura: ['E3', 'C6'], clef: 'treble', transposition: '-M2',
  }),
  bassoon: define('bassoon', {
    name: 'Fagot', family: 'woodwind', midiProgram: 70,
    range: ['Bb1', 'Eb5'], tessitura: ['C2', 'C4'], clef: 'bass',
  }),
  horn: define('horn', {
    name: 'Trompa en Fa', family: 'brass', midiProgram: 60,
    range: ['B1', 'F5'], tessitura: ['C3', 'C5'], clef: 'treble', transposition: '-P5',
  }),
  trumpet: define('trumpet', {
    name: 'Trompeta en Sib', family: 'brass', midiProgram: 56,
    range: ['E3', 'D6'], tessitura: ['G3', 'Bb5'], clef: 'treble',
    transposition: '-M2', velocityOffset: 6,
  }),
  trombone: define('trombone', {
    name: 'Trombon', family: 'brass', midiProgram: 57,
    range: ['E2', 'F5'], tessitura: ['G2', 'Bb4'], clef: 'bass', velocityOffset: 5,
  }),
  tuba: define('tuba', {
    name: 'Tuba', family: 'brass', midiProgram: 58,
    range: ['D1', 'F4'], tessitura: ['F1', 'F3'], clef: 'bass', velocityOffset: 4,
  }),
  timpani: define('timpani', {
    name: 'Timbales', family: 'percussion', midiProgram: 47,
    range: ['D2', 'C4'], tessitura: ['F2', 'F3'], clef: 'bass',
  }),
  drums: define('drums', {
    name: 'Bateria', family: 'percussion', midiProgram: 0,
    range: ['C1', 'B5'], tessitura: ['C1', 'B5'], clef: 'percussion', isPercussion: true,
  }),
  synth_bass: define('synth_bass', {
    name: 'Bajo sintetizado', family: 'electronic', midiProgram: 38,
    range: ['C1', 'C4'], tessitura: ['E1', 'G3'], clef: 'bass',
  }),
  synth_lead: define('synth_lead', {
    name: 'Lead sintetizado', family: 'electronic', midiProgram: 80,
    range: ['C2', 'C7'], tessitura: ['C3', 'C6'], clef: 'treble',
  }),
});

export function getInstrument(id: string): Instrument | undefined {
  return INSTRUMENTS[id];
}

export function listInstruments(): readonly Instrument[] {
  return Object.values(INSTRUMENTS);
}

/** Donde cae una altura respecto al rango del instrumento. */
export type RangeVerdict = 'below-range' | 'low-strain' | 'comfortable' | 'high-strain' | 'above-range';

export function classifyPitch(instrument: Instrument, sounding: Pitch): RangeVerdict {
  const midi = sounding.midi;
  if (midi < instrument.range.lowest.midi) return 'below-range';
  if (midi > instrument.range.highest.midi) return 'above-range';
  if (midi < instrument.tessitura.lowest.midi) return 'low-strain';
  if (midi > instrument.tessitura.highest.midi) return 'high-strain';
  return 'comfortable';
}

/** Convierte una altura escrita en la que realmente suena. */
export function soundingPitch(instrument: Instrument, written: Pitch): Pitch {
  return written.transpose(instrument.transposition);
}

/** Convierte una altura sonante en la que hay que escribir para ese instrumento. */
export function writtenPitch(instrument: Instrument, sounding: Pitch): Pitch {
  return sounding.transpose(instrument.transposition.inverted());
}
