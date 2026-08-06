import { invalid } from '@sinfo/core';

/** Tolerancia al emparejar tiempos fuertes con pulsos, en segundos. */
const SNAP_TOLERANCE = 0.001;

/**
 * Donde cae el pulso, medido en segundos.
 *
 * Es la pieza que convierte una interpretacion humana en algo cuantizable.
 * La alternativa —suponer un tempo constante y dividir— funciona con un
 * secuenciador y fracasa con cualquier musico: un rubato de dos por ciento
 * basta para que, treinta compases despues, las notas caigan en el tiempo
 * equivocado.
 *
 * Con la rejilla no hace falta ningun modelo de tempo. Se pregunta "entre que
 * dos pulsos cae este ataque y a que altura", y el rubato se desvanece porque
 * se mide contra el pulso real, no contra un reloj imaginario.
 */
export interface BeatGrid {
  /** Pulsos en segundos, estrictamente ascendente. */
  readonly beats: readonly number[];
  /** Tiempos fuertes: subconjunto de `beats`. Puede estar vacio. */
  readonly downbeats: readonly number[];
  /** Confianza por pulso, 0..1. Misma longitud que `beats` si esta. */
  readonly confidence?: readonly number[] | undefined;
}

// ------------------------------------------------------------------ fabrica

/**
 * Construye y valida una rejilla.
 *
 * Los tiempos fuertes se ajustan al pulso mas cercano dentro de un milisegundo:
 * los detectores emiten pulsos y fuertes por separado y los valores difieren en
 * el ultimo decimal. Sin este ajuste, `beatsPerBar` no encontraria ninguna
 * coincidencia y decidiria que la obra no tiene compas.
 */
export function createGrid(
  beats: readonly number[],
  downbeats: readonly number[] = [],
  confidence?: readonly number[],
): BeatGrid {
  for (let i = 0; i < beats.length; i += 1) {
    const beat = beats[i];
    if (beat === undefined || !Number.isFinite(beat) || beat < 0) {
      invalid('INVALID_PERFORMANCE', 'Los pulsos deben ser segundos finitos no negativos', {
        index: i,
        beat,
      });
    }
    const previous = beats[i - 1];
    if (previous !== undefined && beat <= previous) {
      invalid('INVALID_PERFORMANCE', 'Los pulsos deben ir en orden estrictamente ascendente', {
        index: i,
        previous,
        beat,
      });
    }
  }

  if (confidence !== undefined && confidence.length !== beats.length) {
    invalid('INVALID_PERFORMANCE', 'La confianza debe traer un valor por pulso', {
      beats: beats.length,
      confidence: confidence.length,
    });
  }

  const snapped: number[] = [];
  for (const downbeat of downbeats) {
    const index = nearestBeatIndex(beats, downbeat);
    const match = index === -1 ? undefined : beats[index];
    if (match === undefined || Math.abs(match - downbeat) > SNAP_TOLERANCE) {
      invalid('INVALID_PERFORMANCE', 'Cada tiempo fuerte debe coincidir con un pulso', {
        downbeat,
        nearest: match,
      });
    }
    snapped.push(match);
  }
  snapped.sort((a, b) => a - b);

  return Object.freeze({
    beats: Object.freeze([...beats]),
    downbeats: Object.freeze(snapped),
    ...(confidence === undefined ? {} : { confidence: Object.freeze([...confidence]) }),
  });
}

/**
 * Rejilla sintetica de tempo constante.
 *
 * Para fuentes que ya traen su propio mapa de tempo —un archivo MIDI, un
 * proyecto de DAW— donde no hace falta detectar nada porque el tempo es dato,
 * no estimacion.
 */
export function gridFromTempo(
  bpm: number,
  totalSeconds: number,
  beatsPerBar = 4,
  startSeconds = 0,
): BeatGrid {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    invalid('INVALID_PERFORMANCE', 'El tempo debe ser positivo', { bpm });
  }
  if (!Number.isInteger(beatsPerBar) || beatsPerBar <= 0) {
    invalid('INVALID_PERFORMANCE', 'Los pulsos por compas deben ser un entero positivo', {
      beatsPerBar,
    });
  }
  const period = 60 / bpm;
  const beats: number[] = [];
  const downbeats: number[] = [];
  // `<=` para que una obra que dura un numero exacto de compases reciba el
  // pulso de cierre; sin el, el ultimo compas queda sin su barra final.
  for (let i = 0; startSeconds + i * period <= totalSeconds + period; i += 1) {
    const at = startSeconds + i * period;
    beats.push(at);
    if (i % beatsPerBar === 0) downbeats.push(at);
  }
  return createGrid(beats, downbeats);
}

// ------------------------------------------------------------- conversiones

/**
 * Segundos a posicion de pulso, con parte fraccionaria.
 *
 * Un ataque en 1,37 s entre el pulso 3 (1,20 s) y el 4 (1,60 s) devuelve
 * 3,425. Fuera de los extremos extrapola con el intervalo mas cercano, de modo
 * que una anacrusa da posiciones negativas en lugar de aplastarse contra cero.
 */
