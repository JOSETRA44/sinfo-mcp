import {
  chord as chordEvent,
  Interval,
  isRest,
  note,
  Pitch,
  rest,
  transposeEvent,
  writtenPitch,
  type Instrument,
  type MusicalEvent,
} from '@sinfo/core';
import type { Chord } from '@sinfo/theory';
import { Random } from './random.js';

/**
 * Orquestacion: repartir el material entre los instrumentos del conjunto.
 *
 * Orquestar no es copiar las mismas notas en todos los pentagramas. Es decidir
 * QUIEN toca QUE y EN QUE REGISTRO, y esas dos decisiones estan gobernadas por
 * datos que ya tiene el catalogo: la tesitura de cada instrumento, cuantos
 * ejecutantes tiene su seccion y cuanto proyecta.
 *
 * El modulo se organiza en tres capas independientes, y por eso se puede
 * cambiar una sin tocar las otras:
 *   1. ajuste de registro   -- meter un pasaje en la tesitura de un instrumento
 *   2. reparto de acordes   -- que nota del acorde toca cada uno
 *   3. asignacion de papeles -- quien lleva melodia, armonia o bajo
 */

/** Papel de un instrumento en la textura. */
export type TextureRole = 'melodia' | 'contramelodia' | 'armonia' | 'bajo' | 'pedal' | 'silencio';

export interface RoleAssignment {
  readonly partId: string;
  readonly instrument: Instrument;
  readonly role: TextureRole;
  /** Octavas de desplazamiento aplicadas para encajar en la tesitura. */
  readonly octaveShift: number;
  /** Nota del acorde que le toca, cuando el papel es armonia. */
  readonly chordDegree: number | null;
}

// ------------------------------------------------------- ajuste de registro

export interface RangeFit {
  readonly events: readonly MusicalEvent[];
  readonly octaveShift: number;
  /** Notas que siguen fuera del rango fisico tras el ajuste. */
  readonly outOfRange: number;
}

/**
 * Baja o sube el pasaje por OCTAVAS hasta que encaje en la tesitura.
 *
 * Solo octavas, nunca otro intervalo: transportar una melodia una tercera la
 * cambia de tonalidad; transportarla una octava la deja siendo la misma
 * melodia en otro registro. Es la operacion que hace un orquestador cuando el
 * tema del violin tiene que pasar al fagot.
 *
 * Trabaja en alturas SONANTES y devuelve alturas ESCRITAS: quien recibe el
 * resultado lo vuelca en una parte, y una parte lleva lo que el interprete lee.
 */
export function fitToRange(
  events: readonly MusicalEvent[],
  instrument: Instrument,
): RangeFit {
  const sounding = events.flatMap((event) => event.pitches.map((pitch) => pitch.midi));
  if (sounding.length === 0) {
    return { events: [...events], octaveShift: 0, outOfRange: 0 };
  }

  const lowest = Math.min(...sounding);
  const highest = Math.max(...sounding);
  const centre = (instrument.tessitura.lowest.midi + instrument.tessitura.highest.midi) / 2;

  // Se prueban todos los desplazamientos plausibles y se elige el que menos
  // notas deja fuera; a igualdad, el que centra mejor el pasaje. Probar en vez
  // de calcular evita casos raros con pasajes mas anchos que la tesitura.
  let best = { shift: 0, outside: Number.POSITIVE_INFINITY, distance: Number.POSITIVE_INFINITY };

  for (let shift = -4; shift <= 4; shift++) {
    const offset = shift * 12;
    const outside = sounding.filter(
      (midi) =>
        midi + offset < instrument.range.lowest.midi ||
        midi + offset > instrument.range.highest.midi,
    ).length;
    const distance = Math.abs((lowest + highest) / 2 + offset - centre);

    if (outside < best.outside || (outside === best.outside && distance < best.distance)) {
      best = { shift, outside, distance };
    }
  }

  const interval = Interval.of(best.shift * 7, best.shift * 12);
  const shifted =
    best.shift === 0 ? [...events] : events.map((event) => transposeEvent(event, interval));

  return {
    events: shifted.map((event) => toWritten(event, instrument)),
    octaveShift: best.shift,
    outOfRange: best.outside,
  };
}

/** Convierte las alturas sonantes de un evento en las que hay que escribir. */
function toWritten(event: MusicalEvent, instrument: Instrument): MusicalEvent {
  if (isRest(event) || instrument.transposition.chromatic === 0) return event;
  return {
    ...event,
    pitches: Object.freeze(event.pitches.map((pitch) => writtenPitch(instrument, pitch))),
  };
}

// -------------------------------------------------------- reparto de acordes

/**
 * Reparte las notas de un acorde entre varios instrumentos.
 *
 * De grave a agudo, cada instrumento recibe una nota del acorde en el registro
 * que le queda comodo. La fundamental va abajo y la sensible o la tercera se
 * evita duplicar, que es lo que enturbia un acorde orquestal.
 */
