import {
  Duration,
  splitIntoMeasures,
  type Dynamic,
  type Instrument,
  type MeasureSlice,
  type Movement,
  type NotatedEvent,
  type Part,
  type Score,
} from '@sinfo/core';
import type {
  ExportFormat,
  RenderedArtifact,
  ScoreRenderer,
  ScoreRenderOptions,
} from '@sinfo/engine';
import { computeDivisions, toDivisions } from './divisions.js';
import { CLEF_SHAPES, writeNote, type TupletPosition } from './note-xml.js';
import { XmlWriter } from './xml.js';

/**
 * Exportador a MusicXML 4.0 en formato `score-partwise`.
 *
 * Partwise y no timewise porque es lo que leen MuseScore, Sibelius, Finale y
 * Dorico: agrupa la musica por instrumento y luego por compas, que es como se
 * lee una particella.
 *
 * Este exportador es lo que hace VISIBLE el trabajo: hasta ahora la unica
 * salida era MIDI, que suena pero no muestra si las ligaduras, los tresillos o
 * las transposiciones estan bien escritos.
 */
export class MusicXmlRenderer implements ScoreRenderer {
  /** LilyPond, ABC y SVG comparten puerto pero los cubriran otros adaptadores. */
  readonly formats: readonly ExportFormat[] = ['musicxml'];

  // eslint-disable-next-line @typescript-eslint/require-await
  async render(score: Score, options: ScoreRenderOptions = {}): Promise<RenderedArtifact> {
    const movements = options.movementId
      ? [score.movement(options.movementId)]
      : [...score.movements];

    const layout = buildLayout(movements);
    const xml = new XmlWriter();

    xml.raw('<?xml version="1.0" encoding="UTF-8"?>');
    xml.raw(
      '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" ' +
        '"http://www.musicxml.org/dtds/partwise.dtd">',
    );

    xml.element('score-partwise', { version: '4.0' }, () => {
      writeHeader(xml, score);
      writePartList(xml, layout);
      for (const part of layout.parts) writePart(xml, part, layout);
    });

    const text = xml.toString();
    return {
      format: 'musicxml',
      data: new TextEncoder().encode(text),
      mimeType: 'application/vnd.recordare.musicxml+xml',
      filename: `${slugify(score.metadata.title)}.musicxml`,
      meta: {
        parts: layout.parts.length,
        measures: layout.parts[0]?.measuresByVoice[0]?.length ?? 0,
        divisions: layout.divisions,
        movements: movements.length,
      },
    };
  }
}

// ------------------------------------------------------------------ modelo

interface VoiceLayout {
  readonly voiceNumber: number;
  readonly measures: readonly MeasureSlice[];
}

interface PartLayout {
  readonly id: string;
  readonly xmlId: string;
  readonly name: string;
  readonly instrument: Instrument;
  readonly measuresByVoice: readonly (readonly MeasureSlice[])[];
  readonly voiceNumbers: readonly number[];
}

interface Layout {
  readonly parts: readonly PartLayout[];
  readonly divisions: number;
  readonly measureCount: number;
}

/**
 * Prepara la obra entera antes de escribir una sola etiqueta.
 *
 * `divisions` tiene que ser la misma en todas las partes y se declara en el
 * primer compas, asi que hay que conocer TODAS las duraciones de la obra antes
 * de empezar. Por eso el reparto en compases se hace primero y de una vez.
 */
function buildLayout(movements: readonly Movement[]): Layout {
  const partIds: string[] = [];
  for (const movement of movements) {
    for (const part of movement.parts) if (!partIds.includes(part.id)) partIds.push(part.id);
  }

  const durations: Duration[] = [];
  const parts: PartLayout[] = [];

  for (const [index, partId] of partIds.entries()) {
    const reference = findPart(movements, partId);
    const voiceIds = collectVoiceIds(movements, partId);
    const measuresByVoice: MeasureSlice[][] = [];

    for (const voiceId of voiceIds) {
      const measures: MeasureSlice[] = [];
      for (const movement of movements) {
        if (!movement.hasPart(partId)) continue;
        const part = movement.part(partId);
        if (!part.hasVoice(voiceId)) continue;

        // `totalDuration` iguala el numero de compases de todas las partes: si
        // los violines siguen, el fagot calla con silencios en vez de que su
        // pentagrama se acabe antes que el resto de la partitura.
        measures.push(
          ...splitIntoMeasures(part.voice(voiceId), movement.timeline, {
            totalDuration: movement.duration,
          }),
        );
      }
      measuresByVoice.push(measures);
      for (const measure of measures) {
        for (const item of measure.events) durations.push(item.event.duration);
      }
    }

    parts.push({
      id: partId,
      xmlId: `P${index + 1}`,
      name: reference.name,
      instrument: reference.instrument,
      measuresByVoice,
      voiceNumbers: voiceIds.map((_, position) => position + 1),
    });
  }

  return {
    parts,
    divisions: computeDivisions(durations),
    measureCount: Math.max(0, ...parts.map((p) => p.measuresByVoice[0]?.length ?? 0)),
  };
}

