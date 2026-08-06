import {
  Duration,
  INSTRUMENT_SPECS,
  KeySignature,
  type MusicalEvent,
  Pitch,
  Score,
  Tempo,
  TimeSignature,
  chord,
  getInstrument,
  note,
  restsBetween,
} from '@sinfo/core';
import {
  type Performance,
  type PerformanceTrack,
  averageTempo,
  beatsPerBar,
  gridFromTempo,
  performanceDuration,
} from '@sinfo/perform';
import { type KeyEstimate, type WeightedPitch, estimateKey } from './key-estimate.js';
import { type QuantizeOptions, type QuantizedNote, quantize } from './quantize.js';
import { spellPitch } from './spell.js';
import { type NoteGroup, type SeparateOptions, separateVoices } from './voices.js';

/**
 * Ensamblaje final: de interpretacion a partitura.
 *
 * Aqui se juntan las tres piezas —cuantizar, escribir las alteraciones,
 * separar voces— y se vuelca el resultado en el modelo de `@sinfo/core`.
 *
 * Lo que NO hay que hacer aqui es notacion. Partir las notas en las barras de
 * compas, encadenar las ligaduras de prolongacion y elegir figuras escribibles
 * ya lo hace `splitIntoMeasures` al exportar, y esta probado. Duplicarlo seria
 * el camino directo a dos comportamientos que se contradicen.
 */

export interface ToScoreOptions {
  readonly scoreId?: string | undefined;
  readonly title?: string | undefined;
  readonly composer?: string | undefined;
  /** Tonalidad impuesta. Si falta se estima de las notas. */
  readonly key?: KeySignature | undefined;
  /** Compas impuesto. Si falta se deduce de los tiempos fuertes. */
  readonly timeSignature?: TimeSignature | undefined;
  /** Instrumento para las pistas que no declaran ninguno. */
  readonly defaultInstrument?: string | undefined;
  readonly quantize?: QuantizeOptions | undefined;
  readonly separate?: SeparateOptions | undefined;
}

export interface TrackReport {
  readonly partId: string;
  readonly instrument: string;
  readonly voices: number;
  readonly notes: number;
  /** Desviacion media respecto al pulso, en fraccion de pulso. */
  readonly meanDeviation: number;
}

export interface ToScoreResult {
  readonly score: Score;
  readonly key: KeyEstimate;
  readonly timeSignature: TimeSignature;
  readonly tempo: number;
  readonly tracks: readonly TrackReport[];
  /**
   * Lo que conviene mirar antes de fiarse del resultado. Se devuelven en vez
   * de registrarse por ahi: quien transcribe necesita saber que decisiones se
   * tomaron por el.
   */
  readonly warnings: readonly string[];
}

export function performanceToScore(
  performance: Performance,
  options: ToScoreOptions = {},
): ToScoreResult {
  const warnings: string[] = [];

  // ---- Rejilla. Sin ella no hay contra que medir.
  let grid = performance.grid;
  if (grid === undefined) {
    grid = gridFromTempo(120, Math.max(performanceDuration(performance), 1));
    warnings.push(
      'La interpretacion no traia rejilla de pulso: se ha supuesto un tempo constante de 120. ' +
        'Si venia de una ejecucion humana, el ritmo saldra desplazado.',
    );
  }

  // ---- Cuantizar cada pista por separado.
  const quantized = performance.tracks.map((track) => ({
    track,
    result: quantize(track.notes, grid, options.quantize),
  }));

  // ---- Tonalidad: se estima con TODAS las pistas juntas.
  //
  // Una linea de bajo sola no dice casi nada sobre la tonalidad, y una voz
  // interior menos. Juntar el material es lo que da un perfil de clases de
  // altura con sentido.
  const weighted: WeightedPitch[] = [];
  for (const { track, result } of quantized) {
    if (track.isPercussion === true) continue;
    for (const item of result.notes) {
      weighted.push({ midi: item.midi, weight: item.duration.quarters });
    }
  }
  const estimated = estimateKey(weighted);
  const key = options.key ?? estimated.key;
  if (options.key === undefined && estimated.correlation < 0.5 && weighted.length > 0) {
    warnings.push(
      `La tonalidad estimada (${estimated.key.name}) tiene poca correlacion ` +
        `(${estimated.correlation.toFixed(2)}): musica muy cromatica o pocas notas. ` +
        'Las alteraciones pueden salir escritas al reves.',
    );
  }

  // ---- Compas y tempo.
  const perBar = beatsPerBar(grid);
  const declared =
    performance.timeSignatureHint === undefined
      ? undefined
      : TimeSignature.parse(performance.timeSignatureHint);
  const timeSignature = options.timeSignature ?? declared ?? TimeSignature.of(perBar ?? 4, 4);
  if (options.timeSignature === undefined && declared === undefined && perBar === null) {
    warnings.push(
      'No habia tiempos fuertes suficientes para deducir el compas: se ha supuesto 4/4.',
    );
  }
  const tempo = averageTempo(grid);

  // ---- Anacrusa: el modelo no tiene compas de entrada, asi que se desplaza.
  let offset = Duration.ZERO;
  for (const { result } of quantized) {
    for (const item of result.notes) {
      if (item.position.lessThan(offset)) offset = item.position;
    }
  }
  if (!offset.isZero) {
    warnings.push(
      `Habia ${offset.negated().toString()} de redonda antes del primer tiempo fuerte (anacrusa). ` +
        'Se ha desplazado la obra para que empiece en el compas 1, porque el modelo no ' +
        'representa compases de entrada incompletos.',
    );
  }

  // ---- Montar la partitura.
  const score = new Score(options.scoreId ?? 'transcribed', {
    title: options.title ?? performance.source?.name ?? 'Transcripcion',
    ...(options.composer !== undefined ? { composer: options.composer } : {}),
  });
  const movement = score.first;
  const { timeline } = movement;
  const start = timeline.timeSignatureChanges[0]?.at ?? Duration.ZERO;
  timeline.setTimeSignature(start, timeSignature);
  timeline.setTempo(start, Tempo.of(clampTempo(tempo)));
  timeline.setKey(start, key);

  const tracks: TrackReport[] = [];
  const used = new Set<string>();

  for (const { track, result } of quantized) {
    const instrumentId = resolveInstrument(track, options.defaultInstrument);
    const instrument = getInstrument(instrumentId);
    if (!instrument) continue;

    const partId = uniqueId(track.id || instrumentId, used);
    const part = movement.addPart(partId, instrument, track.name);

    const shifted = offset.isZero
      ? result.notes
      : result.notes.map((item) => ({ ...item, position: item.position.minus(offset) }));

    const voices = separateVoices(shifted, options.separate);
    voices.forEach((groups, index) => {
      const voice = part.ensureVoice(index === 0 ? 'v1' : `v${index + 1}`);
      fillVoice(voice, groups, timeline, key, track.isPercussion === true);
    });

    tracks.push({
      partId,
      instrument: instrumentId,
      voices: voices.length,
      notes: result.notes.length,
      meanDeviation: result.meanDeviation,
    });

    if (result.meanDeviation > 0.1) {
      warnings.push(
        `La pista "${partId}" se desvia de media ${result.meanDeviation.toFixed(3)} de pulso. ` +
          'Suele indicar que la rejilla de pulso esta mal, no el cuantizador.',
      );
    }
  }

  return { score, key: estimated, timeSignature, tempo, tracks, warnings };
}