export function distributeChord(
  chord: Chord,
  instruments: readonly Instrument[],
): { instrument: Instrument; pitch: Pitch; degree: number }[] {
  if (instruments.length === 0) return [];

  const ordered = [...instruments].sort(
    (a, b) => tessituraCentre(a) - tessituraCentre(b),
  );
  const tones = chord.pitches;
  const result: { instrument: Instrument; pitch: Pitch; degree: number }[] = [];

  for (const [index, instrument] of ordered.entries()) {
    // El mas grave lleva la fundamental; el resto reparte las demas notas en
    // orden, volviendo a empezar cuando hay mas instrumentos que notas.
    const degree = index === 0 ? 0 : ((index - 1) % (tones.length - 1)) + 1;
    const tone = tones[degree]!;
    result.push({
      instrument,
      pitch: nearestOctaveTo(tone, tessituraCentre(instrument)),
      degree,
    });
  }

  return result;
}

/** Octava de esa altura mas proxima al centro indicado. */
function nearestOctaveTo(pitch: Pitch, targetMidi: number): Pitch {
  let best = pitch;
  let bestDistance = Math.abs(pitch.midi - targetMidi);

  for (let octave = -3; octave <= 3; octave++) {
    if (octave === 0) continue;
    const candidate = pitch.withOctave(pitch.octave + octave);
    if (candidate.midi < 0 || candidate.midi > 127) continue;
    const distance = Math.abs(candidate.midi - targetMidi);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function tessituraCentre(instrument: Instrument): number {
  return (instrument.tessitura.lowest.midi + instrument.tessitura.highest.midi) / 2;
}

// ------------------------------------------------------- asignacion de papeles

export type OrchestrationStyle = 'tutti' | 'melodia-acompanamiento' | 'coral' | 'camara';

export interface OrchestrationCandidate {
  readonly partId: string;
  readonly instrument: Instrument;
}

export interface AssignRolesOptions {
  readonly style?: OrchestrationStyle | undefined;
  /** Rango sonante del material melodico, para elegir quien lo lleva. */
  readonly melodyRange?: { lowest: Pitch; highest: Pitch } | undefined;
  readonly seed?: string | undefined;
  /** Cuantos instrumentos como maximo doblan la melodia. */
  readonly maxMelodyDoublings?: number | undefined;
}

/**
 * Decide que papel cumple cada instrumento.
 *
 * El criterio de fondo es el BALANCE, no el gusto. Un trombon pesa casi el
 * doble que una viola y una seccion de catorce violines pesa mucho mas que una
 * flauta sola: si se reparte sin mirar eso, la melodia queda tapada. El peso
 * de cada linea se calcula con `sectionSize` y `weight` del catalogo, que son
 * datos, no reglas escritas a mano.
 */
export function assignRoles(
  candidates: readonly OrchestrationCandidate[],
  options: AssignRolesOptions = {},
): RoleAssignment[] {
  if (candidates.length === 0) return [];

  const random = new Random(options.seed ?? 'orquestacion');
  const style = options.style ?? 'melodia-acompanamiento';

  const byRegister = [...candidates].sort(
    (a, b) => tessituraCentre(a.instrument) - tessituraCentre(b.instrument),
  );

  const assignments = new Map<string, TextureRole>();

  // 1. El bajo: los instrumentos mas graves del conjunto.
  const bassCount = Math.max(1, Math.round(byRegister.length * 0.2));
  for (const candidate of byRegister.slice(0, bassCount)) {
    assignments.set(candidate.partId, 'bajo');
  }

  // 2. La melodia: los que mejor cubren su rango, empezando por los agudos.
  const melodyPool = byRegister
    .slice(bassCount)
    .filter((candidate) => coversRange(candidate.instrument, options.melodyRange))
    .reverse();

  const melodyCount = Math.min(
    melodyPool.length,
    options.maxMelodyDoublings ?? defaultMelodyDoublings(style, byRegister.length),
  );
  for (const candidate of melodyPool.slice(0, melodyCount)) {
    assignments.set(candidate.partId, 'melodia');
  }

  // 3. El resto rellena la armonia. En estilo coral no hay relleno: cada voz
  //    lleva su propia linea y doblarlas destruiria la textura.
  for (const candidate of byRegister) {
    if (assignments.has(candidate.partId)) continue;
    assignments.set(candidate.partId, style === 'coral' ? 'melodia' : 'armonia');
  }

  // 4. En camara se aligera: parte de la armonia calla para que se oigan las
  //    lineas. Con pocos instrumentos, doblarlo todo suena espeso.
  if (style === 'camara') {
    const harmony = byRegister.filter((c) => assignments.get(c.partId) === 'armonia');
    for (const candidate of random.shuffle(harmony).slice(0, Math.floor(harmony.length / 3))) {
      assignments.set(candidate.partId, 'silencio');
    }
  }

  const chordVoices = byRegister.filter((c) => assignments.get(c.partId) === 'armonia');

  return byRegister.map((candidate) => {
    const role = assignments.get(candidate.partId)!;
    return {
      partId: candidate.partId,
      instrument: candidate.instrument,
      role,
      octaveShift: 0,
      chordDegree:
        role === 'armonia'
          ? chordVoices.findIndex((voice) => voice.partId === candidate.partId)
          : null,
    };
  });
}

function defaultMelodyDoublings(style: OrchestrationStyle, size: number): number {
  switch (style) {
    case 'tutti':
      return Math.max(2, Math.round(size * 0.4));
    case 'coral':
      return size;
    case 'camara':
      return 1;
    default:
      return Math.max(1, Math.round(size * 0.25));
  }
}

/** true si el instrumento puede tocar todo el rango pedido. */
function coversRange(
  instrument: Instrument,
  range: { lowest: Pitch; highest: Pitch } | undefined,
): boolean {
  if (!range) return true;
  // Se cuenta con que el pasaje se pueda desplazar por octavas.
  const span = range.highest.midi - range.lowest.midi;
  const capacity = instrument.range.highest.midi - instrument.range.lowest.midi;
  return capacity >= span;
}

// ------------------------------------------------------------------ balance

export interface BalanceReport {
  /** Peso sonoro de cada papel: cuanto proyecta el conjunto que lo toca. */
  readonly weights: Readonly<Record<string, number>>;
  readonly issues: readonly string[];
}

/**
 * Comprueba que la melodia se oiga por encima del acompanamiento.
 *
 * El peso de una linea es la suma de `sectionSize x weight` de quienes la
 * tocan. Una melodia de flauta sola (1 x 0.8) contra una armonia de metales
 * (3 trombones x 1.8) queda enterrada, y eso es un error de orquestacion que
 * no se ve leyendo la partitura nota a nota.
 */
export function checkBalance(assignments: readonly RoleAssignment[]): BalanceReport {
  const weights: Record<string, number> = {};

  for (const assignment of assignments) {
    if (assignment.role === 'silencio') continue;
    const weight = assignment.instrument.sectionSize * assignment.instrument.weight;
    weights[assignment.role] = (weights[assignment.role] ?? 0) + weight;
  }

  const issues: string[] = [];
  const melody = weights['melodia'] ?? 0;
  const harmony = weights['armonia'] ?? 0;
  const bass = weights['bajo'] ?? 0;

  if (melody === 0 && assignments.length > 0) {
    issues.push('Nadie lleva la melodia: la textura no tiene primer plano');
  }
  if (melody > 0 && harmony > melody * 2.5) {
    issues.push(
      `El acompanamiento (peso ${harmony.toFixed(1)}) tapa a la melodia (peso ` +
        `${melody.toFixed(1)}): reduce instrumentos en la armonia o dobla la melodia`,
    );
  }
  if (bass === 0 && assignments.length > 2) {
    issues.push('Nadie sostiene el bajo: la armonia queda sin cimientos');
  }
  if (bass > 0 && melody > 0 && bass > melody * 3) {
    issues.push(
      `El bajo (peso ${bass.toFixed(1)}) pesa mucho mas que la melodia (peso ` +
        `${melody.toFixed(1)}): la textura sonara pesada`,
    );
  }

  return { weights, issues };
}

// ------------------------------------------------------------------ material

/**
 * Convierte una linea melodica en el material de un instrumento segun su papel.
 *
 * El bajo se queda con la nota mas grave de cada evento y la armonia recibe
 * acordes sostenidos: son las simplificaciones que hace un orquestador cuando
 * reparte una reduccion de piano entre una orquesta.
 */
export function materialFor(
  role: TextureRole,
  melody: readonly MusicalEvent[],
  chords: readonly Chord[],
  instrument: Instrument,
  chordDegree: number,
): MusicalEvent[] {
  switch (role) {
    case 'silencio':
      return melody.map((event) => rest(event.duration));

    case 'melodia':
    case 'contramelodia':
      return [...melody];

    case 'bajo': {
      if (chords.length === 0 || melody.length === 0) return [...melody];
      return chords.map((chord, index) => {
        // Cuando hay mas acordes que eventos de melodia, se reutiliza la
        // duracion del primero: el bajo sostiene, no imita el ritmo de arriba.
        const duration = melody[index]?.duration ?? melody[0]!.duration;
        return note(nearestOctaveTo(chord.bass, tessituraCentre(instrument)), duration);
      });
    }

    case 'pedal': {
      if (chords.length === 0 || melody.length === 0) return [...melody];
      const pitch = nearestOctaveTo(chords[0]!.root, tessituraCentre(instrument));
      return melody.map((event) => note(pitch, event.duration));
    }

    case 'armonia': {
      if (chords.length === 0) return melody.map((event) => rest(event.duration));
      return chords.map((chord, index) => {
        const duration = melody[index]?.duration ?? melody[0]!.duration;
        const tone = chord.pitches[chordDegree % chord.pitches.length]!;
        return note(nearestOctaveTo(tone, tessituraCentre(instrument)), duration);
      });
    }
  }
}

export { chordEvent };
