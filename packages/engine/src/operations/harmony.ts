import {
  chord as chordEvent,
  Duration,
  KeySignature,
  parseDurationToken,
  type Movement,
  type Pitch,
  type Voice,
} from '@sinfo/core';
import {
  analyzeChord,
  checkVoiceLeading,
  classifyCadence,
  RomanNumeral,
  sonorityAt,
  summarizeIssues,
  type LabeledVoice,
} from '@sinfo/theory';
import { fail } from '../errors.js';

/**
 * Operaciones de armonia.
 *
 * Las tres cierran el bucle que hace posible componer con criterio: generar
 * una progresion, leer que funcion cumple lo escrito, y comprobar como se
 * mueven las voces entre acordes.
 */

// -------------------------------------------------------------- progresion

export interface HarmonyProgressionInput {
  readonly progression: readonly string[];
  readonly key?: string | undefined;
  /** Parte donde escribir los acordes. Si falta, solo se devuelven. */
  readonly partId?: string | undefined;
  readonly voiceId?: string | undefined;
  /** Figura de cada acorde. Por defecto, redonda. */
  readonly duration?: string | undefined;
  readonly bassOctave?: number | undefined;
  readonly atMeasure?: number | undefined;
}

export interface RealizedChord {
  readonly roman: string;
  readonly symbol: string;
  readonly fn: string;
  readonly pitches: readonly string[];
}

export interface HarmonyProgressionResult {
  readonly key: string;
  readonly chords: readonly RealizedChord[];
  readonly cadence: { type: string; description: string } | null;
  readonly writtenTo: string | null;
}

/**
 * Convierte una serie de numeros romanos en acordes reales.
 *
 * Se acepta la tonalidad como argumento, pero por defecto se toma la de la
 * partitura: pedirle al agente que la repita en cada llamada es una fuente de
 * incoherencias, porque puede escribir una distinta de la que hay escrita.
 */
export function harmonyProgression(
  movement: Movement,
  input: HarmonyProgressionInput,
): HarmonyProgressionResult {
  if (input.progression.length === 0) {
    fail('INVALID_REQUEST', 'La progresion no puede estar vacia', {});
  }

  const key =
    input.key !== undefined
      ? KeySignature.parse(input.key)
      : movement.timeline.keyAt(Duration.ZERO);

  const numerals = input.progression.map((symbol) => RomanNumeral.parse(symbol, key));
  const chords = numerals.map((roman) => {
    const realized = roman.realize(key);
    return {
      roman: roman.symbol,
      symbol: realized.symbol,
      fn: roman.fn,
      pitches: realized.voicing(input.bassOctave ?? 3).map((pitch) => pitch.name),
      voiced: realized.voicing(input.bassOctave ?? 3),
    };
  });

  const cadence =
    numerals.length >= 2
      ? classifyCadence(numerals[numerals.length - 2]!, numerals[numerals.length - 1]!)
      : null;

  let writtenTo: string | null = null;
  if (input.partId !== undefined) {
    const part = movement.part(input.partId);
    const voice = input.voiceId ? part.ensureVoice(input.voiceId) : part.mainVoice;
    const duration = parseDurationToken(input.duration ?? 'w');

    if (input.atMeasure !== undefined) {
      voice.padTo(movement.timeline.measureStart(input.atMeasure));
    }
    for (const item of chords) {
      voice.append(chordEvent(item.voiced, duration));
    }
    writtenTo = part.id;
  }

  return {
    key: key.name,
    chords: chords.map(({ roman, symbol, fn, pitches }) => ({ roman, symbol, fn, pitches })),
    cadence: cadence && cadence.type !== 'ninguna' ? cadence : null,
    writtenTo,
  };
}

// ----------------------------------------------------------------- analisis

export interface AnalyzeHarmonyInput {
  readonly partIds?: readonly string[] | undefined;
  readonly fromMeasure?: number | undefined;
  readonly toMeasure?: number | undefined;
}

