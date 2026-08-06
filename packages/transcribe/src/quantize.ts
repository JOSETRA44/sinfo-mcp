import { Duration, invalid } from '@sinfo/core';
import { type BeatGrid, type RawNote, nearestMidi, secondsToBeat } from '@sinfo/perform';

/**
 * Cuantizacion ritmica guiada por el pulso detectado.
 *
 * El error clasico es ajustar a una rejilla fija de semicorcheas. Falla por
 * dos motivos independientes: no sabe de tresillos, y da por bueno un tempo
 * constante que ningun musico toca. El resultado son partituras con figuras
 * imposibles y compases descuadrados.
 *
 * Aqui se hace al reves. Los ataques se miden CONTRA EL PULSO REAL —eso ya
 * elimina el rubato, ver `secondsToBeat`— y despues se decide, pulso a pulso y
 * por programacion dinamica, en cuantas partes conviene dividirlo.
 *
 * La programacion dinamica no es adorno. Elegir cada pulso por separado
 * produce el desastre tipico de los transcriptores: tresillos y semicorcheas
 * alternandose compas tras compas porque el ruido de ejecucion inclina la
 * balanza en un sentido u otro. El coste de transicion obliga a que cambiar de
 * subdivision cueste, asi que solo ocurre cuando la musica lo pide de verdad.
 */

/** Subdivisiones candidatas del pulso: binarias, ternarias y sus combinaciones. */
export const DEFAULT_SUBDIVISIONS: readonly number[] = [1, 2, 3, 4, 6, 8, 12, 16];

export interface QuantizeOptions {
  /** En cuantas partes se puede dividir un pulso. */
  readonly subdivisions?: readonly number[] | undefined;
  /** Cuanto pesa la duracion de un pulso. Negra por defecto. */
  readonly beatUnit?: Duration | undefined;
  /**
   * Cuanto penaliza usar una subdivision fina. Subirlo produce partituras mas
   * simples y algo menos fieles; bajarlo, lo contrario. Sin esta penalizacion
   * el algoritmo elegiria siempre la rejilla mas fina, porque siempre ajusta
   * mejor, y escribiria fusas donde hay negras.
   */
  readonly complexityWeight?: number | undefined;
  /** Coste de cambiar de subdivision dentro de la misma familia (4 a 8). */
  readonly switchPenalty?: number | undefined;
  /** Coste de saltar entre binario y ternario (4 a 3). Deliberadamente alto. */
  readonly familySwitchPenalty?: number | undefined;
  /**
   * Que hacer con los huecos entre una nota y la siguiente.
   *
   * `measured` respeta el silencio medido: fiel a lo tocado, pero llena la
   * partitura de silencios cortos que nadie escribiria. `legato` alarga cada
   * nota hasta la siguiente: mas limpio de leer y casi siempre lo que el
   * interprete queria decir, sobre todo en cuerda y viento.
   */
  readonly gapPolicy?: 'measured' | 'legato' | undefined;
}

/** Una nota ya situada en tiempo exacto de partitura. */
export interface QuantizedNote {
  /** Posicion absoluta desde el inicio, en unidades de redonda. */
  readonly position: Duration;
  readonly duration: Duration;
  /** Altura MIDI ya redondeada al temperamento. */
  readonly midi: number;
  readonly velocity: number;
  readonly confidence: number;
}

export interface QuantizeResult {
  readonly notes: readonly QuantizedNote[];
  /** Subdivision elegida para cada pulso, desde `firstBeat`. */
  readonly subdivisions: readonly number[];
  /** Indice del primer pulso analizado. Negativo si hay anacrusa. */
  readonly firstBeat: number;
  /**
   * Desviacion media entre lo tocado y lo escrito, en fraccion de pulso.
   *
   * Es el termometro del resultado: por debajo de 0,02 la ejecucion estaba
   * practicamente cuadriculada; por encima de 0,1 conviene desconfiar de la
   * rejilla de pulso antes que del cuantizador.
   */
  readonly meanDeviation: number;
}

/**
 * Los pesos, calibrados y no elegidos a ojo.
 *
 * `complexityWeight` tiene una ventana bastante estrecha y conviene entender
 * por que antes de tocarlo. Por arriba: un tresillo exacto solo gana a la
 * division binaria si el error que evita compensa la penalizacion, y con 0,02
 * el margen era tan justo que un tresillo tocado con 15 ms de desvio —es
 * decir, bien tocado— se escribia como corcheas rectas. Por abajo: si baja de
 * 0,0012 aproximadamente, cualquier desviacion minuscula justifica irse a
 * fusas, y la partitura se llena de figuras que nadie toco.
 *
 * 0,008 deja holgura por los dos lados.
 *
 * Las penalizaciones de transicion son mucho mas bajas de lo que parece
 * sensato a primera vista, y hay una razon concreta. Un tresillo suelto en
 * medio de un pasaje binario obliga a entrar y salir de la rejilla ternaria,
 * asi que paga la penalizacion DOS veces, mientras que lo que gana —evitar
 * escribir 1/3 como 1/2— es del orden de 0,05. Con los 0,15 que tenia esto al
 * principio, ningun tresillo aislado sobrevivia: se escribian como corcheas
 * rectas y el error solo aparecio al probar la ida y vuelta completa.
 *
 * El trabajo de estas penalizaciones es tapar el ruido de ejecucion, que mueve
 * los costes en el orden de 0,004. Con 0,02 sobra para eso y no llega a
 * aplastar una figura de verdad.
 */
