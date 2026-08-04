import {
  articulationLengthFactor,
  Duration,
  isRest,
  resolveVelocity,
  soundingPitch,
  type Dynamic,
  type Movement,
  type Part,
  type Score,
} from '@sinfo/core';
import type { MidiRenderer, MidiRenderOptions, RenderedArtifact } from '@sinfo/engine';
import { writeMidi, type MidiEvent } from 'midi-file';
import { assignChannels } from './channels.js';

/**
 * 480 pulsos por negra: divisible por 2, 3, 4, 5, 6, 8, 10, 12, 16, 24 y 32,
 * asi que tresillos, quintillos y seisillos caen exactos en la rejilla. Es
 * ademas el valor por defecto de la mayoria de los DAW.
 */
const DEFAULT_PPQ = 480;

interface ScheduledNote {
  readonly startTick: number;
  readonly endTick: number;
  readonly noteNumber: number;
  readonly velocity: number;
  readonly channel: number;
}

/**
 * Escribe la partitura como archivo MIDI estandar de formato 1.
 *
 * Formato 1 y no 0 porque separa las pistas: la 0 lleva el mapa de tempo y
 * compas, y cada parte va en la suya. Es lo que espera cualquier DAW o editor
 * al importar, y lo que permite que el usuario mueva los violines sin tocar
 * las trompas.
 */
export class MidiFileRenderer implements MidiRenderer {
  render(score: Score, options: MidiRenderOptions = {}): RenderedArtifact {
    const ppq = options.ppq ?? DEFAULT_PPQ;
    const movements = options.movementId
      ? [score.movement(options.movementId)]
      : [...score.movements];

    // Las partes se identifican por id a lo largo de todos los movimientos:
    // los violines primeros del cuarto movimiento van a la misma pista que
    // los del primero, que es como se lee una partitura.
    const partIds = collectPartIds(movements);
    const allParts = collectParts(movements, partIds);
    const channels = assignChannels(allParts);

    const conductor: TimedMidiEvent[] = [];
    const notesByPart = new Map<string, ScheduledNote[]>(partIds.map((id) => [id, []]));

    let offset = Duration.ZERO;
    for (const movement of movements) {
      collectConductorEvents(movement, offset, ppq, conductor);
      for (const part of movement.parts) {
        const channel = channels.byPartId.get(part.id)!;
        collectNotes(part, offset, ppq, channel, notesByPart.get(part.id)!);
      }
      offset = offset.plus(movement.duration);
    }

    const tracks: MidiEvent[][] = [
      buildConductorTrack(score.metadata.title, conductor),
      ...partIds.map((id) => {
        const part = allParts.find((candidate) => candidate.id === id)!;
        return buildPartTrack(part, channels.byPartId.get(id)!, notesByPart.get(id)!);
      }),
    ];

    const bytes = writeMidi({
      header: { format: 1, numTracks: tracks.length, ticksPerBeat: ppq },
      tracks,
    });

    const totalTicks = offset.toTicks(ppq);
    return {
      format: 'midi',
      data: Uint8Array.from(bytes),
      mimeType: 'audio/midi',
      filename: `${slugify(score.metadata.title)}.mid`,
      meta: {
        ppq,
        tracks: tracks.length,
        parts: partIds.length,
        movements: movements.length,
        totalTicks,
        noteCount: [...notesByPart.values()].reduce((sum, notes) => sum + notes.length, 0),
        ...(channels.exhausted
          ? {
              warning:
                'Hay mas partes melodicas que canales MIDI; algunos se reutilizan. ' +
                'Cada parte conserva su propia pista.',
            }
          : {}),
      },
    };
  }
}

/**
 * `Omit` sobre una union colapsa a las claves comunes a todos los miembros, y
 * MidiEvent es una union de dos docenas de formas: el resultado se quedaba sin
 * `meta`, `channel` ni nada especifico. Repartir el Omit por cada miembro
 * conserva la union entera.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

interface TimedMidiEvent {
  readonly tick: number;
  /** Desempate cuando dos eventos caen en el mismo tick. */
  readonly order: number;
  readonly event: DistributiveOmit<MidiEvent, 'deltaTime'>;
}

function collectPartIds(movements: readonly Movement[]): string[] {
  const ids: string[] = [];
  for (const movement of movements) {
    for (const part of movement.parts) {
      if (!ids.includes(part.id)) ids.push(part.id);
    }
  }
  return ids;
}

function collectParts(movements: readonly Movement[], partIds: readonly string[]): Part[] {
  return partIds.map((id) => {
    for (const movement of movements) {
      if (movement.hasPart(id)) return movement.part(id);
    }
    throw new Error(`Parte "${id}" no encontrada`);
  });
}