export function secondsToBeat(grid: BeatGrid, seconds: number): number {
  const { beats } = grid;
  if (beats.length < 2) {
    invalid('INVALID_PERFORMANCE', 'Hacen falta al menos dos pulsos para situar un tiempo', {
      beats: beats.length,
    });
  }

  const index = floorBeatIndex(beats, seconds);

  if (index < 0) {
    const first = at(beats, 0);
    const step = at(beats, 1) - first;
    return (seconds - first) / step;
  }
  if (index >= beats.length - 1) {
    const last = at(beats, beats.length - 1);
    const step = last - at(beats, beats.length - 2);
    return beats.length - 1 + (seconds - last) / step;
  }

  const start = at(beats, index);
  const step = at(beats, index + 1) - start;
  return index + (seconds - start) / step;
}

/** Inversa de `secondsToBeat`, con la misma extrapolacion en los extremos. */
export function beatToSeconds(grid: BeatGrid, beat: number): number {
  const { beats } = grid;
  if (beats.length < 2) {
    invalid('INVALID_PERFORMANCE', 'Hacen falta al menos dos pulsos para situar un pulso', {
      beats: beats.length,
    });
  }

  const index = Math.floor(beat);
  const fraction = beat - index;

  if (index < 0) {
    const first = at(beats, 0);
    return first + beat * (at(beats, 1) - first);
  }
  if (index >= beats.length - 1) {
    const last = at(beats, beats.length - 1);
    const step = last - at(beats, beats.length - 2);
    return last + (beat - (beats.length - 1)) * step;
  }

  const start = at(beats, index);
  return start + fraction * (at(beats, index + 1) - start);
}

// ---------------------------------------------------------------- analisis

/**
 * Cuantos pulsos hay por compas, por moda de la distancia entre fuertes.
 *
 * Moda y no media: un cambio de compas puntual, o un fuerte que el detector se
 * salto, desplazaria la media a un valor fraccionario que no significa nada.
 * La moda sobrevive a ambos. Devuelve `null` si no hay fuertes suficientes.
 */
export function beatsPerBar(grid: BeatGrid): number | null {
  const { beats, downbeats } = grid;
  if (downbeats.length < 2) return null;

  const counts = new Map<number, number>();
  for (let i = 0; i < downbeats.length - 1; i += 1) {
    const from = floorBeatIndex(beats, at(downbeats, i));
    const to = floorBeatIndex(beats, at(downbeats, i + 1));
    const span = to - from;
    if (span > 0) counts.set(span, (counts.get(span) ?? 0) + 1);
  }

  let best: number | null = null;
  let bestCount = 0;
  for (const [span, count] of counts) {
    // Ante empate gana el compas mas corto: es mas probable que un 4/4 real
    // haya perdido un fuerte y parezca 8 que al reves.
    if (count > bestCount || (count === bestCount && best !== null && span < best)) {
      best = span;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Tempo medio en negras por minuto sobre todo el tramo.
 *
 * Se mide extremo a extremo en vez de promediar intervalos uno a uno porque
 * asi un pulso mal detectado en medio no altera el resultado: solo cuentan el
 * primero y el ultimo.
 */
export function averageTempo(grid: BeatGrid): number {
  const { beats } = grid;
  if (beats.length < 2) {
    invalid('INVALID_PERFORMANCE', 'Hacen falta al menos dos pulsos para estimar el tempo', {
      beats: beats.length,
    });
  }
  const span = at(beats, beats.length - 1) - at(beats, 0);
  return ((beats.length - 1) / span) * 60;
}

/**
 * Cuanto oscila el tempo, como desviacion tipica relativa de los intervalos.
 *
 * Cerca de cero significa cuadricula de secuenciador; por encima de 0,1, un
 * humano tocando con libertad. Sirve para decidir cuanta holgura darle al
 * cuantizador antes de empezar a inventarse figuras raras.
 */
export function tempoStability(grid: BeatGrid): number {
  const { beats } = grid;
  if (beats.length < 3) return 0;

  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i += 1) intervals.push(at(beats, i) - at(beats, i - 1));

  const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  if (mean === 0) return 0;
  const variance =
    intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / intervals.length;
  return Math.sqrt(variance) / mean;
}

// --------------------------------------------------------------- interiores

/** Indice del ultimo pulso menor o igual que `seconds`; -1 si va antes del primero. */
function floorBeatIndex(beats: readonly number[], seconds: number): number {
  let low = 0;
  let high = beats.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (at(beats, middle) <= seconds) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** Indice del pulso mas proximo a `seconds`, en cualquier direccion. */
function nearestBeatIndex(beats: readonly number[], seconds: number): number {
  if (beats.length === 0) return -1;
  const floor = floorBeatIndex(beats, seconds);
  if (floor === -1) return 0;
  if (floor === beats.length - 1) return floor;
  const below = at(beats, floor);
  const above = at(beats, floor + 1);
  return seconds - below <= above - seconds ? floor : floor + 1;
}

/** Acceso indexado que falla ruidosamente en vez de propagar `undefined`. */
function at(values: readonly number[], index: number): number {
  const value = values[index];
  if (value === undefined) {
    invalid('INVALID_PERFORMANCE', 'Indice de pulso fuera de rango', {
      index,
      length: values.length,
    });
  }
  return value;
}
