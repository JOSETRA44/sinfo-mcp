import {
  type BeatGrid,
  type Performance,
  type PerformanceTrack,
  type RawNote,
  createGrid,
} from '@sinfo/perform';
import { parseMidi } from 'midi-file';

/**
 * Lectura de un archivo MIDI como interpretacion.
 *
 * Un MIDI de secuenciador y uno grabado a un teclado son el mismo formato y
 * cosas distintas: el primero cae en la rejilla y el segundo lleva dentro
 * todo el rubato del interprete. Por eso se lee como `Performance` —tiempos en
 * segundos— y no directamente como partitura: dejar que el cuantizador decida
 * es lo que hace que ambos casos salgan bien.
 *
 * La ventaja frente al audio es que aqui no se estima nada. Las alturas, los
 * ataques y el mapa de tempo vienen escritos, asi que la rejilla de pulso es
 * exacta y el unico juicio que queda es el de la notacion.
 */

/** Canal de percusion en General MIDI, contando desde cero. */
const DRUM_CHANNEL = 9;

/** Tempo por defecto del formato MIDI: 120 negras por minuto. */
const DEFAULT_MICROSECONDS_PER_BEAT = 500_000;

export interface ReadMidiOptions {
  /** Nombre para la procedencia; normalmente el del archivo. */
  readonly name?: string | undefined;
  /**
   * Descartar pistas sin notas. Los MIDI reales llevan pistas de metadatos
   * vacias que si no acabarian como partes mudas en la partitura.
   */
  readonly dropEmptyTracks?: boolean | undefined;
}

export function readMidi(data: Uint8Array, options: ReadMidiOptions = {}): Performance {
  const parsed = parseMidi(data);
  const ticksPerBeat = parsed.header.ticksPerBeat ?? 480;

  const tempoMap = collectTempoMap(parsed.tracks, ticksPerBeat);
  const toSeconds = (tick: number): number => tickToSeconds(tick, tempoMap, ticksPerBeat);

  const groups = new Map<string, MutableTrack>();
  let lastTick = 0;
  let timeSignature: string | undefined;

  parsed.tracks.forEach((events, trackIndex) => {
    let tick = 0;
    let trackName: string | undefined;
    /** Notas sonando ahora mismo, por canal y altura. */
    const pending = new Map<string, { tick: number; velocity: number }[]>();

    for (const event of events) {
      tick += event.deltaTime;
      if (tick > lastTick) lastTick = tick;

      if (event.type === 'trackName') {
        trackName = event.text.trim() || undefined;
        continue;
      }
      if (event.type === 'timeSignature' && timeSignature === undefined) {
        timeSignature = `${event.numerator}/${event.denominator}`;
        continue;
      }
      if (event.type === 'programChange') {
        trackFor(groups, trackIndex, event.channel, trackName).program = event.programNumber;
        continue;
      }

      if (event.type === 'noteOn' && event.velocity > 0) {
        const key = `${event.channel}:${event.noteNumber}`;
        const stack = pending.get(key);
        if (stack === undefined) pending.set(key, [{ tick, velocity: event.velocity }]);
        else stack.push({ tick, velocity: event.velocity });
        continue;
      }

      // Un `noteOn` con velocidad cero es un `noteOff` disfrazado: el formato
      // lo permite para poder encadenar eventos y muchos archivos lo usan.
      const isNoteOff =
        event.type === 'noteOff' || (event.type === 'noteOn' && event.velocity === 0);
      if (!isNoteOff) continue;

      const key = `${event.channel}:${event.noteNumber}`;
      const started = pending.get(key)?.shift();
      if (started === undefined) continue;

      const track = trackFor(groups, trackIndex, event.channel, trackName);
      const onset = toSeconds(started.tick);
      const offset = toSeconds(tick);
      track.notes.push({
        onset,
        // Una nota de duracion cero existe en MIDI y no en notacion. Se le da
        // un tick para que sobreviva hasta el cuantizador, que ya decidira.
        offset: offset > onset ? offset : onset + 0.001,
        midi: event.noteNumber,
        velocity: started.velocity,
        // No es una estimacion: el archivo lo dice.
        confidence: 1,
      });
    }

    // Notas sin cerrar: el archivo se corto o esta mal formado. Se cierran al
    // final en vez de descartarlas.
    for (const [key, stack] of pending) {
      const noteNumber = Number(key.split(':')[1] ?? '60');
      const channel = Number(key.split(':')[0] ?? '0');
      for (const started of stack) {
        const track = trackFor(groups, trackIndex, channel, trackName);
        const onset = toSeconds(started.tick);
        track.notes.push({
          onset,
          offset: Math.max(toSeconds(lastTick), onset + 0.001),
          midi: noteNumber,
          velocity: started.velocity,
          confidence: 1,
        });
      }
    }
  });

  const tracks: PerformanceTrack[] = [];
  for (const track of groups.values()) {
    if (options.dropEmptyTracks !== false && track.notes.length === 0) continue;
    tracks.push({
      id: track.id,
      ...(track.name === undefined ? {} : { name: track.name }),
      ...(track.program === undefined ? {} : { midiProgram: track.program }),
      ...(track.channel === DRUM_CHANNEL ? { isPercussion: true } : {}),
      notes: track.notes.sort((a, b) => a.onset - b.onset || a.midi - b.midi),
    });
  }

  return {
    tracks,
    grid: buildGrid(lastTick, ticksPerBeat, toSeconds, timeSignature),
    ...(timeSignature === undefined ? {} : { timeSignatureHint: timeSignature }),
    source: {
      kind: 'midi',
      ...(options.name === undefined ? {} : { name: options.name }),
    },
  };
}