function findPart(movements: readonly Movement[], partId: string): Part {
  for (const movement of movements) {
    if (movement.hasPart(partId)) return movement.part(partId);
  }
  throw new Error(`Parte "${partId}" no encontrada`);
}

function collectVoiceIds(movements: readonly Movement[], partId: string): string[] {
  const ids: string[] = [];
  for (const movement of movements) {
    if (!movement.hasPart(partId)) continue;
    for (const voiceId of movement.part(partId).voiceIds) {
      if (!ids.includes(voiceId)) ids.push(voiceId);
    }
  }
  return ids;
}

// ---------------------------------------------------------------- cabecera

function writeHeader(xml: XmlWriter, score: Score): void {
  xml.element('work', () => {
    xml.text('work-title', score.metadata.title);
  });

  xml.element('identification', () => {
    if (score.metadata.composer !== undefined) {
      xml.text('creator', score.metadata.composer, { type: 'composer' });
    }
    if (score.metadata.copyright !== undefined) {
      xml.text('rights', score.metadata.copyright);
    }
    xml.element('encoding', () => {
      xml.text('software', 'sinfo-mcp');
      xml.text('encoding-date', new Date().toISOString().slice(0, 10));
      xml.empty('supports', { element: 'accidental', type: 'yes' });
      xml.empty('supports', { element: 'beam', type: 'no' });
      xml.empty('supports', { element: 'print', attribute: 'new-page', type: 'no' });
    });
  });
}

function writePartList(xml: XmlWriter, layout: Layout): void {
  xml.element('part-list', () => {
    for (const part of layout.parts) {
      xml.element('score-part', { id: part.xmlId }, () => {
        xml.text('part-name', part.name);
        xml.text('part-abbreviation', abbreviate(part.name));

        const instrumentId = `${part.xmlId}-I1`;
        xml.element('score-instrument', { id: instrumentId }, () => {
          xml.text('instrument-name', part.instrument.name);
        });
        xml.element('midi-instrument', { id: instrumentId }, () => {
          // MusicXML numera los canales desde 1; la percusion va al 10.
          xml.text('midi-channel', part.instrument.isPercussion ? 10 : 1);
          xml.text('midi-program', part.instrument.midiProgram + 1);
          xml.text('volume', 80);
          xml.text('pan', 0);
        });
      });
    }
  });
}

// ----------------------------------------------------------------- partes

function writePart(xml: XmlWriter, part: PartLayout, layout: Layout): void {
  xml.element('part', { id: part.xmlId }, () => {
    const voices: VoiceLayout[] = part.measuresByVoice.map((measures, index) => ({
      voiceNumber: part.voiceNumbers[index]!,
      measures,
    }));

    for (let index = 0; index < layout.measureCount; index++) {
      const number = index + 1;
      xml.element('measure', { number }, () => {
        const reference = voices[0]?.measures[index];
        if (reference) writeAttributes(xml, reference, part, layout.divisions);

        for (const [voiceIndex, voice] of voices.entries()) {
          const measure = voice.measures[index];
          if (!measure) continue;

          // Cada voz adicional empieza otra vez desde el principio del compas,
          // asi que hay que rebobinar el reloj con `<backup>`.
          if (voiceIndex > 0) {
            xml.element('backup', () => {
              xml.text('duration', toDivisions(measureLength(measure), layout.divisions));
            });
          }

          if (voiceIndex === 0) writeDirections(xml, measure, index === 0);
          writeMeasureNotes(xml, measure, voice.voiceNumber, part, layout.divisions);
        }
      });
    }
  });
}