const DEFAULTS = {
  complexityWeight: 0.008,
  switchPenalty: 0.01,
  familySwitchPenalty: 0.02,
} as const;

export function quantize(
  notes: readonly RawNote[],
  grid: BeatGrid,
  options: QuantizeOptions = {},
): QuantizeResult {
  const subdivisions = options.subdivisions ?? DEFAULT_SUBDIVISIONS;
  const beatUnit = options.beatUnit ?? Duration.QUARTER;
  const complexityWeight = options.complexityWeight ?? DEFAULTS.complexityWeight;
  const switchPenalty = options.switchPenalty ?? DEFAULTS.switchPenalty;
  const familySwitchPenalty = options.familySwitchPenalty ?? DEFAULTS.familySwitchPenalty;
  const gapPolicy = options.gapPolicy ?? 'measured';

  if (subdivisions.length === 0) {
    invalid('INVALID_PERFORMANCE', 'Hace falta al menos una subdivision candidata', {});
  }
  for (const d of subdivisions) {
    if (!Number.isInteger(d) || d <= 0) {
      invalid('INVALID_PERFORMANCE', 'Las subdivisiones deben ser enteros positivos', { d });
    }
  }

  if (notes.length === 0) {
    return { notes: [], subdivisions: [], firstBeat: 0, meanDeviation: 0 };
  }

  // ---- 1. A posicion de pulso. Aqui es donde muere el rubato.
  const placed = notes
    .map((note) => ({
      note,
      onsetBeat: secondsToBeat(grid, note.onset),
      offsetBeat: secondsToBeat(grid, note.offset),
    }))
    .sort((a, b) => a.onsetBeat - b.onsetBeat || a.note.midi - b.note.midi);

  let firstBeat = Number.POSITIVE_INFINITY;
  let lastBeat = Number.NEGATIVE_INFINITY;
  for (const item of placed) {
    firstBeat = Math.min(firstBeat, Math.floor(item.onsetBeat));
    lastBeat = Math.max(lastBeat, Math.ceil(item.offsetBeat));
  }
  const beatCount = Math.max(1, lastBeat - firstBeat);

  // ---- 2. Que ataques y extinciones caen en cada pulso.
  //
  // Las extinciones entran en la decision con menos peso: son bastante menos
  // fiables que los ataques —un detector confunde a menudo el final de una
  // nota con su resonancia— y dejarlas mandar sobre la subdivision estropea
  // pulsos que los ataques resolvian bien.
  const perBeat: { fraction: number; weight: number }[][] = Array.from(
    { length: beatCount },
    () => [],
  );
  const push = (beat: number, weight: number): void => {
    const index = Math.floor(beat) - firstBeat;
    const bucket = perBeat[index];
    if (bucket !== undefined) bucket.push({ fraction: beat - Math.floor(beat), weight });
  };
  for (const item of placed) {
    push(item.onsetBeat, 1);
    push(item.offsetBeat, 0.35);
  }

  // ---- 3. Programacion dinamica sobre los pulsos.
  const localCost = perBeat.map((events) =>
    subdivisions.map((d) => fitCost(events, d) + complexityWeight * Math.log2(d)),
  );

  const total: number[][] = [];
  const from: number[][] = [];
  for (let b = 0; b < beatCount; b += 1) {
    const previousTotal = total[b - 1];
    const costs = localCost[b] ?? [];
    const row: number[] = [];
    const backlink: number[] = [];
    for (let s = 0; s < subdivisions.length; s += 1) {
      const own = costs[s] ?? 0;
      if (previousTotal === undefined) {
        row.push(own);
        backlink.push(-1);
        continue;
      }
      let best = Number.POSITIVE_INFINITY;
      let bestIndex = 0;
      for (let p = 0; p < subdivisions.length; p += 1) {
        const candidate =
          (previousTotal[p] ?? 0) +
          transitionCost(
            subdivisions[p] ?? 1,
            subdivisions[s] ?? 1,
            switchPenalty,
            familySwitchPenalty,
          );
        if (candidate < best) {
          best = candidate;
          bestIndex = p;
        }
      }
      row.push(best + own);
      backlink.push(bestIndex);
    }
    total.push(row);
    from.push(backlink);
  }

  // ---- 4. Recuperar la mejor cadena hacia atras.
  const chosen: number[] = new Array<number>(beatCount).fill(0);
  const lastRow = total[beatCount - 1] ?? [];
  let cursor = 0;
  let bestFinal = Number.POSITIVE_INFINITY;
  for (let s = 0; s < subdivisions.length; s += 1) {
    const value = lastRow[s] ?? Number.POSITIVE_INFINITY;
    if (value < bestFinal) {
      bestFinal = value;
      cursor = s;
    }
  }
  for (let b = beatCount - 1; b >= 0; b -= 1) {
    chosen[b] = cursor;
    cursor = from[b]?.[cursor] ?? 0;
  }
  const perBeatSubdivision = chosen.map((index) => subdivisions[index] ?? 1);

  // ---- 5. Ajustar a la rejilla elegida.
  const snapBeat = (beat: number): Duration => {
    const floor = Math.floor(beat);
    const index = floor - firstBeat;
    const d = perBeatSubdivision[Math.min(Math.max(index, 0), beatCount - 1)] ?? 1;
    const step = Math.round((beat - floor) * d);
    // `Duration.of` normaliza por MCD, asi que (b*d + k)/(d*4) sale exacto:
    // un tresillo es 1/12 de verdad, no 0.0833333.
    return Duration.of((floor * d + step) * beatUnit.num, d * beatUnit.den);
  };

  let deviationSum = 0;
  const quantized: QuantizedNote[] = [];
  for (const item of placed) {
    const position = snapBeat(item.onsetBeat);
    let end = snapBeat(item.offsetBeat);

    // Una nota mas corta que un paso de rejilla se aplasta a cero. Darle el
    // paso minimo es preferible a perderla: un adorno mal medido sigue siendo
    // una nota que sono.
    if (!end.greaterThan(position)) {
      const index = Math.floor(item.onsetBeat) - firstBeat;
      const d = perBeatSubdivision[Math.min(Math.max(index, 0), beatCount - 1)] ?? 1;
      end = position.plus(Duration.of(beatUnit.num, d * beatUnit.den));
    }

    deviationSum += Math.abs(item.onsetBeat - position.dividedBy(beatUnit.num, beatUnit.den).value);
    quantized.push({
      position,
      duration: end.minus(position),
      midi: nearestMidi(item.note),
      velocity: item.note.velocity,
      confidence: item.note.confidence,
    });
  }

  const finished = gapPolicy === 'legato' ? closeGaps(quantized) : quantized;

  return {
    notes: finished,
    subdivisions: perBeatSubdivision,
    firstBeat,
    meanDeviation: deviationSum / placed.length,
  };
}

