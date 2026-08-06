import {
  Duration,
  Interval,
  KeySignature,
  parseDurationToken,
  Pitch,
  writtenPitch,
  type Movement,
  type Voice,
} from '@sinfo/core';
import {
  generateCounterpoint,
  generateMelody,
  Motif,
  randomSeed,
  type ContourShape,
} from '@sinfo/generate';
import { Chord, RomanNumeral, Scale, type ScaleType } from '@sinfo/theory';
import { fail } from '../errors.js';

/**
 * Generacion de material tematico.
 *
 * Los motivos viven en la SESION, igual que la partitura: el agente crea un
 * tema, lo desarrolla cinco veces y escribe la tercera variante. Obligarle a
 * reenviar las notas en cada transformacion perderia la genealogia y le haria
 * llevar una contabilidad que hace mal.
 */

export type MotifStore = Map<string, Motif>;

// -------------------------------------------------------------- crear motivo

export interface MotifCreateInput {
  readonly notation: string;
  readonly motifId?: string | undefined;
}

export interface MotifInfo {
  readonly motifId: string;
  readonly notation: string;
  readonly notes: number;
  readonly duration: string;
  readonly range: number;
  readonly derivation: readonly string[];
}

export function motifCreate(
  store: MotifStore,
  input: MotifCreateInput,
): MotifInfo {
  const motif = Motif.parse(input.notation);
  if (motif.length === 0) {
    fail('NOTATION_ERROR', 'El motivo no contiene ningun evento', { notation: input.notation });
  }

  const motifId = input.motifId ?? nextMotifId(store);
  store.set(motifId, motif);
  return describeMotif(motifId, motif);
}

// --------------------------------------------------------- desarrollar motivo

export type TransformationOp =
  | 'transpose'
  | 'invert'
  | 'invertChromatic'
  | 'retrograde'
  | 'augment'
  | 'diminish'
  | 'sequence'
  | 'fragment'
  | 'repeat';

export interface Transformation {
  readonly op: TransformationOp;
  /** Intervalo para transponer o secuenciar: "P5", "-M2", "m3". */
  readonly interval?: string | undefined;
  /** Factor de aumentacion o disminucion, o numero de repeticiones. */
  readonly factor?: number | undefined;
  /** Pasos de una secuencia. */
  readonly steps?: number | undefined;
  /** Primer evento y cantidad, para fragmentar. */
  readonly from?: number | undefined;
  readonly count?: number | undefined;
  /** Eje de inversion. Si falta, la primera nota del motivo. */
  readonly axis?: string | undefined;
}

export interface MotifDevelopInput {
  readonly motifId: string;
  readonly transformations: readonly Transformation[];
  readonly key?: string | undefined;
  readonly scaleType?: string | undefined;
  /** Id del resultado. Si falta, se genera uno nuevo. */
  readonly resultId?: string | undefined;
}

/**
 * Aplica transformaciones en cadena.
 *
 * Cada operacion es una entrada del `switch`, y anadir una nueva es anadir un
 * caso y una entrada al esquema de la herramienta. El motivo original nunca se
 * toca: el resultado es siempre un motivo distinto con su propia genealogia.
 */
export function motifDevelop(
  store: MotifStore,
  movement: Movement,
  input: MotifDevelopInput,
): MotifInfo {
  const source = store.get(input.motifId);
  if (!source) {
    fail('NOT_FOUND', `No hay ningun motivo con id "${input.motifId}"`, {
      motifId: input.motifId,
      available: [...store.keys()],
    });
  }

  const scale = resolveScale(movement, input.key, input.scaleType);
  let motif = source;

  for (const transformation of input.transformations) {
    motif = applyTransformation(motif, transformation, scale);
  }

  const resultId = input.resultId ?? nextMotifId(store);
  store.set(resultId, motif);
  return describeMotif(resultId, motif);
}

