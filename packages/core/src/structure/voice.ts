import { DomainError } from '../errors.js';
import type { MusicalEvent } from '../event/event.js';
import { rest } from '../event/event.js';
import { Duration } from '../time/duration.js';

export interface PositionedEvent {
  /** Posicion absoluta desde el inicio del movimiento. */
  readonly position: Duration;
  readonly event: MusicalEvent;
  /** Indice dentro de la voz. */
  readonly index: number;
}

/**
 * Voz: una secuencia de eventos, uno detras de otro.
 *
 * No hay compases aqui. Los eventos forman un flujo continuo y las barras se
 * DERIVAN en el momento de exportar, a partir de la Timeline. Guardar las
 * barras dentro de la voz obligaria a partir notas y crear ligaduras en cada
 * insercion, y a rehacerlo todo si cambia un compas a mitad de obra.
 *
 * Mutable a proposito: es una entidad, no un valor. Una sinfonia tiene
 * cientos de miles de eventos y copiar la voz entera en cada `append` seria
 * cuadratico. Los eventos que contiene si son inmutables.
 */
export class Voice {
  readonly id: string;
  private readonly items: MusicalEvent[] = [];
  /** Suma incremental; recalcularla en cada consulta seria O(n). */
  private total: Duration = Duration.ZERO;

  constructor(id: string) {
    this.id = id;
  }

  // -------------------------------------------------------------- escritura

  append(...events: readonly MusicalEvent[]): this {
    for (const event of events) {
      if (event.duration.isNegative || event.duration.isZero) {
        throw new DomainError(
          'INVALID_STRUCTURE',
          'Un evento debe tener duracion positiva',
          { voice: this.id, duration: event.duration.toString() },
        );
      }
      this.items.push(event);
      this.total = this.total.plus(event.duration);
    }
    return this;
  }

  /**
   * Rellena con silencio hasta `position` y devuelve cuanto silencio se anadio.
   * Si la voz ya pasa de esa posicion no hace nada.
   */
  padTo(position: Duration): Duration {
    const gap = position.minus(this.total);
    if (gap.isNegative || gap.isZero) return Duration.ZERO;
    this.append(rest(gap));
    return gap;
  }

  /** Sustituye todo el contenido. */
  replaceAll(events: readonly MusicalEvent[]): this {
    this.items.length = 0;
    this.total = Duration.ZERO;
    return this.append(...events);
  }

  clear(): this {
    this.items.length = 0;
    this.total = Duration.ZERO;
    return this;
  }

  // --------------------------------------------------------------- lectura

  get events(): readonly MusicalEvent[] {
    return this.items;
  }

  get length(): number {
    return this.items.length;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** Duracion total sonante de la voz. */
  get duration(): Duration {
    return this.total;
  }

  at(index: number): MusicalEvent | undefined {
    return this.items[index];
  }

  /** Eventos con su posicion absoluta calculada. */
  positioned(): PositionedEvent[] {
    const result: PositionedEvent[] = [];
    let position = Duration.ZERO;
    for (const [index, event] of this.items.entries()) {
      result.push({ position, event, index });
      position = position.plus(event.duration);
    }
    return result;
  }

  /**
   * Eventos que empiezan dentro de `[from, to)`.
   * No parte eventos a caballo: devuelve los que ARRANCAN en el rango.
   */
  between(from: Duration, to: Duration): PositionedEvent[] {
    return this.positioned().filter(
      ({ position }) => !position.lessThan(from) && position.lessThan(to),
    );
  }

  /** Evento que suena en la posicion dada, o null si no hay ninguno. */
  eventAt(position: Duration): PositionedEvent | null {
    let current = Duration.ZERO;
    for (const [index, event] of this.items.entries()) {
      const next = current.plus(event.duration);
      if (!position.lessThan(current) && position.lessThan(next)) {
        return { position: current, event, index };
      }
      current = next;
    }
    return null;
  }

  clone(id: string = this.id): Voice {
    const copy = new Voice(id);
    copy.append(...this.items);
    return copy;
  }

  [Symbol.iterator](): Iterator<MusicalEvent> {
    return this.items[Symbol.iterator]();
  }
}
