import { invalid } from '@sinfo/core';
import type { BeatGrid } from './grid.js';

/**
 * Una nota tal y como la ve un transcriptor, ANTES de ser musica escrita.
 *
 * La diferencia con `MusicalEvent` es toda la fase: aqui el tiempo son
 * segundos en coma flotante y la altura puede caer entre teclas. Un
 * `MusicalEvent` no puede representar esto, y no debe: mezclar tiempo medido
 * con tiempo notado es justo el error que produce partituras ilegibles.
 *
 * Por eso existe este paquete. Es la frontera donde termina lo estadistico y
 * empieza lo exacto.
 */
export interface RawNote {
  /** Ataque en segundos desde el inicio de la grabacion. */
  readonly onset: number;
  /** Extincion en segundos. Siempre mayor que `onset`. */
  readonly offset: number;
  /**
   * Altura en numero MIDI, posiblemente FRACCIONARIA: 60.3 es un do central
   * un poco alto. Los detectores de tono dan f0 continua y una voz o un
   * traste doblado no caen en la rejilla temperada. Redondear aqui perderia
   * informacion que el corrector de octavas y el afinador saben aprovechar.
   */
  readonly midi: number;
  /** Intensidad 0..127, convencion MIDI. */
  readonly velocity: number;
  /**
   * Cuanto se fia el modelo de esta nota, 0..1. Se propaga hasta la partitura
   * para que el agente sepa que compases conviene revisar en vez de tratar
   * todo el resultado como igual de firme.
   */
  readonly confidence: number;
}

/** De donde salio una interpretacion. Importa para poder reproducirla. */
export interface PerformanceSource {
  readonly kind: 'midi' | 'audio' | 'manual';
  /** Nombre del archivo o descripcion de la fuente. */
  readonly name?: string | undefined;
  /** Modelo y version que la produjo, si vino de uno. */
  readonly model?: string | undefined;
}

/**
 * Un flujo de notas que pertenecen al mismo ejecutante.
 *
 * En un MIDI es una pista; en audio separado, un stem. El `instrumentId`
 * apunta al catalogo de `@sinfo/core` y puede venir declarado por el usuario
 * (lo fiable) o sugerido por un clasificador de timbre (lo dudoso).
 */
export interface PerformanceTrack {
  readonly id: string;
  readonly name?: string | undefined;
  /** Id del catalogo de instrumentos. Ausente si nadie lo ha decidido aun. */
  readonly instrumentId?: string | undefined;
  /** Programa General MIDI, si la fuente lo traia. */
  readonly midiProgram?: number | undefined;
  /** Percusion: las alturas son sonidos de bateria, no notas. */
  readonly isPercussion?: boolean | undefined;
  readonly notes: readonly RawNote[];
}

/**
 * Una interpretacion completa: lo que se toco, no lo que estaba escrito.
 *
 * Es JSON puro a proposito. Cualquiera puede producir uno —un modelo, un
 * archivo MIDI, otra herramienta, un humano a mano— y a partir de ahi el
 * cuantizador hace su trabajo sin saber ni preguntar de donde vino.
 */
export interface Performance {
  readonly tracks: readonly PerformanceTrack[];
  /**
   * Rejilla de pulso. Sin ella el cuantizador tiene que inventarse un tempo
   * constante, y el resultado con musica tocada por humanos es malo.
   */
  readonly grid?: BeatGrid | undefined;
  /** Tonalidad sugerida, p. ej. "D minor". Solo una pista, no una orden. */
  readonly keyHint?: string | undefined;
  /**
   * Compas declarado por la fuente, p. ej. "6/8".
   *
   * Un archivo MIDI lo trae escrito y no hay que deducirlo. Importa porque
   * deducirlo de los tiempos fuertes no distingue un 6/8 de un 3/4: ambos
   * miden tres negras, y solo el dato original sabe cual de los dos es.
   */
  readonly timeSignatureHint?: string | undefined;
  readonly source?: PerformanceSource | undefined;
}

// ------------------------------------------------------------------ fabricas

/** Crea una nota validando los invariantes que el resto del codigo da por hechos. */
export function rawNote(note: RawNote): RawNote {
  if (!Number.isFinite(note.onset) || note.onset < 0) {
    invalid('INVALID_PERFORMANCE', 'El ataque debe ser un numero finito no negativo', {
      onset: note.onset,
    });
  }
  if (!Number.isFinite(note.offset) || note.offset <= note.onset) {
    invalid('INVALID_PERFORMANCE', 'La extincion debe ser posterior al ataque', {
      onset: note.onset,
      offset: note.offset,
    });
  }
  if (!Number.isFinite(note.midi) || note.midi < 0 || note.midi > 127) {
    invalid('INVALID_PERFORMANCE', 'La altura MIDI debe estar entre 0 y 127', { midi: note.midi });
  }
  return Object.freeze({ ...note });
}

/** Duracion sonante en segundos. No es la figura escrita: eso lo decide el cuantizador. */
export function noteDuration(note: RawNote): number {
  return note.offset - note.onset;
}

/** Altura temperada mas cercana. La conversion a `Pitch` pasa por aqui. */
export function nearestMidi(note: RawNote): number {
  return Math.round(note.midi);
}

/**
 * Desviacion respecto al temperamento igual, en cents.
 *
 * Util para detectar que una pista entera esta desafinada medio tono —caso
 * comun en grabaciones antiguas y en cintas— antes de culpar al transcriptor.
 */
export function centsOffset(note: RawNote): number {
  return (note.midi - Math.round(note.midi)) * 100;
}

// -------------------------------------------------------------- utilidades

/** Todas las notas de todas las pistas, ordenadas por ataque. */
export function allNotes(performance: Performance): RawNote[] {
  return performance.tracks.flatMap((track) => track.notes).sort((a, b) => a.onset - b.onset);
}

/** Segundo en que termina la ultima nota. Cero si no hay ninguna. */
export function performanceDuration(performance: Performance): number {
  let end = 0;
  for (const track of performance.tracks) {
    for (const note of track.notes) {
      if (note.offset > end) end = note.offset;
    }
  }
  return end;
}

/** Cuenta de notas, para resumenes compactos hacia el agente. */
export function noteCount(performance: Performance): number {
  return performance.tracks.reduce((total, track) => total + track.notes.length, 0);
}

/**
 * Confianza media ponderada por duracion.
 *
 * Ponderar por duracion y no por cuenta evita que una lluvia de notas
 * espurias muy cortas —el fallo tipico de los detectores— hunda la media de
 * una transcripcion que en lo sustancial es buena.
 */
export function averageConfidence(performance: Performance): number {
  let weighted = 0;
  let total = 0;
  for (const track of performance.tracks) {
    for (const note of track.notes) {
      const span = noteDuration(note);
      weighted += note.confidence * span;
      total += span;
    }
  }
  return total === 0 ? 0 : weighted / total;
}

/** Ordena las notas de cada pista por ataque, dejando el resto intacto. */
export function sortPerformance(performance: Performance): Performance {
  return {
    ...performance,
    tracks: performance.tracks.map((track) => ({
      ...track,
      notes: [...track.notes].sort((a, b) => a.onset - b.onset || a.midi - b.midi),
    })),
  };
}