// ---------------------------------------------------------------- interiores

/**
 * Cuanto se aleja lo tocado de una rejilla de `d` partes.
 *
 * Error al cuadrado y no absoluto: escribir cuatro notas con un desvio
 * pequeno cada una es mucho mas defendible que escribir una en un sitio
 * claramente equivocado, y el cuadrado es lo que expresa esa preferencia.
 */
function fitCost(events: readonly { fraction: number; weight: number }[], d: number): number {
  let cost = 0;
  for (const { fraction, weight } of events) {
    const snapped = Math.round(fraction * d) / d;
    cost += weight * (fraction - snapped) ** 2;
  }
  return cost;
}

/** Las subdivisiones ternarias viven en otro mundo metrico que las binarias. */
function isTernary(d: number): boolean {
  return d % 3 === 0;
}

function transitionCost(
  previous: number,
  next: number,
  switchPenalty: number,
  familySwitchPenalty: number,
): number {
  if (previous === next) return 0;
  return isTernary(previous) === isTernary(next) ? switchPenalty : familySwitchPenalty;
}

/**
 * Alarga cada nota hasta el ataque siguiente, eliminando los silencios cortos.
 *
 * Solo se aplica al hueco que sigue a cada nota en el mismo flujo. Los
 * silencios largos —una entrada que espera dos compases— se conservan: alargar
 * ahi no seria interpretacion sino invencion.
 */
function closeGaps(notes: readonly QuantizedNote[]): QuantizedNote[] {
  const byPosition = [...notes].sort((a, b) => a.position.compare(b.position));
  const result: QuantizedNote[] = [];
  for (let i = 0; i < byPosition.length; i += 1) {
    const note = byPosition[i];
    if (note === undefined) continue;
    const nextPosition = nextOnsetAfter(byPosition, i);
    if (nextPosition === undefined) {
      result.push(note);
      continue;
    }
    const end = note.position.plus(note.duration);
    const gap = nextPosition.minus(end);
    const extended = gap.isNegative || gap.isZero ? note.duration : nextPosition.minus(note.position);
    result.push({ ...note, duration: extended });
  }
  return result;
}

/** Primer ataque estrictamente posterior al de la nota `index`. */
function nextOnsetAfter(notes: readonly QuantizedNote[], index: number): Duration | undefined {
  const current = notes[index]?.position;
  if (current === undefined) return undefined;
  for (let i = index + 1; i < notes.length; i += 1) {
    const candidate = notes[i]?.position;
    if (candidate !== undefined && candidate.greaterThan(current)) return candidate;
  }
  return undefined;
}
