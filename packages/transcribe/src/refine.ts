import { classifyPitch, getInstrument, Pitch } from '@sinfo/core';
import type { RawNote } from '@sinfo/perform';

/**
 * Depuracion de lo que devuelve un transcriptor, con criterio musical.
 *
 * Aqui esta la ventaja concreta de este proyecto frente a un transcriptor
 * generico. Un modelo de audio entrega alturas y nada mas: no sabe que un
 * contrabajo no llega a do7, ni que una nota que aparece exactamente una
 * octava sobre otra mas grave y mas fuerte suele ser su armonico y no una
 * nota que alguien toco. Nosotros tenemos catalogo de instrumentos y teoria,
 * asi que podemos corregir al modelo con informacion que el no tiene.
 *
 * Todo lo que se descarta se cuenta y se explica. Un filtro que se come notas
 * en silencio es peor que no filtrar: quien transcribe necesita poder decidir
 * si el filtro se paso de listo.
 */

/**
 * Distancia en semitonos de los armonicos sobre la fundamental.
 *
 * Son los que caen cerca de una nota temperada y por tanto los que un modelo
 * puede confundir con una nota real: octava, doceava, quincena, decimoseptima
 * y decimonovena. El septimo armonico se deja fuera a proposito porque cae a
 * un tercio de semitono de la nota mas cercana y ningun detector lo redondea
 * de forma fiable.
 */
const PARTIALS = [12, 19, 24, 28, 31, 36] as const;

/** Margen al emparejar un intervalo con un armonico, en semitonos. */
const PARTIAL_TOLERANCE = 0.35;

export interface RefineOptions {
  /** Instrumento declarado, por id del catalogo. Habilita el filtro de rango. */
  readonly instrumentId?: string | undefined;
  /** Descartar armonicos falsos. Activado por defecto. */
  readonly dropHarmonics?: boolean | undefined;
  /**
   * Cuanto mas debil tiene que ser un candidato para darlo por armonico.
   * 0.85 significa que solo cae si no llega al 85% de la intensidad de su
   * supuesta fundamental. Subirlo filtra mas y se come octavas reales.
   */
  readonly harmonicRatio?: number | undefined;
  /** Ventana para considerar dos ataques simultaneos, en segundos. */
  readonly onsetWindow?: number | undefined;
  /** Notas por debajo de esta confianza se descartan. */
  readonly minConfidence?: number | undefined;
  /**
   * Fundir en una sola las notas de la misma altura que se pisan.
   *
   * Los modelos de transcripcion parten a veces una nota tenida en dos o tres
   * trozos cuando la intensidad flaquea a mitad. Sin fundirlos, la partitura
   * sale con la misma nota repicada donde habia una sola.
   */
  readonly mergeDuplicates?: boolean | undefined;
  /** Hueco maximo entre dos trozos de la misma altura para fundirlos. */
  readonly mergeGap?: number | undefined;
}

export interface RefineReport {
  readonly mergedDuplicates: number;
  readonly droppedHarmonics: number;
  readonly octaveCorrected: number;
  readonly droppedOutOfRange: number;
  readonly droppedLowConfidence: number;
  /** Explicaciones legibles, para que nada desaparezca sin dejar rastro. */
  readonly notes: readonly string[];
}

export interface RefineResult {
  readonly notes: readonly RawNote[];
  readonly report: RefineReport;
}

const DEFAULTS = {
  harmonicRatio: 0.85,
  onsetWindow: 0.06,
  minConfidence: 0,
  mergeGap: 0.05,
} as const;

export function refineNotes(
  notes: readonly RawNote[],
  options: RefineOptions = {},
): RefineResult {
  const harmonicRatio = options.harmonicRatio ?? DEFAULTS.harmonicRatio;
  const onsetWindow = options.onsetWindow ?? DEFAULTS.onsetWindow;
  const minConfidence = options.minConfidence ?? DEFAULTS.minConfidence;
  const explanations: string[] = [];

  let working = [...notes].sort((a, b) => a.onset - b.onset || a.midi - b.midi);

  // ---- 1. Confianza. Lo primero, para no gastar analisis en ruido.
  let droppedLowConfidence = 0;
  if (minConfidence > 0) {
    const before = working.length;
    working = working.filter((note) => note.confidence >= minConfidence);
    droppedLowConfidence = before - working.length;
    if (droppedLowConfidence > 0) {
      explanations.push(
        `${droppedLowConfidence} notas descartadas por confianza inferior a ${minConfidence}.`,
      );
    }
  }

  // ---- 1b. Trozos de la misma nota. Antes de los armonicos, porque un
  // duplicado falsea la comparacion de intensidades que usa aquel filtro.
  let mergedDuplicates = 0;
  if (options.mergeDuplicates !== false) {
    const merged = mergeSamePitch(working, options.mergeGap ?? DEFAULTS.mergeGap);
    mergedDuplicates = working.length - merged.length;
    working = merged;
    if (mergedDuplicates > 0) {
      explanations.push(
        `${mergedDuplicates} notas fundidas con otra de la misma altura que se solapaba: el ` +
          'modelo habia partido una nota tenida en varios trozos.',
      );
    }
  }

  // ---- 2. Armonicos falsos.
  let droppedHarmonics = 0;
  if (options.dropHarmonics !== false) {
    const survivors = dropHarmonics(working, harmonicRatio, onsetWindow);
    droppedHarmonics = working.length - survivors.length;
    working = survivors;
    if (droppedHarmonics > 0) {
      explanations.push(
        `${droppedHarmonics} notas descartadas por ser armonicos de otra nota simultanea mas ` +
          'grave y mas fuerte. Si la obra tiene octavas reales dobladas, desactiva dropHarmonics.',
      );
    }
  }

  // ---- 3. Rango del instrumento declarado.
  let octaveCorrected = 0;
  let droppedOutOfRange = 0;
  const instrument = options.instrumentId ? getInstrument(options.instrumentId) : undefined;
  if (instrument) {
    const adjusted: RawNote[] = [];
    for (const note of working) {
      const fixed = fitToRange(note, instrument);
      if (fixed === null) {
        droppedOutOfRange += 1;
        continue;
      }
      if (fixed.midi !== note.midi) octaveCorrected += 1;
      adjusted.push(fixed);
    }
    working = adjusted;

    if (octaveCorrected > 0) {
      explanations.push(
        `${octaveCorrected} notas desplazadas de octava para caber en el registro de ` +
          `${instrument.name}. Los errores de octava son el fallo mas comun de cualquier ` +
          'transcriptor y el rango del instrumento los delata.',
      );
    }
    if (droppedOutOfRange > 0) {
      explanations.push(
        `${droppedOutOfRange} notas descartadas por quedar fuera del registro de ` +
          `${instrument.name} incluso tras probar otras octavas.`,
      );
    }
  }

  return {
    notes: working,
    report: {
      mergedDuplicates,
      droppedHarmonics,
      octaveCorrected,
      droppedOutOfRange,
      droppedLowConfidence,
      notes: explanations,
    },
  };
}

