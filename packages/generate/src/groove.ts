import { Duration, type MusicalEvent } from '@sinfo/core';
import { Random } from './random.js';

/**
 * Groove y humanizacion.
 *
 * Es INTERPRETACION, no notacion. Un pasaje con swing se escribe con corcheas
 * rectas y el interprete lo balancea; escribirlo en tresillos seria notacion
 * incorrecta y ademas ilegible. Por eso esto no toca la partitura: se aplica
 * al exportar, igual que el staccato acorta lo que suena sin cambiar la figura
 * escrita.
 *
 * De ahi que el modulo trabaje sobre notas YA COLOCADAS y devuelva otras
 * colocadas, sin conocer voces ni partes.
 */

export interface PerformedNote {
  /** Posicion desde el inicio, en fracciones de redonda. */
  readonly position: Duration;
  readonly duration: Duration;
  readonly velocity: number;
  readonly event: MusicalEvent;
}

export interface GrooveProfile {
  readonly name: string;
  readonly description: string;
  /**
   * Reparto del par de subdivisiones, como fraccion EXACTA: la primera nota se
   * lleva `swing[0]/swing[1]` del par. [1,2] es recto y [2,3] es swing de
   * tresillo.
   *
   * Se guarda como dos enteros y no como decimal a proposito. Con 0.667 el
   * swing de tresillo caia en 667/4000 de redonda en vez de 1/6 exacto: una
   * aproximacion imperceptible al oido pero que mete denominadores absurdos en
   * un dominio construido entero sobre aritmetica racional.
   */
  readonly swing: readonly [number, number];
  /** Figura que se balancea. Corchea en casi todo el jazz. */
  readonly swingUnit: Duration;
  /** Adelanto o retraso constante, en fracciones de redonda. Negativo = adelante. */
  readonly push: Duration;
  /** Acentos por posicion dentro del compas, en unidades de velocity. */
  readonly accents: readonly number[];
  /** Unidad sobre la que se cuentan los acentos. */
  readonly accentUnit: Duration;
}

export interface HumanizeOptions {
  readonly groove?: GrooveProfile | undefined;
  /**
   * Cuanto se desordena, de 0 a 1. Afecta al descuadre temporal y a la
   * variacion de intensidad a la vez.
   */
  readonly amount?: number | undefined;
  readonly seed?: string | undefined;
  /** Duracion del compas, para saber donde caen los acentos. */
  readonly measureDuration?: Duration | undefined;
}

/** Desfase maximo, en fracciones de redonda: una fusa con `amount` a tope. */
const MAX_JITTER = Duration.of(1, 64);
/** Variacion maxima de intensidad, en unidades de velocity. */
const MAX_VELOCITY_JITTER = 18;

export const GROOVE_PRESETS: Readonly<Record<string, GrooveProfile>> = {
  straight: {
    name: 'Recto',
    description: 'Sin balanceo. Lo normal en musica clasica.',
    swing: [1, 2],
    swingUnit: Duration.EIGHTH,
    push: Duration.ZERO,
    accents: [4, -2, 1, -2],
    accentUnit: Duration.QUARTER,
  },
  swing: {
    name: 'Swing',
    description: 'Balanceo de tresillo, el del jazz. La primera corchea dura el doble.',
    swing: [2, 3],
    swingUnit: Duration.EIGHTH,
    push: Duration.ZERO,
    accents: [2, 5, 2, 5],
    accentUnit: Duration.QUARTER,
  },
  shuffle: {
    name: 'Shuffle',
    description: 'Balanceo marcado sobre semicorcheas, tipico del blues.',
    swing: [2, 3],
    swingUnit: Duration.SIXTEENTH,
    push: Duration.ZERO,
    accents: [6, 0, 3, 0],
    accentUnit: Duration.QUARTER,
  },
  laid_back: {
    name: 'Atrasado',
    description: 'Todo llega un pelo tarde. Da sensacion de relajacion.',
    swing: [11, 20],
    swingUnit: Duration.EIGHTH,
    push: Duration.of(1, 128),
    accents: [3, -1, 2, -1],
    accentUnit: Duration.QUARTER,
  },
  driving: {
    name: 'Adelantado',
    description: 'Todo llega un pelo antes. Empuja hacia delante.',
    swing: [1, 2],
    swingUnit: Duration.EIGHTH,
    push: Duration.of(-1, 128),
    accents: [6, 1, 4, 1],
    accentUnit: Duration.QUARTER,
  },
  funk: {
    name: 'Funk',
    description: 'Semicorcheas ligeramente balanceadas y primer tiempo muy marcado.',
    swing: [14, 25],
    swingUnit: Duration.SIXTEENTH,
    push: Duration.ZERO,
    accents: [8, -3, 2, -3],
    accentUnit: Duration.QUARTER,
  },
  waltz: {
    name: 'Vals',
    description: 'Primer tiempo pesado y segundo algo adelantado, como en el vals vienes.',
    swing: [1, 2],
    swingUnit: Duration.EIGHTH,
    push: Duration.ZERO,
    accents: [7, -2, -1],
    accentUnit: Duration.QUARTER,
  },
};

