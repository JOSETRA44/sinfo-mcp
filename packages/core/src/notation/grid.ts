import { invalid } from '../errors.js';
import { chord, note, rest, type MusicalEvent } from '../event/event.js';
import { Pitch } from '../pitch/pitch.js';
import { Duration } from '../time/duration.js';
import { stripComments } from './comments.js';
import { parseDurationToken } from './duration-token.js';

/**
 * Notacion de rejilla para percusion y ritmos programados.
 *
 *   kick   x...x...x...x...
 *   snare  ....x.......x...
 *   hihat  x.x.x.x.x.x.x.x.
 *
 * Es el mismo dominio que la notacion de alturas, pero escrito como lo piensa
 * quien programa un ritmo: una fila por sonido y una columna por subdivision.
 * Forzar un beat de trap dentro de una sintaxis de partitura seria pelear
 * contra la forma en que se compone ese repertorio.
 *
 * Simbolos por casilla:
 *   x  golpe normal      X  golpe acentuado
 *   o  golpe suave       .  -  silencio
 */

/** Nombres de percusion General MIDI (canal 10). */
export const PERCUSSION_MAP: Readonly<Record<string, number>> = {
  kick: 36, bd: 36, bombo: 36,
  kick2: 35,
  rim: 37,
  snare: 38, sd: 38, caja: 38,
  clap: 39, palmas: 39,
  snare2: 40,
  tom_low: 45, tom_lo: 45,
  hihat: 42, hh: 42, charles: 42,
  hihat_pedal: 44,
  tom_mid: 47,
  hihat_open: 46, oh: 46,
  tom_high: 50, tom_hi: 50,
  crash: 49, plato: 49,
  ride: 51,
  tambourine: 54, pandereta: 54,
  cowbell: 56, cencerro: 56,
  shaker: 70,
  clave: 75,
};

const VELOCITY_BY_SYMBOL: Readonly<Record<string, number>> = {
  X: 112,
  x: 88,
  o: 56,
};

export interface GridLane {
  /** Nombre escrito por el usuario. */
  readonly name: string;
  /** Altura MIDI resuelta. */
  readonly pitch: Pitch;
  readonly pattern: string;
}

export interface ParsedGrid {
  readonly events: readonly MusicalEvent[];
  readonly lanes: readonly GridLane[];
  readonly stepDuration: Duration;
  readonly stepCount: number;
}

export interface GridOptions {
  /** Figura de cada casilla. Por defecto semicorchea. */
  readonly step?: Duration;
  /** Alturas adicionales o sustitutas para nombres propios. */
  readonly extraMap?: Readonly<Record<string, number>>;
}

/**
 * Interpreta una rejilla completa.
 *
 * Las filas de distinta longitud NO son un error: un patron de charles de 8
 * casillas contra uno de bombo de 16 es una poliritmia legitima, y la rejilla
 * se extiende hasta la fila mas larga repitiendo por modulo las mas cortas.
 */
export function parseGrid(source: string, options: GridOptions = {}): ParsedGrid {
  const stepDuration = options.step ?? Duration.SIXTEENTH;
  const lanes: GridLane[] = [];

  for (const rawLine of stripComments(source)) {
    const line = rawLine.trim();
    if (line === '') continue;

    const match = /^(\S+)\s+(.+)$/.exec(line);
    if (!match) {
      invalid('INVALID_STRUCTURE', `Fila de rejilla no reconocida: "${line}"`, {
        line,
        hint: 'Cada fila es "nombre patron", p.ej. "kick x...x...x...x..."',
      });
    }
    const [, name, patternText] = match as unknown as [string, string, string];

    const pattern = patternText.replace(/[\s|]/g, '');
    if (pattern === '') continue;

    for (const symbol of pattern) {
      if (!(symbol in VELOCITY_BY_SYMBOL) && symbol !== '.' && symbol !== '-') {
        invalid('INVALID_STRUCTURE', `Simbolo de rejilla desconocido: "${symbol}"`, {
          symbol,
          known: ['x', 'X', 'o', '.', '-'],
        });
      }
    }

    lanes.push({ name, pitch: resolveLanePitch(name, options.extraMap), pattern });
  }

  if (lanes.length === 0) {
    return { events: [], lanes: [], stepDuration, stepCount: 0 };
  }

  const stepCount = Math.max(...lanes.map((lane) => lane.pattern.length));
  return { events: buildEvents(lanes, stepCount, stepDuration), lanes, stepDuration, stepCount };
}

function resolveLanePitch(name: string, extra?: Readonly<Record<string, number>>): Pitch {
  const key = name.toLowerCase();
  const midi = extra?.[key] ?? PERCUSSION_MAP[key];
  if (midi !== undefined) return Pitch.fromMidi(midi);

  // Tambien se admite una altura directa, para lineas de bajo en rejilla.
  try {
    return Pitch.parse(name);
  } catch {
    return invalid('INVALID_STRUCTURE', `Sonido de percusion desconocido: "${name}"`, {
      name,
      known: Object.keys(PERCUSSION_MAP),
    });
  }
}

function buildEvents(
  lanes: readonly GridLane[],
  stepCount: number,
  stepDuration: Duration,
): MusicalEvent[] {
  const events: MusicalEvent[] = [];
  /** Silencios consecutivos pendientes de agrupar en uno solo. */
  let pendingRests = 0;

  const flushRests = (): void => {
    if (pendingRests > 0) {
      events.push(rest(stepDuration.times(pendingRests)));
      pendingRests = 0;
    }
  };

  for (let step = 0; step < stepCount; step++) {
    const hits: { pitch: Pitch; velocity: number }[] = [];

    for (const lane of lanes) {
      // Las filas cortas se repiten en bucle contra las largas.
      const symbol = lane.pattern[step % lane.pattern.length]!;
      const velocity = VELOCITY_BY_SYMBOL[symbol];
      if (velocity !== undefined) hits.push({ pitch: lane.pitch, velocity });
    }

    if (hits.length === 0) {
      pendingRests++;
      continue;
    }
    flushRests();

    // Golpes simultaneos de distinta intensidad: manda el mas fuerte, porque
    // un evento lleva una sola velocity.
    const velocity = Math.max(...hits.map((hit) => hit.velocity));
    events.push(
      hits.length === 1
        ? note(hits[0]!.pitch, stepDuration, { velocity })
        : chord(hits.map((hit) => hit.pitch), stepDuration, { velocity }),
    );
  }

  flushRests();
  return events;
}

/** Atajo para escribir la figura de casilla como token: `parseGridStep('e')`. */
export function parseGridStep(token: string): Duration {
  return parseDurationToken(token);
}
