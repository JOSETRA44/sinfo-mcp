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

/**
 * Escribe una duracion como token de SinfoScript.
 *
 * Busca entre las combinaciones representables (figura x puntos x grupo
 * irregular). Devuelve null si la duracion no se puede escribir con la
 * notacion: quien llame decide si partirla en varias atadas o si es un error.
 */
export function formatDurationToken(duration: Duration): string | null {
  for (const base of BASE_ORDER) {
    const baseDuration = BASE_TOKENS[base]!;
    for (let dots = 0; dots <= 2; dots++) {
      const dotted = baseDuration.dotted(dots);
      if (dotted.equals(duration)) return `${base}${'.'.repeat(dots)}`;

      for (const actual of [3, 5, 6, 7, 9, 11, 13]) {
        if (dotted.tuplet(actual, normalCountFor(actual)).equals(duration)) {
          return `${base}${'.'.repeat(dots)}${actual}`;
        }
      }
    }
  }
  return null;
}

/** true si la duracion se puede escribir con una sola figura. */
export function isWritableDuration(duration: Duration): boolean {
  return formatDurationToken(duration) !== null;
}