function applyTransformation(
  motif: Motif,
  transformation: Transformation,
  scale: Scale,
): Motif {
  const { op } = transformation;

  switch (op) {
    case 'transpose':
      return motif.transposed(requireInterval(transformation, op));

    case 'invert':
      return motif.invertedInScale(scale, parseAxis(transformation.axis));

    case 'invertChromatic':
      return motif.inverted(parseAxis(transformation.axis));

    case 'retrograde':
      return motif.retrograded();

    case 'augment':
      return motif.augmented(transformation.factor ?? 2);

    case 'diminish':
      return motif.diminished(transformation.factor ?? 2);

    case 'sequence':
      return motif.sequence(
        transformation.steps ?? 1,
        requireInterval(transformation, op),
        scale,
      );

    case 'fragment':
      return motif.fragment(transformation.from ?? 0, transformation.count ?? motif.length);

    case 'repeat':
      return motif.repeated(transformation.factor ?? 2);

    default:
      return fail('INVALID_REQUEST', `Transformacion desconocida: "${String(op)}"`, {
        op,
        known: [
          'transpose', 'invert', 'invertChromatic', 'retrograde', 'augment',
          'diminish', 'sequence', 'fragment', 'repeat',
        ],
      });
  }
}

// ----------------------------------------------------------- escribir motivo

export interface MotifWriteInput {
  readonly motifId: string;
  readonly partId: string;
  readonly voiceId?: string | undefined;
  readonly atMeasure?: number | undefined;
  readonly transposeTo?: string | undefined;
}

export function motifWrite(
  store: MotifStore,
  movement: Movement,
  input: MotifWriteInput,
): { partId: string; eventsWritten: number; startMeasure: number } {
  const motif = store.get(input.motifId);
  if (!motif) {
    fail('NOT_FOUND', `No hay ningun motivo con id "${input.motifId}"`, {
      motifId: input.motifId,
      available: [...store.keys()],
    });
  }

  const part = movement.part(input.partId);
  const voice = input.voiceId ? part.ensureVoice(input.voiceId) : part.mainVoice;
  const start = padTo(movement, voice, input.atMeasure);

  const final = input.transposeTo
    ? motif.transposed(Interval.parse(input.transposeTo))
    : motif;
  voice.append(...final.events);

  return {
    partId: part.id,
    eventsWritten: final.length,
    startMeasure: movement.timeline.measureNumberAt(start),
  };
}

// ----------------------------------------------------------- generar melodia

export interface MelodyGenerateInput {
  readonly partId?: string | undefined;
  readonly voiceId?: string | undefined;
  readonly measures?: number | undefined;
  readonly key?: string | undefined;
  readonly scaleType?: string | undefined;
  readonly progression?: readonly string[] | undefined;
  readonly lowest?: string | undefined;
  readonly highest?: string | undefined;
  readonly contour?: string | undefined;
  readonly rhythm?: readonly string[] | undefined;
  readonly restProbability?: number | undefined;
  readonly seed?: string | undefined;
  readonly atMeasure?: number | undefined;
  readonly motifId?: string | undefined;
}

export interface MelodyGenerateResult {
  readonly motifId: string | null;
  readonly seed: string;
  readonly notation: string;
  readonly notes: number;
  readonly writtenTo: string | null;
  readonly startMeasure: number | null;
  readonly chordsUsed: readonly string[];
}

