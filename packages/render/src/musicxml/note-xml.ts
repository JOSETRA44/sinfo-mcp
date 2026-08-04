import type { Articulation, Clef, Instrument, NotatedEvent, Pitch } from '@sinfo/core';
import { toDivisions } from './divisions.js';
import type { XmlWriter } from './xml.js';

/** Posicion de una figura dentro de un grupo irregular. */
export type TupletPosition = 'start' | 'inside' | 'stop' | null;

export interface NoteContext {
  readonly divisions: number;
  readonly voiceNumber: number;
  readonly instrument: Instrument;
  readonly tupletPosition: TupletPosition;
}

/**
 * Escribe un evento como una o varias etiquetas `<note>`.
 *
 * Un acorde son varias `<note>` seguidas donde todas menos la primera llevan
 * `<chord/>`: MusicXML no tiene un elemento acorde, encadena notas y marca
 * cuales suenan a la vez.
 */
export function writeNote(xml: XmlWriter, item: NotatedEvent, context: NoteContext): void {
  const duration = toDivisions(item.event.duration, context.divisions);

  if (item.event.pitches.length === 0) {
    xml.element('note', () => {
      if (item.isFullMeasureRest) xml.empty('rest', { measure: 'yes' });
      else xml.empty('rest');
      xml.text('duration', duration);
      xml.text('voice', context.voiceNumber);
      // Un silencio de compas entero no lleva `<type>`: el editor lo dibuja
      // segun el compas, y declarar la figura entra en conflicto con eso.
      if (!item.isFullMeasureRest) writeTypeAndDots(xml, item);
      writeTimeModification(xml, item);
    });
    return;
  }

  for (const [index, pitch] of item.event.pitches.entries()) {
    xml.element('note', () => {
      if (index > 0) xml.empty('chord');
      writePitch(xml, pitch, context.instrument);
      xml.text('duration', duration);
      writeTies(xml, item);
      xml.text('voice', context.voiceNumber);
      writeTypeAndDots(xml, item);
      writeTimeModification(xml, item);
      writeNotations(xml, item, context, index === 0);
    });
  }
}

/**
 * MusicXML guarda la altura ESCRITA, no la que suena: la transposicion del
 * instrumento va aparte, en `<transpose>`. Por eso aqui se vuelca la altura
 * tal cual, con su ortografia: es justo lo que el interprete lee en el atril.
 */
function writePitch(xml: XmlWriter, pitch: Pitch, instrument: Instrument): void {
  if (instrument.isPercussion) {
    // La percusion no tiene alturas: `<unpitched>` dice en que linea del
    // pentagrama se dibuja la cabeza, no que nota suena.
    xml.element('unpitched', () => {
      xml.text('display-step', pitch.step);
      xml.text('display-octave', pitch.octave);
    });
    return;
  }

  xml.element('pitch', () => {
    xml.text('step', pitch.step);
    if (pitch.alter !== 0) xml.text('alter', pitch.alter);
    xml.text('octave', pitch.octave);
  });
}

function writeTies(xml: XmlWriter, item: NotatedEvent): void {
  // `<tie>` es la instruccion de sonido; `<tied>`, dentro de `<notations>`, es
  // la curva dibujada. MusicXML pide las dos y hay editores que solo miran una.
  if (item.tiedFromPrevious) xml.empty('tie', { type: 'stop' });
  if (item.tiedToNext) xml.empty('tie', { type: 'start' });
}

function writeTypeAndDots(xml: XmlWriter, item: NotatedEvent): void {
  xml.text('type', item.shape.noteType);
  for (let dot = 0; dot < item.shape.dots; dot++) xml.empty('dot');
}

function writeTimeModification(xml: XmlWriter, item: NotatedEvent): void {
  const { tuplet } = item.shape;
  if (!tuplet) return;
  xml.element('time-modification', () => {
    xml.text('actual-notes', tuplet.actual);
    xml.text('normal-notes', tuplet.normal);
  });
}

function writeNotations(
  xml: XmlWriter,
  item: NotatedEvent,
  context: NoteContext,
  isFirstOfChord: boolean,
): void {
  const articulations = isFirstOfChord ? (item.event.articulations ?? []) : [];
  const hasTied = item.tiedFromPrevious || item.tiedToNext;
  const hasTuplet =
    isFirstOfChord && (context.tupletPosition === 'start' || context.tupletPosition === 'stop');
  const marks = articulations.filter((a) => ARTICULATION_TAGS[a] !== undefined);

  if (!hasTied && !hasTuplet && marks.length === 0) return;

  xml.element('notations', () => {
    if (item.tiedFromPrevious) xml.empty('tied', { type: 'stop' });
    if (item.tiedToNext) xml.empty('tied', { type: 'start' });
    if (hasTuplet) xml.empty('tuplet', { type: context.tupletPosition!, number: 1 });

    const inArticulations = marks.filter((a) => ARTICULATION_TAGS[a]!.group === 'articulations');
    if (inArticulations.length > 0) {
      xml.element('articulations', () => {
        for (const mark of inArticulations) xml.empty(ARTICULATION_TAGS[mark]!.tag);
      });
    }

    for (const mark of marks) {
      if (ARTICULATION_TAGS[mark]!.group === 'root') xml.empty(ARTICULATION_TAGS[mark]!.tag);
    }
  });
}

/**
 * El calderon y la ligadura de expresion no van dentro de `<articulations>`
 * sino directamente bajo `<notations>`: MusicXML los clasifica aparte y un
 * editor rechaza el archivo si se colocan mal.
 */
const ARTICULATION_TAGS: Readonly<
  Record<Articulation, { tag: string; group: 'articulations' | 'root' } | undefined>
> = {
  staccato: { tag: 'staccato', group: 'articulations' },
  staccatissimo: { tag: 'staccatissimo', group: 'articulations' },
  tenuto: { tag: 'tenuto', group: 'articulations' },
  accent: { tag: 'accent', group: 'articulations' },
  marcato: { tag: 'strong-accent', group: 'articulations' },
  portato: { tag: 'detached-legato', group: 'articulations' },
  fermata: { tag: 'fermata', group: 'root' },
  // La ligadura de expresion abarca varias notas: necesita saber donde empieza
  // y acaba, y eso no se puede decidir mirando una nota suelta. Queda fuera
  // hasta que el dominio guarde el fraseo como un tramo y no como una marca.
  legato: undefined,
};

/** Signo y linea del pentagrama para cada clave. */
export const CLEF_SHAPES: Readonly<Record<Clef, { sign: string; line: number }>> = {
  treble: { sign: 'G', line: 2 },
  bass: { sign: 'F', line: 4 },
  alto: { sign: 'C', line: 3 },
  tenor: { sign: 'C', line: 4 },
  percussion: { sign: 'percussion', line: 2 },
};
