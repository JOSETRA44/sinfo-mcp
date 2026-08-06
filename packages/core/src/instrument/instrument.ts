import { Interval } from '../pitch/interval.js';
import {
  INSTRUMENT_SPECS,
  type Clef,
  type InstrumentFamily,
  type InstrumentSpec,
} from './catalog.js';
import { Pitch } from '../pitch/pitch.js';

export type { Clef, InstrumentFamily };

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
  /**
   * Ejecutantes de la seccion en una orquesta sinfonica. Es lo que decide el
   * balance: catorce violines tapan a una flauta aunque los dos toquen mf.
   */
  readonly sectionSize: number;
  /** Peso dinamico relativo, 1 = referencia (un violin). */
  readonly weight: number;
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
    sectionSize: spec.sectionSize ?? 1,
    weight: spec.weight ?? 1,
  });
}

/**
 * Catalogo de instrumentos, construido a partir de los datos de `catalog.ts`.
 *
 * Los datos y su interpretacion viven separados a proposito: anadir un
 * instrumento es anadir una entrada al literal, sin tocar esta funcion ni
 * ninguna otra.
 */
export const INSTRUMENTS: Readonly<Record<string, Instrument>> = Object.freeze(
  Object.fromEntries(
    Object.entries(INSTRUMENT_SPECS).map(([id, spec]) => [id, define(id, spec)]),
  ),
);

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