export function melodyGenerate(
  store: MotifStore,
  movement: Movement,
  input: MelodyGenerateInput,
): MelodyGenerateResult {
  const key = resolveKey(movement, input.key);
  const scale = resolveScale(movement, input.key, input.scaleType);
  const measures = input.measures ?? 4;
  const measureDuration = movement.timeline.timeSignatureAt(Duration.ZERO).measureDuration;

  const chords = (input.progression ?? []).map((symbol) =>
    RomanNumeral.parse(symbol, key).realize(key),
  );

  // El rango sale del instrumento si se indica parte: escribir para una flauta
  // notas de contrabajo es un error que el generador puede evitar solo.
  const { lowest, highest } = resolveRange(movement, input);

  const result = generateMelody({
    scale,
    lowest,
    highest,
    totalDuration: measureDuration.times(measures),
    seed: input.seed ?? randomSeed(),
    ...(chords.length > 0
      ? { chords, chordDuration: measureDuration.times(measures).dividedBy(chords.length) }
      : {}),
    ...(input.contour !== undefined ? { contour: input.contour as ContourShape } : {}),
    ...(input.rhythm !== undefined ? { rhythm: input.rhythm } : {}),
    ...(input.restProbability !== undefined ? { restProbability: input.restProbability } : {}),
    beatUnit: movement.timeline.timeSignatureAt(Duration.ZERO).beatUnit,
  });

  const motifId = input.motifId ?? nextMotifId(store);
  store.set(motifId, result.motif);

  let writtenTo: string | null = null;
  let startMeasure: number | null = null;
  if (input.partId !== undefined) {
    const part = movement.part(input.partId);
    const voice = input.voiceId ? part.ensureVoice(input.voiceId) : part.mainVoice;
    const start = padTo(movement, voice, input.atMeasure);
    voice.append(...result.motif.events);
    writtenTo = part.id;
    startMeasure = movement.timeline.measureNumberAt(start);
  }

  return {
    motifId,
    seed: result.seed,
    notation: result.notation,
    notes: result.motif.length,
    writtenTo,
    startMeasure,
    chordsUsed: chords.map((chord) => chord.symbol),
  };
}

// ------------------------------------------------------------- contrapunto

export interface CounterpointInput {
  readonly sourcePartId: string;
  readonly targetPartId: string;
  readonly sourceVoiceId?: string | undefined;
  readonly targetVoiceId?: string | undefined;
  readonly above?: boolean | undefined;
  readonly key?: string | undefined;
  readonly scaleType?: string | undefined;
  readonly lowest?: string | undefined;
  readonly highest?: string | undefined;
  readonly seed?: string | undefined;
  readonly fromMeasure?: number | undefined;
  readonly toMeasure?: number | undefined;
}

export interface CounterpointResultInfo {
  readonly writtenTo: string;
  readonly seed: string;
  readonly notes: number;
  readonly notation: string;
  readonly strict: boolean;
  readonly relaxed: readonly string[];
}

export function counterpointAdd(
  movement: Movement,
  input: CounterpointInput,
): CounterpointResultInfo {
  const source = movement.part(input.sourcePartId);
  const sourceVoice = input.sourceVoiceId
    ? source.voice(input.sourceVoiceId)
    : source.mainVoice;

  if (sourceVoice.isEmpty) {
    fail('INVALID_REQUEST', `La parte "${input.sourcePartId}" no tiene musica que contrapuntar`, {
      sourcePartId: input.sourcePartId,
    });
  }

  const from = movement.timeline.measureStart(input.fromMeasure ?? 1);
  const to = movement.timeline.measureStart(
    (input.toMeasure ?? movement.measureCount) + 1,
  );
  const cantus = sourceVoice.between(from, to).map((entry) => entry.event);

  const target = movement.part(input.targetPartId);
  const { lowest, highest } = resolveRange(movement, {
    partId: input.targetPartId,
    ...(input.lowest !== undefined ? { lowest: input.lowest } : {}),
    ...(input.highest !== undefined ? { highest: input.highest } : {}),
  });

  const result = generateCounterpoint({
    cantus,
    scale: resolveScale(movement, input.key, input.scaleType),
    lowest,
    highest,
    seed: input.seed ?? randomSeed(),
    ...(input.above !== undefined ? { above: input.above } : {}),
  });

  const targetVoice = input.targetVoiceId
    ? target.ensureVoice(input.targetVoiceId)
    : target.mainVoice;
  padTo(movement, targetVoice, input.fromMeasure);
  targetVoice.append(...result.motif.events);

  return {
    writtenTo: target.id,
    seed: result.seed,
    notes: result.notes,
    notation: result.motif.notation,
    strict: result.complete,
    relaxed: result.relaxed,
  };
}

