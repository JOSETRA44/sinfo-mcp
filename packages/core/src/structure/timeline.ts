import { KeySignature } from '../pitch/key-signature.js';
import { Duration } from '../time/duration.js';
import { Tempo } from '../time/tempo.js';
import { TimeSignature } from '../time/time-signature.js';

export interface TimedValue<T> {
  readonly at: Duration;
  readonly value: T;
}

/**
 * Linea de tiempo global del movimiento: compas, tempo y armadura vigentes en
 * cada punto.
 *
 * Esta informacion es del MOVIMIENTO, no de cada parte: cuando el director
 * cambia a 6/8, cambia para todos. Guardarla una sola vez evita que dos partes
 * puedan discrepar sobre en que compas estan, que es un estado imposible que
 * ningun exportador sabria resolver.
 *
 * Las posiciones son duraciones absolutas desde el inicio del movimiento.
 */
export class Timeline {
  private readonly timeSignatures: TimedValue<TimeSignature>[];
  private readonly tempos: TimedValue<Tempo>[];
  private readonly keys: TimedValue<KeySignature>[];

  constructor(
    initialTimeSignature: TimeSignature = TimeSignature.COMMON,
    initialTempo: Tempo = Tempo.of(100),
    initialKey: KeySignature = KeySignature.C_MAJOR,
  ) {
    this.timeSignatures = [{ at: Duration.ZERO, value: initialTimeSignature }];
    this.tempos = [{ at: Duration.ZERO, value: initialTempo }];
    this.keys = [{ at: Duration.ZERO, value: initialKey }];
  }

  // -------------------------------------------------------------- escritura

  setTimeSignature(at: Duration, value: TimeSignature): void {
    upsert(this.timeSignatures, at, value);
  }

  setTempo(at: Duration, value: Tempo): void {
    upsert(this.tempos, at, value);
  }

  setKey(at: Duration, value: KeySignature): void {
    upsert(this.keys, at, value);
  }

  // --------------------------------------------------------------- lectura

  timeSignatureAt(position: Duration): TimeSignature {
    return valueAt(this.timeSignatures, position);
  }

  tempoAt(position: Duration): Tempo {
    return valueAt(this.tempos, position);
  }

  keyAt(position: Duration): KeySignature {
    return valueAt(this.keys, position);
  }

  get timeSignatureChanges(): readonly TimedValue<TimeSignature>[] {
    return this.timeSignatures;
  }

  get tempoChanges(): readonly TimedValue<Tempo>[] {
    return this.tempos;
  }

  get keyChanges(): readonly TimedValue<KeySignature>[] {
    return this.keys;
  }

  // ------------------------------------------------------------- compases

  /**
   * Inicio de cada compas hasta cubrir `until`, respetando los cambios de
   * compas por el camino.
   *
   * Los exportadores a partitura necesitan esto para colocar las barras; el
   * calculo es delicado (un cambio de compas a mitad de obra desplaza todas
   * las barras siguientes) y por eso vive aqui una sola vez.
   */
  measureStarts(until: Duration): Duration[] {
    const starts: Duration[] = [];
    let position = Duration.ZERO;
    // Cota de seguridad: una obra de 100000 compases es un error, no musica.
    for (let guard = 0; position.lessThan(until) && guard < 100_000; guard++) {
      starts.push(position);
      position = position.plus(this.timeSignatureAt(position).measureDuration);
    }
    return starts;
  }

  /** Numero de compas (empezando en 1) que contiene la posicion dada. */
  measureNumberAt(position: Duration): number {
    let current = Duration.ZERO;
    let measure = 1;
    for (let guard = 0; guard < 100_000; guard++) {
      const next = current.plus(this.timeSignatureAt(current).measureDuration);
      // El compas cubre [current, next): el limite superior ya es el siguiente.
      if (position.lessThan(next)) return measure;
      current = next;
      measure++;
    }
    return measure;
  }

  /** Posicion absoluta donde empieza el compas `number` (base 1). */
  measureStart(number: number): Duration {
    let position = Duration.ZERO;
    for (let measure = 1; measure < number; measure++) {
      position = position.plus(this.timeSignatureAt(position).measureDuration);
    }
    return position;
  }

  clone(): Timeline {
    const copy = new Timeline();
    copy.timeSignatures.length = 0;
    copy.tempos.length = 0;
    copy.keys.length = 0;
    copy.timeSignatures.push(...this.timeSignatures);
    copy.tempos.push(...this.tempos);
    copy.keys.push(...this.keys);
    return copy;
  }
}

/** Inserta o reemplaza manteniendo el array ordenado por posicion. */
function upsert<T>(entries: TimedValue<T>[], at: Duration, value: T): void {
  const index = entries.findIndex((entry) => entry.at.equals(at));
  if (index >= 0) {
    entries[index] = { at, value };
    return;
  }
  entries.push({ at, value });
  entries.sort((a, b) => a.at.compare(b.at));
}

/** Ultimo valor cuya posicion no supera la consultada. */
function valueAt<T>(entries: readonly TimedValue<T>[], position: Duration): T {
  let result = entries[0]!.value;
  for (const entry of entries) {
    if (entry.at.greaterThan(position)) break;
    result = entry.value;
  }
  return result;
}
