import { DomainError } from '../errors.js';
import { Duration } from '../time/duration.js';
import { Movement } from './movement.js';
import { Timeline } from './timeline.js';

export interface ScoreMetadata {
  title: string;
  composer?: string;
  /** Texto libre: dedicatoria, año, notas de programa. */
  subtitle?: string;
  copyright?: string;
}

/**
 * Partitura: la obra completa.
 *
 * Es la RAIZ del agregado y la unidad que el servidor guarda entre llamadas.
 * Un agente no puede mandar una sinfonia entera como argumento de una
 * herramienta, asi que la partitura vive aqui y las herramientas la mutan
 * paso a paso. Esa es la diferencia entre poder escribir ocho compases y
 * poder escribir una sinfonia.
 *
 * Toda obra tiene al menos un movimiento: una cancion es una obra de un
 * movimiento, no un caso aparte.
 */
export class Score {
  readonly id: string;
  readonly metadata: ScoreMetadata;
  private readonly movementList: Movement[] = [];

  constructor(id: string, metadata: ScoreMetadata) {
    this.id = id;
    this.metadata = { ...metadata };
    this.addMovement('m1', metadata.title);
  }

  // ----------------------------------------------------------- movimientos

  get movements(): readonly Movement[] {
    return this.movementList;
  }

  get movementCount(): number {
    return this.movementList.length;
  }

  /** Primer movimiento. Atajo para el caso de un solo movimiento. */
  get first(): Movement {
    return this.movementList[0]!;
  }

  movement(id: string): Movement {
    const found = this.movementList.find((movement) => movement.id === id);
    if (!found) {
      throw new DomainError('NOT_FOUND', `La partitura no tiene el movimiento "${id}"`, {
        score: this.id,
        movement: id,
        available: this.movementList.map((m) => m.id),
      });
    }
    return found;
  }

  hasMovement(id: string): boolean {
    return this.movementList.some((movement) => movement.id === id);
  }

  addMovement(id: string, title: string, timeline?: Timeline): Movement {
    if (this.hasMovement(id)) {
      throw new DomainError('INVALID_STRUCTURE', `El movimiento "${id}" ya existe`, {
        score: this.id,
        movement: id,
      });
    }
    // Un movimiento nuevo hereda compas, tempo y tonalidad del anterior: es lo
    // que se espera por defecto, y siempre se pueden cambiar despues.
    const inherited = timeline ?? this.movementList.at(-1)?.timeline.clone() ?? new Timeline();
    const movement = new Movement(id, title, inherited);
    this.movementList.push(movement);
    return movement;
  }

  removeMovement(id: string): boolean {
    if (this.movementList.length === 1) {
      throw new DomainError('INVALID_STRUCTURE', 'Una partitura no puede quedarse sin movimientos', {
        score: this.id,
      });
    }
    const index = this.movementList.findIndex((movement) => movement.id === id);
    if (index < 0) return false;
    this.movementList.splice(index, 1);
    return true;
  }

  // --------------------------------------------------------------- lectura

  /** Suma de la duracion de todos los movimientos. */
  get duration(): Duration {
    let total = Duration.ZERO;
    for (const movement of this.movementList) total = total.plus(movement.duration);
    return total;
  }

  get eventCount(): number {
    let total = 0;
    for (const movement of this.movementList) total += movement.eventCount;
    return total;
  }

  get isEmpty(): boolean {
    return this.movementList.every((movement) => movement.isEmpty);
  }

  /**
   * Resumen compacto para devolver al agente.
   *
   * Lo que NUNCA se devuelve es la partitura entera: un movimiento sinfonico
   * son decenas de miles de eventos y no cabe en el contexto del modelo. El
   * agente pide fragmentos concretos cuando los necesita.
   */
  summary(): ScoreSummary {
    return {
      id: this.id,
      title: this.metadata.title,
      composer: this.metadata.composer,
      movementCount: this.movementCount,
      eventCount: this.eventCount,
      movements: this.movementList.map((movement) => ({
        id: movement.id,
        title: movement.title,
        marking: movement.marking,
        measures: movement.measureCount,
        timeSignature: movement.timeline.timeSignatureAt(Duration.ZERO).toString(),
        tempo: movement.timeline.tempoAt(Duration.ZERO).toString(),
        key: movement.timeline.keyAt(Duration.ZERO).name,
        parts: movement.parts.map((part) => ({
          id: part.id,
          name: part.name,
          instrument: part.instrument.id,
          voices: part.voiceIds.length,
          events: part.eventCount,
          measures: movement.timeline.measureStarts(part.duration).length,
        })),
      })),
    };
  }
}

export interface ScoreSummary {
  id: string;
  title: string;
  composer?: string | undefined;
  movementCount: number;
  eventCount: number;
  movements: {
    id: string;
    title: string;
    marking: string | undefined;
    measures: number;
    timeSignature: string;
    tempo: string;
    key: string;
    parts: {
      id: string;
      name: string;
      instrument: string;
      voices: number;
      events: number;
      measures: number;
    }[];
  }[];
}