function collectConductorEvents(
  movement: Movement,
  offset: Duration,
  ppq: number,
  out: TimedMidiEvent[],
): void {
  for (const { at, value } of movement.timeline.tempoChanges) {
    out.push({
      tick: offset.plus(at).toTicks(ppq),
      order: 0,
      event: { meta: true, type: 'setTempo', microsecondsPerBeat: value.microsecondsPerQuarter },
    });
  }
  for (const { at, value } of movement.timeline.timeSignatureChanges) {
    out.push({
      tick: offset.plus(at).toTicks(ppq),
      order: 1,
      event: {
        meta: true,
        type: 'timeSignature',
        numerator: value.numerator,
        denominator: value.denominator,
        metronome: 24,
        thirtyseconds: 8,
      },
    });
  }
  for (const { at, value } of movement.timeline.keyChanges) {
    out.push({
      tick: offset.plus(at).toTicks(ppq),
      order: 2,
      event: {
        meta: true,
        type: 'keySignature',
        key: value.fifths,
        scale: value.isMinorLike ? 1 : 0,
      },
    });
  }
}

function collectNotes(
  part: Part,
  offset: Duration,
  ppq: number,
  channel: number,
  out: ScheduledNote[],
): void {
  for (const voice of part.voices) {
    // La dinamica es una MARCA que rige hasta la siguiente, no una propiedad
    // de cada nota: en la partitura se escribe una vez debajo del pentagrama.
    // Sin arrastrarla, un pasaje marcado `p` sonaria suave solo en su primera
    // nota y el resto volveria a mezzoforte.
    let prevailingDynamic: Dynamic | undefined;

    for (const { position, event } of voice.positioned()) {
      if (event.dynamic !== undefined) prevailingDynamic = event.dynamic;
      if (isRest(event)) continue;

      // Se redondea la POSICION ABSOLUTA, no cada duracion por separado. Si
      // se redondease duracion a duracion, el error se sumaria nota a nota y
      // al compas 500 la musica iria corrida. Asi el error nunca se acumula:
      // cada nota se ancla a su posicion exacta.
      const absoluteStart = offset.plus(position);
      const startTick = absoluteStart.toTicks(ppq);
      const endOfWritten = absoluteStart.plus(event.duration).toTicks(ppq);

      // El staccato acorta lo que SUENA; lo escrito no cambia. El factor se
      // limita a 1: una nota nunca invade el sitio de la siguiente, ni
      // siquiera con calderon, que alarga el compas y no la nota.
      const factor = Math.min(1, articulationLengthFactor(event.articulations ?? []));
      const soundingTicks = Math.max(1, Math.round((endOfWritten - startTick) * factor));

      const velocity = resolveVelocity(event, {
        instrumentOffset: part.instrument.velocityOffset,
        ...(prevailingDynamic !== undefined ? { prevailingDynamic } : {}),
      });

      for (const written of event.pitches) {
        // La percusion no transpone: sus "alturas" son numeros de sonido.
        const sounding = part.instrument.isPercussion
          ? written
          : soundingPitch(part.instrument, written);
        out.push({
          startTick,
          endTick: startTick + soundingTicks,
          noteNumber: clampMidi(sounding.midi),
          velocity,
          channel,
        });
      }
    }
  }
}

function buildConductorTrack(title: string, events: readonly TimedMidiEvent[]): MidiEvent[] {
  const timed: TimedMidiEvent[] = [
    { tick: 0, order: -1, event: { meta: true, type: 'trackName', text: title } },
    ...events,
  ];
  return toDeltaTimes(timed);
}

function buildPartTrack(
  part: Part,
  channel: number,
  notes: readonly ScheduledNote[],
): MidiEvent[] {
  const timed: TimedMidiEvent[] = [
    { tick: 0, order: -2, event: { meta: true, type: 'trackName', text: part.name } },
  ];

  if (!part.instrument.isPercussion) {
    timed.push({
      tick: 0,
      order: -1,
      event: { type: 'programChange', channel, programNumber: part.instrument.midiProgram },
    });
  }

  for (const note of notes) {
    timed.push({
      tick: note.startTick,
      // Los note-off van antes que los note-on en el mismo tick (order 0 < 1):
      // si no, repetir la misma nota apaga la que se acaba de encender.
      order: 1,
      event: {
        type: 'noteOn',
        channel: note.channel,
        noteNumber: note.noteNumber,
        velocity: note.velocity,
      },
    });
    timed.push({
      tick: note.endTick,
      order: 0,
      event: {
        type: 'noteOff',
        channel: note.channel,
        noteNumber: note.noteNumber,
        velocity: 0,
      },
    });
  }

  return toDeltaTimes(timed);
}

/** Ordena por tick y convierte posiciones absolutas en tiempos delta. */
function toDeltaTimes(events: readonly TimedMidiEvent[]): MidiEvent[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);

  const result: MidiEvent[] = [];
  let previousTick = 0;
  for (const { tick, event } of sorted) {
    result.push({ ...event, deltaTime: tick - previousTick } as MidiEvent);
    previousTick = tick;
  }
  result.push({ deltaTime: 0, meta: true, type: 'endOfTrack' });
  return result;
}

function clampMidi(value: number): number {
  return Math.max(0, Math.min(127, value));
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