function writeAttributes(
  xml: XmlWriter,
  measure: MeasureSlice,
  part: PartLayout,
  divisions: number,
): void {
  const isFirst = measure.number === 1;
  const needsAttributes = isFirst || measure.keyChanged || measure.timeSignatureChanged;
  if (!needsAttributes) return;

  xml.element('attributes', () => {
    // `divisions` solo se declara una vez, al principio: repetirlo en cada
    // compas es legal pero algunos editores lo interpretan como un cambio de
    // resolucion y recalculan mal las duraciones.
    if (isFirst) xml.text('divisions', divisions);

    if (isFirst || measure.keyChanged) {
      xml.element('key', () => {
        xml.text('fifths', measure.keySignature.fifths);
        xml.text('mode', measure.keySignature.isMinorLike ? 'minor' : 'major');
      });
    }

    if (isFirst || measure.timeSignatureChanged) {
      xml.element('time', () => {
        xml.text('beats', measure.timeSignature.numerator);
        xml.text('beat-type', measure.timeSignature.denominator);
      });
    }

    if (isFirst) {
      const clef = CLEF_SHAPES[part.instrument.clef];
      xml.element('clef', () => {
        xml.text('sign', clef.sign);
        xml.text('line', clef.line);
      });
      writeTranspose(xml, part.instrument);
    }
  });
}

/**
 * La transposicion del instrumento.
 *
 * MusicXML guarda lo ESCRITO y aparte cuanto hay que transportar para obtener
 * lo que suena. Sin esto, un clarinete en Sib se mostraria correcto en su
 * particella pero sonaria una segunda mayor demasiado alto al reproducir, y la
 * partitura general saldria con las alturas equivocadas.
 */
function writeTranspose(xml: XmlWriter, instrument: Instrument): void {
  const { transposition } = instrument;
  if (transposition.chromatic === 0 && transposition.diatonic === 0) return;

  // El componente de octava se declara aparte del intervalo simple.
  const octaveChange = Math.trunc(transposition.chromatic / 12);
  const chromatic = transposition.chromatic - octaveChange * 12;
  const diatonic = transposition.diatonic - octaveChange * 7;

  xml.element('transpose', () => {
    xml.text('diatonic', diatonic);
    xml.text('chromatic', chromatic);
    if (octaveChange !== 0) xml.text('octave-change', octaveChange);
  });
}

function writeDirections(xml: XmlWriter, measure: MeasureSlice, isFirst: boolean): void {
  if (isFirst || measure.tempoChanged) {
    xml.element('direction', { placement: 'above' }, () => {
      xml.element('direction-type', () => {
        xml.element('metronome', () => {
          xml.text('beat-unit', 'quarter');
          xml.text('per-minute', Math.round(measure.tempo.quarterNotesPerMinute));
        });
      });
      xml.empty('sound', { tempo: Math.round(measure.tempo.quarterNotesPerMinute) });
    });
  }

  const first = measure.events.find((item) => item.event.dynamic !== undefined);
  if (first?.event.dynamic !== undefined) {
    writeDynamic(xml, first.event.dynamic);
  }
}

function writeDynamic(xml: XmlWriter, dynamic: Dynamic): void {
  xml.element('direction', { placement: 'below' }, () => {
    xml.element('direction-type', () => {
      xml.element('dynamics', () => {
        xml.empty(dynamic);
      });
    });
  });
}

function writeMeasureNotes(
  xml: XmlWriter,
  measure: MeasureSlice,
  voiceNumber: number,
  part: PartLayout,
  divisions: number,
): void {
  const positions = tupletPositions(measure.events);

  for (const [index, item] of measure.events.entries()) {
    writeNote(xml, item, {
      divisions,
      voiceNumber,
      instrument: part.instrument,
      tupletPosition: positions[index]!,
    });
  }
}

/**
 * Marca donde empieza y acaba cada grupo irregular.
 *
 * No se puede decidir mirando una figura suelta: un tresillo es "start" solo
 * si la anterior no era tresillo, y "stop" solo si la siguiente no lo es. Sin
 * estas marcas el editor dibuja el numerito sobre cada nota en vez de un
 * corchete sobre el grupo.
 */
function tupletPositions(events: readonly NotatedEvent[]): TupletPosition[] {
  return events.map((item, index) => {
    if (!item.shape.tuplet) return null;
    const previous = events[index - 1]?.shape.tuplet ?? null;
    const next = events[index + 1]?.shape.tuplet ?? null;

    const sameAs = (other: typeof previous): boolean =>
      other !== null &&
      other.actual === item.shape.tuplet!.actual &&
      other.normal === item.shape.tuplet!.normal;

    if (!sameAs(previous)) return 'start';
    if (!sameAs(next)) return 'stop';
    return 'inside';
  });
}

function measureLength(measure: MeasureSlice): Duration {
  return measure.events.reduce(
    (total, item) => total.plus(item.event.duration),
    Duration.ZERO,
  );
}

function abbreviate(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1) return `${words[0]!.slice(0, 3)}.`;
  return words.map((word) => word[0]!.toUpperCase()).join('');
}

function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'partitura' : slug;
}