// --------------------------------------------------------------- interiores

/**
 * Funde los trozos consecutivos de una misma nota.
 *
 * Se compara la altura REDONDEADA: dos trozos de la misma nota pueden diferir
 * en unas centesimas de semitono porque el detector afina cada uno por su
 * cuenta, y exigir igualdad exacta no fundiria nunca nada.
 */
function mergeSamePitch(notes: readonly RawNote[], gap: number): RawNote[] {
  const byPitch = new Map<number, RawNote[]>();
  for (const note of notes) {
    const key = Math.round(note.midi);
    const bucket = byPitch.get(key);
    if (bucket === undefined) byPitch.set(key, [note]);
    else bucket.push(note);
  }

  const merged: RawNote[] = [];
  for (const bucket of byPitch.values()) {
    bucket.sort((a, b) => a.onset - b.onset);
    let current: RawNote | undefined;

    for (const note of bucket) {
      if (current === undefined) {
        current = note;
        continue;
      }
      if (note.onset <= current.offset + gap) {
        current = {
          ...current,
          offset: Math.max(current.offset, note.offset),
          velocity: Math.max(current.velocity, note.velocity),
          confidence: Math.max(current.confidence, note.confidence),
        };
      } else {
        merged.push(current);
        current = note;
      }
    }
    if (current !== undefined) merged.push(current);
  }

  return merged.sort((a, b) => a.onset - b.onset || a.midi - b.midi);
}

/**
 * Descarta las notas que parecen armonicos de otra simultanea.
 *
 * Los tres requisitos son deliberadamente exigentes, porque las octavas
 * reales existen y perderlas seria mucho peor que dejar pasar un armonico:
 * tiene que entrar a la vez que la supuesta fundamental, estar a una distancia
 * de armonico, y sonar mas floja que ella. Un piano que dobla la melodia en
 * octavas toca las dos notas con fuerza parecida y sobrevive al filtro.
 */
function dropHarmonics(
  notes: readonly RawNote[],
  ratio: number,
  window: number,
): RawNote[] {
  const suspicious = new Set<number>();

  for (let i = 0; i < notes.length; i += 1) {
    const candidate = notes[i];
    if (candidate === undefined) continue;

    for (let j = 0; j < notes.length; j += 1) {
      if (i === j) continue;
      const fundamental = notes[j];
      if (fundamental === undefined || suspicious.has(j)) continue;

      const interval = candidate.midi - fundamental.midi;
      if (interval <= 0) continue;
      if (Math.abs(candidate.onset - fundamental.onset) > window) continue;
      if (candidate.velocity >= fundamental.velocity * ratio) continue;
      if (!PARTIALS.some((partial) => Math.abs(interval - partial) <= PARTIAL_TOLERANCE)) continue;

      suspicious.add(i);
      break;
    }
  }

  return notes.filter((_, index) => !suspicious.has(index));
}

/**
 * Acerca una nota al registro del instrumento saltando octavas.
 *
 * Se prueban desplazamientos de una y dos octavas en ambos sentidos. Si
 * ninguno la mete dentro, la nota no es de este instrumento y se descarta:
 * arrastrarla produciria una parte que nadie puede tocar.
 */
function fitToRange(
  note: RawNote,
  instrument: NonNullable<ReturnType<typeof getInstrument>>,
): RawNote | null {
  const verdict = (midi: number): string =>
    classifyPitch(instrument, Pitch.fromMidi(Math.round(midi)));

  if (verdict(note.midi) !== 'below-range' && verdict(note.midi) !== 'above-range') {
    return note;
  }

  for (const shift of [12, -12, 24, -24]) {
    const moved = note.midi + shift;
    if (moved < 0 || moved > 127) continue;
    const classification = verdict(moved);
    if (classification !== 'below-range' && classification !== 'above-range') {
      return { ...note, midi: moved };
    }
  }
  return null;
}
