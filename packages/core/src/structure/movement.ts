import { DomainError } from '../errors.js';
import type { Instrument } from '../instrument/instrument.js';
import { Duration } from '../time/duration.js';
import { Part } from './part.js';
import { FormPlan } from './section.js';
import { Timeline } from './timeline.js';

/**
 * Movimiento: una pieza completa con su propia linea de tiempo y sus partes.
 *
 * Existe desde el primer dia aunque una cancion solo tenga uno. Meter este
 * nivel despues obligaria a tocar todas las herramientas y todos los
 * exportadores; tenerlo vacio no cuesta nada.
 */
export class Movement {
  readonly id: string;
  title: string;
  /** Indicacion de caracter: "Allegro con brio", "Andante cantabile". */
  marking: string | undefined;
  readonly timeline: Timeline;
  /** Plan formal: las secciones del movimiento en orden. */
  readonly form = new FormPlan();
  private readonly partMap = new Map<string, Part>();

  constructor(id: string, title: string, timeline: Timeline = new Timeline()) {
    this.id = id;
    this.title = title;
    this.marking = undefined;
    this.timeline = timeline;
  }

  // ---------------------------------------------------------------- partes

  get parts(): readonly Part[] {
    return [...this.partMap.values()];
  }

  get partIds(): readonly string[] {
    return [...this.partMap.keys()];
  }

  part(id: string): Part {
    const found = this.partMap.get(id);
    if (!found) {
      throw new DomainError('NOT_FOUND', `El movimiento "${this.id}" no tiene la parte "${id}"`, {
        movement: this.id,
        part: id,
        available: this.partIds,
      });
    }
    return found;
  }

  hasPart(id: string): boolean {
    return this.partMap.has(id);
  }

  addPart(id: string, instrument: Instrument, name?: string): Part {
    if (this.partMap.has(id)) {
      throw new DomainError('INVALID_STRUCTURE', `La parte "${id}" ya existe`, {
        movement: this.id,
        part: id,
      });
    }
    const part = new Part(id, instrument, name);
    this.partMap.set(id, part);
    return part;
  }

  removePart(id: string): boolean {
    return this.partMap.delete(id);
  }

  // --------------------------------------------------------------- lectura

  /** Duracion del movimiento: la de su parte mas larga. */
  get duration(): Duration {
    let longest = Duration.ZERO;
    for (const part of this.partMap.values()) {
      if (part.duration.greaterThan(longest)) longest = part.duration;
    }
    return longest;
  }

  /** Compases necesarios para contener el movimiento; el ultimo puede ir a medias. */
  get measureCount(): number {
    return this.timeline.measureStarts(this.duration).length;
  }

  get eventCount(): number {
    let total = 0;
    for (const part of this.partMap.values()) total += part.eventCount;
    return total;
  }

  get isEmpty(): boolean {
    return this.partMap.size === 0 || this.parts.every((part) => part.isEmpty);
  }
}