// --------------------------------------------------------------- interiores

/** Interfaz minima de `Voice` que hace falta aqui, para no importar la clase. */
interface VoiceLike {
  append(...events: MusicalEvent[]): unknown;
}

/**
 * Vuelca una voz rellenando los huecos con silencios.
 *
 * `Voice` es una sucesion sin huecos: cada silencio tiene que estar escrito.
 * `restsBetween` los parte por las barras de compas, como haria un copista, en
 * vez de dejar un silencio largo a caballo entre dos compases.
 */
function fillVoice(
  voice: VoiceLike,
  groups: readonly NoteGroup[],
  timeline: Parameters<typeof restsBetween>[0],
  key: KeySignature,
  isPercussion: boolean,
): void {
  let cursor = Duration.ZERO;

  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    if (group === undefined) continue;

    if (group.position.greaterThan(cursor)) {
      for (const silence of restsBetween(timeline, cursor, group.position)) voice.append(silence);
    }

    // La direccion melodica desempata las alteraciones cromaticas, asi que se
    // mira la nota siguiente de ESTA voz, que es la que continua la linea.
    const next = groups[i + 1]?.midis.at(-1);
    const top = group.midis.at(-1) ?? 0;
    const direction = next === undefined || next === top ? 0 : next > top ? 1 : -1;

    const pitches = group.midis.map((midi) =>
      isPercussion ? Pitch.fromMidi(midi) : spellPitch(midi, key, direction),
    );

    voice.append(
      pitches.length === 1 && pitches[0] !== undefined
        ? note(pitches[0], group.duration, { velocity: group.velocity })
        : chord(pitches, group.duration, { velocity: group.velocity }),
    );
    cursor = group.position.plus(group.duration);
  }
}

/**
 * Programa General MIDI a instrumento del catalogo.
 *
 * El catalogo solo tiene la direccion contraria —cada instrumento declara su
 * programa—, asi que el indice inverso se construye una vez. Gana el primero
 * declarado: varios instrumentos comparten programa (flauta y flauta en sol
 * son ambos el 73) y el catalogo los lista de mas comun a mas raro.
 */
const PROGRAM_TO_INSTRUMENT: ReadonlyMap<number, string> = (() => {
  const map = new Map<number, string>();
  for (const [id, spec] of Object.entries(INSTRUMENT_SPECS)) {
    if (spec.isPercussion === true) continue;
    if (!map.has(spec.midiProgram)) map.set(spec.midiProgram, id);
  }
  return map;
})();

function resolveInstrument(track: PerformanceTrack, fallback: string | undefined): string {
  if (track.instrumentId !== undefined && getInstrument(track.instrumentId)) {
    return track.instrumentId;
  }
  if (track.isPercussion === true) return findPercussion() ?? fallback ?? 'piano';
  if (track.midiProgram !== undefined) {
    const mapped = PROGRAM_TO_INSTRUMENT.get(track.midiProgram);
    if (mapped !== undefined) return mapped;
  }
  return fallback ?? 'piano';
}

function findPercussion(): string | undefined {
  for (const [id, spec] of Object.entries(INSTRUMENT_SPECS)) {
    if (spec.isPercussion === true) return id;
  }
  return undefined;
}

function uniqueId(base: string, used: Set<string>): string {
  const clean = base.replace(/[^\w-]+/g, '_') || 'part';
  if (!used.has(clean)) {
    used.add(clean);
    return clean;
  }
  for (let n = 2; ; n += 1) {
    const candidate = `${clean}${n}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

/** `Tempo.of` rechaza fuera de 0..800; una rejilla rara no debe tumbar la obra. */
function clampTempo(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120;
  return Math.min(800, Math.max(1, Math.round(bpm * 100) / 100));
}