// --------------------------------------------------------------- interiores

interface MutableTrack {
  readonly id: string;
  readonly channel: number;
  name: string | undefined;
  program: number | undefined;
  notes: RawNote[];
}

/**
 * Una parte por pista Y canal.
 *
 * Agrupar solo por pista falla con los archivos de formato 0, que meten toda
 * la orquesta en una sola pista repartida por canales. Agrupar solo por canal
 * falla al reves: dos pistas del formato 1 pueden compartir canal y son
 * instrumentos distintos. La pareja funciona con ambos.
 */
function trackFor(
  groups: Map<string, MutableTrack>,
  trackIndex: number,
  channel: number,
  name: string | undefined,
): MutableTrack {
  const id = `t${trackIndex}c${channel}`;
  const existing = groups.get(id);
  if (existing !== undefined) {
    if (existing.name === undefined && name !== undefined) existing.name = name;
    return existing;
  }
  const created: MutableTrack = { id, channel, name, program: undefined, notes: [] };
  groups.set(id, created);
  return created;
}

interface TempoChange {
  readonly tick: number;
  readonly microsecondsPerBeat: number;
  /** Segundos acumulados hasta este cambio, para no recorrer la lista entera. */
  readonly seconds: number;
}

/**
 * Mapa de tempo global.
 *
 * En formato 1 los cambios de tempo viven en la primera pista y afectan a
 * todas, asi que se recogen de todas y se ordenan por tick: leerlos pista a
 * pista dejaria al resto con el tempo por defecto.
 */
function collectTempoMap(
  tracks: readonly { deltaTime: number; type: string }[][],
  ticksPerBeat: number,
): TempoChange[] {
  const raw: { tick: number; microsecondsPerBeat: number }[] = [];
  for (const events of tracks) {
    let tick = 0;
    for (const event of events) {
      tick += event.deltaTime;
      if (event.type === 'setTempo') {
        const value = (event as { microsecondsPerBeat?: number }).microsecondsPerBeat;
        if (typeof value === 'number' && value > 0) raw.push({ tick, microsecondsPerBeat: value });
      }
    }
  }
  raw.sort((a, b) => a.tick - b.tick);

  const map: TempoChange[] = [];
  let seconds = 0;
  let previousTick = 0;
  let current = DEFAULT_MICROSECONDS_PER_BEAT;
  for (const change of raw) {
    seconds += ((change.tick - previousTick) / ticksPerBeat) * (current / 1_000_000);
    map.push({ tick: change.tick, microsecondsPerBeat: change.microsecondsPerBeat, seconds });
    previousTick = change.tick;
    current = change.microsecondsPerBeat;
  }
  if (map.length === 0 || (map[0]?.tick ?? 0) > 0) {
    map.unshift({ tick: 0, microsecondsPerBeat: DEFAULT_MICROSECONDS_PER_BEAT, seconds: 0 });
  }
  return map;
}

function tickToSeconds(tick: number, map: readonly TempoChange[], ticksPerBeat: number): number {
  let active = map[0];
  for (const change of map) {
    if (change.tick <= tick) active = change;
    else break;
  }
  if (active === undefined) return (tick / ticksPerBeat) * 0.5;
  return (
    active.seconds + ((tick - active.tick) / ticksPerBeat) * (active.microsecondsPerBeat / 1_000_000)
  );
}

/**
 * Rejilla de pulso exacta, derivada del mapa de tempo.
 *
 * Aqui no se detecta nada: el archivo dice donde cae cada negra. Los tiempos
 * fuertes salen del compas declarado, y si no lo hay se supone 4/4, que es lo
 * que hace cualquier secuenciador ante un archivo sin esa marca.
 */
function buildGrid(
  lastTick: number,
  ticksPerBeat: number,
  toSeconds: (tick: number) => number,
  timeSignature: string | undefined,
): BeatGrid {
  const totalBeats = Math.max(2, Math.ceil(lastTick / ticksPerBeat) + 1);
  const beats: number[] = [];
  for (let i = 0; i <= totalBeats; i += 1) beats.push(toSeconds(i * ticksPerBeat));

  const [numerator, denominator] = (timeSignature ?? '4/4').split('/').map(Number);
  // Cuantas negras mide un compas: en 6/8 son tres, no seis.
  const quartersPerBar = ((numerator ?? 4) * 4) / (denominator ?? 4);
  const step = Math.max(1, Math.round(quartersPerBar));

  const downbeats: number[] = [];
  for (let i = 0; i <= totalBeats; i += step) {
    const at = beats[i];
    if (at !== undefined) downbeats.push(at);
  }

  return createGrid(beats, downbeats);
}
