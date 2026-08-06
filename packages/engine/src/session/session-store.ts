import type { Score } from '@sinfo/core';
import type { Motif } from '@sinfo/generate';
import type { Performance } from '@sinfo/perform';
import { fail } from '../errors.js';

export interface ScoreSession {
  readonly score: Score;
  readonly createdAt: number;
  /** Se actualiza en cada acceso; permite descartar las mas antiguas. */
  lastAccessedAt: number;
  /** Registro breve de lo hecho, para que el agente recupere el hilo. */
  readonly history: string[];
  /**
   * Motivos de la obra. Viven en la sesion igual que la partitura: el agente
   * crea un tema, lo desarrolla varias veces y escribe la variante que le
   * gusta, sin reenviar las notas en cada paso.
   */
  readonly motifs: Map<string, Motif>;
  /**
   * Interpretacion de la que salio la partitura, si vino de una transcripcion.
   *
   * Se guarda para poder volver a cuantizar sin releer nada. Importa mas de lo
   * que parece: afinar la cuantizacion es prueba y error —mas o menos
   * subdivision, ligar o medir los silencios— y sin esto cada intento
   * obligaria a repetir la lectura entera del archivo.
   */
  performance?: Performance | undefined;
}

/**
 * Almacen de sesiones.
 *
 * Es una interfaz y no una clase concreta porque el sitio donde vive la
 * partitura es exactamente lo que va a cambiar al crecer: hoy memoria del
 * proceso, manana disco o Redis si el servidor pasa a HTTP con varias
 * instancias. Nada mas del motor tiene que enterarse de ese cambio.
 */
export interface SessionStore {
  create(score: Score): ScoreSession;
  get(scoreId: string): ScoreSession;
  has(scoreId: string): boolean;
  delete(scoreId: string): boolean;
  list(): readonly ScoreSession[];
  readonly size: number;
}

export interface InMemorySessionStoreOptions {
  /**
   * Sesiones simultaneas antes de descartar la mas antigua sin usar.
   * Una sinfonia ocupa memoria de verdad; sin tope, un servidor de larga
   * duracion acaba agotandola.
   */
  readonly maxSessions?: number;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, ScoreSession>();
  private readonly maxSessions: number;

  constructor(options: InMemorySessionStoreOptions = {}) {
    this.maxSessions = options.maxSessions ?? 32;
  }

  create(score: Score): ScoreSession {
    if (this.sessions.size >= this.maxSessions) this.evictOldest();

    const now = Date.now();
    const session: ScoreSession = {
      score,
      createdAt: now,
      lastAccessedAt: now,
      history: [],
      motifs: new Map(),
    };
    this.sessions.set(score.id, session);
    return session;
  }

  get(scoreId: string): ScoreSession {
    const session = this.sessions.get(scoreId);
    if (!session) {
      fail('SESSION_NOT_FOUND', `No hay ninguna partitura abierta con id "${scoreId}"`, {
        scoreId,
        open: [...this.sessions.keys()],
      });
    }
    session.lastAccessedAt = Date.now();
    return session;
  }

  has(scoreId: string): boolean {
    return this.sessions.has(scoreId);
  }

  delete(scoreId: string): boolean {
    return this.sessions.delete(scoreId);
  }

  list(): readonly ScoreSession[] {
    return [...this.sessions.values()].sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  }

  get size(): number {
    return this.sessions.size;
  }

  private evictOldest(): void {
    let oldestId: string | undefined;
    let oldestTime = Number.POSITIVE_INFINITY;
    for (const [id, session] of this.sessions) {
      if (session.lastAccessedAt < oldestTime) {
        oldestTime = session.lastAccessedAt;
        oldestId = id;
      }
    }
    if (oldestId !== undefined) this.sessions.delete(oldestId);
  }
}

/** Anota una accion en el historial, recortandolo para que no crezca sin fin. */
export function recordAction(session: ScoreSession, action: string): void {
  session.history.push(action);
  if (session.history.length > 100) session.history.splice(0, session.history.length - 100);
}