// ----------------------------------------------------------------- internos

function describeMotif(motifId: string, motif: Motif): MotifInfo {
  return {
    motifId,
    notation: motif.notation,
    notes: motif.length,
    duration: motif.duration.toString(),
    range: motif.range,
    derivation: motif.derivation,
  };
}

function nextMotifId(store: MotifStore): string {
  for (let index = 1; index < 10_000; index++) {
    const candidate = `motif-${index}`;
    if (!store.has(candidate)) return candidate;
  }
  return fail('INVALID_REQUEST', 'Demasiados motivos en la sesion', { count: store.size });
}

function requireInterval(transformation: Transformation, op: string): Interval {
  if (transformation.interval === undefined) {
    fail('INVALID_REQUEST', `La transformacion "${op}" necesita un intervalo`, {
      op,
      examples: ['P5', 'M3', '-M2', 'm7'],
    });
  }
  return Interval.parse(transformation.interval);
}

function parseAxis(axis: string | undefined): Pitch | undefined {
  return axis === undefined ? undefined : Pitch.parse(axis);
}

function resolveKey(movement: Movement, key: string | undefined): KeySignature {
  return key !== undefined ? KeySignature.parse(key) : movement.timeline.keyAt(Duration.ZERO);
}

/**
 * Escala a usar.
 *
 * Por defecto la de la partitura, no una fijada a mano: el agente que repite
 * la tonalidad en cada llamada acaba escribiendo una distinta de la que hay
 * escrita, y la melodia sale en otra tonalidad sin que nadie lo note.
 */
function resolveScale(
  movement: Movement,
  key: string | undefined,
  scaleType: string | undefined,
): Scale {
  const signature = resolveKey(movement, key);
  if (scaleType !== undefined) return Scale.of(signature.tonic, scaleType as ScaleType);
  // En menor se usa la armonica: es la que trae la sensible.
  return signature.isMinorLike
    ? Scale.of(signature.tonic, 'harmonicMinor')
    : Scale.fromKey(signature);
}

function resolveRange(
  movement: Movement,
  input: { partId?: string | undefined; lowest?: string | undefined; highest?: string | undefined },
): { lowest: Pitch; highest: Pitch } {
  if (input.lowest !== undefined && input.highest !== undefined) {
    return { lowest: Pitch.parse(input.lowest), highest: Pitch.parse(input.highest) };
  }

  if (input.partId !== undefined && movement.hasPart(input.partId)) {
    const { instrument } = movement.part(input.partId);
    // La tesitura esta en alturas SONANTES, pero lo que se genera se escribe
    // en la parte, y una parte lleva alturas ESCRITAS. Sin convertir, un
    // contrabajo recibiria su tesitura sonante como notas escritas y sonaria
    // una octava mas grave, fuera de rango. Lo mismo con clarinete, trompa y
    // trompeta.
    return {
      lowest:
        input.lowest !== undefined
          ? Pitch.parse(input.lowest)
          : writtenPitch(instrument, instrument.tessitura.lowest),
      highest:
        input.highest !== undefined
          ? Pitch.parse(input.highest)
          : writtenPitch(instrument, instrument.tessitura.highest),
    };
  }

  return {
    lowest: input.lowest !== undefined ? Pitch.parse(input.lowest) : Pitch.parse('C4'),
    highest: input.highest !== undefined ? Pitch.parse(input.highest) : Pitch.parse('C6'),
  };
}

/** Rellena con silencios hasta el compas pedido y devuelve donde empieza. */
function padTo(movement: Movement, voice: Voice, atMeasure: number | undefined): Duration {
  if (atMeasure === undefined) return voice.duration;
  const start = movement.timeline.measureStart(atMeasure);
  voice.padTo(start);
  return start;
}

export { Chord };