export interface AnalyzedChord {
  readonly measure: number;
  readonly roman: string;
  readonly symbol: string;
  readonly fn: string;
  readonly isDiatonic: boolean;
}

export interface AnalyzeHarmonyResult {
  readonly key: string;
  readonly chords: readonly AnalyzedChord[];
  readonly cadences: readonly { measure: number; type: string; description: string }[];
  readonly summary: {
    readonly analyzed: number;
    readonly diatonic: number;
    readonly borrowed: number;
    readonly unrecognized: number;
  };
}

/** Tope de acordes por analisis: mas no cabe util en el contexto del modelo. */
const MAX_ANALYZED = 96;

/**
 * Analiza que armonia hay escrita.
 *
 * Se agrupan TODAS las partes seleccionadas en cada instante y se identifica
 * el acorde resultante. Analizar parte por parte no serviria: la armonia es lo
 * que suena entre todas a la vez, y una sola voz no la contiene.
 */
export function analyzeHarmony(
  movement: Movement,
  input: AnalyzeHarmonyInput = {},
): AnalyzeHarmonyResult {
  const voices = collectVoices(movement, input.partIds);
  if (voices.length === 0) {
    fail('INVALID_REQUEST', 'No hay partes con musica que analizar', {
      available: [...movement.partIds],
    });
  }

  const { from, to } = measureBounds(movement, input.fromMeasure, input.toMeasure);
  const onsets = distinctOnsets(voices, from, to).slice(0, MAX_ANALYZED);

  const chords: AnalyzedChord[] = [];
  const numerals: { measure: number; roman: RomanNumeral }[] = [];
  let unrecognized = 0;

  for (const position of onsets) {
    const pitches = sonorityAt(voices, position);
    const key = movement.timeline.keyAt(position);
    const analysis = analyzeChord(pitches, key);

    if (!analysis) {
      // Dos notas sueltas o una disonancia de paso no son un acorde. Se cuenta
      // y se sigue: no todo instante de una obra tiene armonia propia.
      if (pitches.length >= 3) unrecognized++;
      continue;
    }

    const measure = movement.timeline.measureNumberAt(position);
    chords.push({
      measure,
      roman: analysis.roman.symbol,
      symbol: analysis.chord.symbol,
      fn: analysis.fn,
      isDiatonic: analysis.isDiatonic,
    });
    numerals.push({ measure, roman: analysis.roman });
  }

  return {
    key: movement.timeline.keyAt(from).name,
    chords,
    cadences: findCadences(numerals),
    summary: {
      analyzed: chords.length,
      diatonic: chords.filter((item) => item.isDiatonic).length,
      borrowed: chords.filter((item) => !item.isDiatonic).length,
      unrecognized,
    },
  };
}

function findCadences(
  numerals: readonly { measure: number; roman: RomanNumeral }[],
): { measure: number; type: string; description: string }[] {
  const results: { measure: number; type: string; description: string }[] = [];

  for (let index = 1; index < numerals.length; index++) {
    const result = classifyCadence(numerals[index - 1]!.roman, numerals[index]!.roman);
    if (result.type === 'ninguna') continue;
    results.push({
      measure: numerals[index]!.measure,
      type: result.type,
      description: result.description,
    });
  }
  return results;
}

// -------------------------------------------------------- conduccion de voces

export interface CheckVoiceLeadingInput {
  readonly partIds?: readonly string[] | undefined;
  readonly fromMeasure?: number | undefined;
  readonly toMeasure?: number | undefined;
  readonly maxSpacing?: number | undefined;
  readonly maxLeap?: number | undefined;
}

export interface CheckVoiceLeadingResult {
  readonly voices: readonly string[];
  readonly errors: number;
  readonly warnings: number;
  readonly byRule: Readonly<Record<string, number>>;
  readonly issues: readonly {
    rule: string;
    severity: string;
    measure: number;
    voices: readonly string[];
    message: string;
  }[];
  readonly truncated: boolean;
}

/** Tope de problemas reportados: con dos docenas el agente ya sabe que hacer. */
const MAX_ISSUES = 30;

