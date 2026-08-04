import { invalid } from '../errors.js';
import { Duration } from '../time/duration.js';

/**
 * Figuras base de SinfoScript. Una letra por figura, sin ambiguedad.
 * `t` es fusa (32) y `x` semifusa (64); `s` queda para la semicorchea (16),
 * que es muchisimo mas frecuente y merece la letra corta.
 */
const BASE_TOKENS: Readonly<Record<string, Duration>> = {
  w: Duration.WHOLE,
  h: Duration.HALF,
  q: Duration.QUARTER,
  e: Duration.EIGHTH,
  s: Duration.SIXTEENTH,
  t: Duration.THIRTY_SECOND,
  x: Duration.SIXTY_FOURTH,
};

/** Orden de preferencia al escribir: de larga a corta. */
const BASE_ORDER = ['w', 'h', 'q', 'e', 's', 't', 'x'] as const;

/**
 * En un grupo irregular de `n` notas, cuantas caben normalmente.
 * Un tresillo ocupa el sitio de 2, un quintillo el de 4, un septillo el de 4.
 */
function normalCountFor(actual: number): number {
  return 2 ** Math.floor(Math.log2(actual));
}

const DURATION_PATTERN = /^([whqestx])(\.*)(\d*)$/;

/**
 * Interpreta un token de duracion: `q`, `q.`, `q..`, `e3`, `s5`.
 *
 * - letra: figura base
 * - puntos: cada uno anade la mitad del valor anterior
 * - numero: grupo irregular de esa cantidad (3 = tresillo, 5 = quintillo)
 */
export function parseDurationToken(token: string): Duration {
  const match = DURATION_PATTERN.exec(token);
  if (!match) {
    invalid('INVALID_DURATION', `Duracion no reconocida: "${token}"`, {
      token,
      expected: 'w|h|q|e|s|t|x con puntos opcionales y numero de grupo irregular, p.ej. q. o e3',
    });
  }
  const [, base, dots, tupletText] = match as unknown as [string, string, string, string];

  let duration = BASE_TOKENS[base]!;
  if (dots.length > 0) duration = duration.dotted(dots.length);

  if (tupletText !== '') {
    const actual = Number.parseInt(tupletText, 10);
    if (actual < 2) {
      invalid('INVALID_DURATION', `Un grupo irregular necesita al menos 2 notas: "${token}"`, {
        token,
      });
    }
    duration = duration.tuplet(actual, normalCountFor(actual));
  }

  return duration;
}

/** Nombre de la figura en MusicXML y en la mayoria de formatos de partitura. */
const NOTE_TYPE_NAMES: Readonly<Record<string, string>> = {
  w: 'whole',
  h: 'half',
  q: 'quarter',
  e: 'eighth',
  s: '16th',
  t: '32nd',
  x: '64th',
};

export interface TupletShape {
  /** Cuantas notas se tocan. 3 en un tresillo. */
  readonly actual: number;
  /** En el sitio de cuantas. 2 en un tresillo. */
  readonly normal: number;
}

/**
 * Una duracion descompuesta en los tres datos que pide cualquier formato de
 * partitura: que figura es, cuantos puntillos lleva y si va en grupo irregular.
 */
export interface DurationShape {
  /** Letra de SinfoScript: w h q e s t x. */
  readonly base: string;
  /** Nombre de la figura: whole, half, quarter, eighth, 16th... */
  readonly noteType: string;
  readonly dots: number;
  readonly tuplet: TupletShape | null;
}

/**
 * Descompone una duracion en figura, puntillos y grupo irregular.
 *
 * MusicXML, LilyPond y ABC piden todos exactamente estos tres datos por
 * separado: `<type>eighth</type>` mas `<dot/>` mas `<time-modification>`. Se
 * calcula una sola vez aqui en vez de que cada exportador reinvente la
 * busqueda y la equivoque de forma distinta.
 *
 * Devuelve null si la duracion no cabe en una sola figura; en ese caso hay que
 * partirla con `splitIntoWritable`.
 */
export function analyzeDuration(duration: Duration): DurationShape | null {
  for (const base of BASE_ORDER) {
    const baseDuration = BASE_TOKENS[base]!;
    for (let dots = 0; dots <= 2; dots++) {
      const dotted = baseDuration.dotted(dots);
      if (dotted.equals(duration)) {
        return { base, noteType: NOTE_TYPE_NAMES[base]!, dots, tuplet: null };
      }

      for (const actual of [3, 5, 6, 7, 9, 11, 13]) {
        const normal = normalCountFor(actual);
        if (dotted.tuplet(actual, normal).equals(duration)) {
          return { base, noteType: NOTE_TYPE_NAMES[base]!, dots, tuplet: { actual, normal } };
        }
      }
    }
  }
  return null;
}

/**
 * Escribe una duracion como token de SinfoScript.
 *
 * Devuelve null si la duracion no se puede escribir con una sola figura: quien
 * llame decide si partirla en varias atadas o si es un error.
 */
export function formatDurationToken(duration: Duration): string | null {
  const shape = analyzeDuration(duration);
  if (!shape) return null;
  return `${shape.base}${'.'.repeat(shape.dots)}${shape.tuplet ? shape.tuplet.actual : ''}`;
}

/** true si la duracion se puede escribir con una sola figura. */
export function isWritableDuration(duration: Duration): boolean {
  return formatDurationToken(duration) !== null;
}

/**
 * Figuras para partir, de mayor a menor: SIN puntillo y sin grupos
 * irregulares.
 *
 * Con puntillos, el reparto voraz de una espera de ocho compases empezaba por
 * la redonda de doble puntillo (7/4) y salian cinco simbolos raros donde un
 * copista escribe ocho silencios de redonda. Toda duracion con denominador
 * potencia de dos se descompone exactamente en figuras simples, que es la
 * respuesta convencional y ademas la predecible.
 *
 * Las duraciones con puntillo no pierden nada: `formatDurationToken` ya las
 * reconoce enteras y nunca llegan a partirse.
 */
const WRITABLE_DESCENDING: readonly Duration[] = BASE_ORDER.map(
  (base) => BASE_TOKENS[base]!,
).sort((a, b) => b.compare(a));

/**
 * Parte una duracion en figuras que si se pueden escribir.
 *
 * No toda duracion cabe en un simbolo: no existe el silencio de ocho redondas
 * (los ocho compases de espera de una trompa que entra tarde), ni la figura
 * que valga 5/16. La notacion real resuelve esto con varias figuras seguidas,
 * y esto hace lo mismo: toma la mayor que quepa y repite.
 *
 * Si la duracion ya es escribible, se devuelve tal cual: un tresillo no se
 * parte en nada.
 */
export function splitIntoWritable(duration: Duration): Duration[] {
  if (duration.isZero || duration.isNegative) return [];
  if (isWritableDuration(duration)) return [duration];

  const pieces: Duration[] = [];
  let remaining = duration;

  // Cota de seguridad: con figuras hasta la semifusa, cualquier duracion
  // razonable se agota en pocas decenas de pasos.
  for (let guard = 0; guard < 512 && !remaining.isZero; guard++) {
    const fits = WRITABLE_DESCENDING.find((candidate) => !candidate.greaterThan(remaining));
    if (!fits) break;
    pieces.push(fits);
    remaining = remaining.minus(fits);
  }

  // Un resto imposible de cubrir (un tresillo suelto dentro de un hueco
  // irregular) se devuelve entero: mejor un simbolo raro que perder tiempo.
  if (!remaining.isZero) pieces.push(remaining);
  return pieces;
}