/**
 * Aplica groove y humanizacion a un pasaje.
 *
 * El orden importa: primero el balanceo, que es una decision de estilo con
 * proporciones exactas; luego el acento, que depende de donde cae la nota en
 * el compas; y al final el desorden aleatorio, que debe ser lo ultimo para que
 * no altere los calculos anteriores.
 *
 * Ninguna nota se adelanta del inicio: recortar ahi es preferible a que la
 * primera nota de la obra caiga en posicion negativa.
 */
export function humanize(
  notes: readonly PerformedNote[],
  options: HumanizeOptions = {},
): PerformedNote[] {
  const groove = options.groove ?? GROOVE_PRESETS['straight']!;
  const amount = Math.max(0, Math.min(1, options.amount ?? 0));
  const measure = options.measureDuration ?? Duration.WHOLE;

  // Flujos separados para que cambiar la intensidad del desorden no altere
  // tambien el reparto de acentos.
  const base = new Random(options.seed ?? 'groove');
  const timing = base.fork('tiempo');
  const dynamics = base.fork('intensidad');

  return notes.map((note) => {
    let position = applySwing(note.position, groove);
    position = position.plus(groove.push);

    if (amount > 0) {
      const offset = Math.round((timing.next() * 2 - 1) * amount * 4);
      position = position.plus(MAX_JITTER.times(offset, 4));
    }
    if (position.isNegative) position = Duration.ZERO;

    let velocity = note.velocity + accentAt(note.position, groove, measure);
    if (amount > 0) {
      velocity += Math.round((dynamics.next() * 2 - 1) * amount * MAX_VELOCITY_JITTER);
    }

    return {
      ...note,
      position,
      velocity: Math.max(1, Math.min(127, velocity)),
    };
  });
}

/**
 * Desplaza la nota segun el balanceo.
 *
 * El par de subdivisiones se reparte en la proporcion pedida: con swing de
 * tresillo, la primera se lleva dos tercios y la segunda un tercio. Solo se
 * mueve la segunda del par; la primera marca el pulso y no se toca.
 */
function applySwing(position: Duration, groove: GrooveProfile): Duration {
  const [num, den] = groove.swing;
  // Recto: la primera del par se lleva justo la mitad.
  if (num * 2 === den) return position;

  const unit = groove.swingUnit;
  const pair = unit.times(2);
  // En que par cae y cuanto lleva recorrido dentro de el.
  const pairIndex = Math.floor(position.value / pair.value + 1e-9);
  const within = position.minus(pair.times(pairIndex));

  // Solo se desplaza la nota que cae justo en la segunda mitad del par.
  if (!within.equals(unit)) return position;

  // La frontera se corre de la mitad a la proporcion pedida, sin salir de la
  // aritmetica exacta: con [2,3] el par de corcheas se parte en 1/6 y 1/12.
  return pair.times(pairIndex).plus(pair.times(num, den));
}

/** Acento que corresponde a la posicion segun su sitio en el compas. */
function accentAt(position: Duration, groove: GrooveProfile, measure: Duration): number {
  if (groove.accents.length === 0) return 0;

  const withinMeasure = position.value % measure.value;
  const index = Math.round(withinMeasure / groove.accentUnit.value);

  // Solo se acentua lo que cae EN el pulso; lo de en medio no lleva acento.
  const exact = Math.abs(withinMeasure / groove.accentUnit.value - index) < 1e-6;
  return exact ? (groove.accents[index % groove.accents.length] ?? 0) : 0;
}

export function listGrooves(): readonly { id: string; name: string; description: string }[] {
  return Object.entries(GROOVE_PRESETS).map(([id, groove]) => ({
    id,
    name: groove.name,
    description: groove.description,
  }));
}

export function getGroove(id: string): GrooveProfile | undefined {
  return GROOVE_PRESETS[id];
}