export function checkVoiceLeadingIn(
  movement: Movement,
  input: CheckVoiceLeadingInput = {},
): CheckVoiceLeadingResult {
  const voices = collectVoices(movement, input.partIds);
  if (voices.length < 2) {
    fail('INVALID_REQUEST', 'Hacen falta al menos dos voces para analizar su conduccion', {
      found: voices.length,
      available: [...movement.partIds],
    });
  }

  const { from, to } = measureBounds(movement, input.fromMeasure, input.toMeasure);
  const issues = checkVoiceLeading(voices, {
    ...(input.maxSpacing !== undefined ? { maxSpacing: input.maxSpacing } : {}),
    ...(input.maxLeap !== undefined ? { maxLeap: input.maxLeap } : {}),
  }).filter((issue) => !issue.position.lessThan(from) && issue.position.lessThan(to));

  const summary = summarizeIssues(issues);
  return {
    voices: voices.map((entry) => entry.label),
    errors: summary.errors,
    warnings: summary.warnings,
    byRule: summary.byRule,
    issues: issues.slice(0, MAX_ISSUES).map((issue) => ({
      rule: issue.rule,
      severity: issue.severity,
      measure: movement.timeline.measureNumberAt(issue.position),
      voices: issue.voices,
      message: issue.message,
    })),
    truncated: issues.length > MAX_ISSUES,
  };
}

// ----------------------------------------------------------------- internos

/**
 * Recoge las voces a analizar, ordenadas de GRAVE a AGUDO.
 *
 * El orden no es cosmetico: cruce, solapamiento y espaciado solo significan
 * algo si se sabe cual deberia estar debajo de cual. Se ordena por la altura
 * mediana de cada voz, que funciona tanto si el agente anadio las partes en
 * orden de partitura como si las metio en cualquier otro.
 */
function collectVoices(
  movement: Movement,
  partIds: readonly string[] | undefined,
): LabeledVoice[] {
  const parts = partIds ? partIds.map((id) => movement.part(id)) : movement.parts;

  const entries: { labeled: LabeledVoice; median: number }[] = [];
  for (const part of parts) {
    if (part.instrument.isPercussion) continue;
    for (const voice of part.voices) {
      if (voice.isEmpty) continue;
      const label = part.voiceIds.length > 1 ? `${part.id}.${voice.id}` : part.id;
      entries.push({ labeled: { label, voice }, median: medianPitch(voice) });
    }
  }

  return entries.sort((a, b) => a.median - b.median).map((entry) => entry.labeled);
}

function medianPitch(voice: Voice): number {
  const midis: number[] = [];
  for (const event of voice.events) {
    for (const pitch of event.pitches) midis.push(pitch.midi);
  }
  if (midis.length === 0) return 0;
  midis.sort((a, b) => a - b);
  return midis[Math.floor(midis.length / 2)]!;
}

function measureBounds(
  movement: Movement,
  fromMeasure: number | undefined,
  toMeasure: number | undefined,
): { from: Duration; to: Duration } {
  const first = fromMeasure ?? 1;
  const last = toMeasure ?? movement.measureCount;
  if (last < first) {
    fail('INVALID_REQUEST', 'toMeasure no puede ser menor que fromMeasure', {
      fromMeasure: first,
      toMeasure: last,
    });
  }
  return {
    from: movement.timeline.measureStart(first),
    to: movement.timeline.measureStart(last + 1),
  };
}

/** Instantes distintos en que ataca alguna voz, dentro del rango pedido. */
function distinctOnsets(
  voices: readonly LabeledVoice[],
  from: Duration,
  to: Duration,
): Duration[] {
  const seen = new Map<string, Duration>();
  for (const { voice } of voices) {
    for (const { position } of voice.positioned()) {
      if (position.lessThan(from) || !position.lessThan(to)) continue;
      seen.set(position.toString(), position);
    }
  }
  return [...seen.values()].sort((a, b) => a.compare(b));
}

export type { Pitch };
