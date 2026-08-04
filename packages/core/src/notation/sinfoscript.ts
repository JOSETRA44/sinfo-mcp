import { invalid } from '../errors.js';
import type { Articulation } from '../event/articulation.js';
import { DYNAMICS, type Dynamic } from '../event/dynamics.js';
import { chord, note, rest, type EventOptions, type MusicalEvent } from '../event/event.js';
import { Pitch } from '../pitch/pitch.js';
import { Duration } from '../time/duration.js';
import { stripComments } from './comments.js';
import { formatDurationToken, parseDurationToken, splitIntoWritable } from './duration-token.js';

/**
 * SinfoScript: notacion compacta pensada para que la escriba y la lea un
 * modelo de lenguaje.
 *
 *   mf  c4/q  e4/q  g4/h  |  a4/e. g4/s  f4/q~  f4/h
 *
 * Por que no JSON: una sinfonia en JSON son megabytes de `{"pitches":[{"step"
 * ...}]}` que no caben en el contexto del modelo y que ademas el modelo
 * escribe mal. Una linea de SinfoScript cuesta unos pocos tokens y se lee de
 * un vistazo.
 *
 * Gramatica:
 *   nota       c4/q        altura cientifica + `/` + figura
 *   silencio   r/h
 *   acorde     [c4,e4,g4]/h
 *   dinamica   mf          suelta; rige hasta la siguiente
 *   ligadura   c4/q~       la `~` ata con el evento siguiente
 *   articul.   c4/q+stacc+accent
 *   compas     |           separador opcional, se valida si se pide
 *   comentario # hasta el final de la linea
 */

export interface ParsedVoice {
  readonly events: readonly MusicalEvent[];
  /**
   * Indice del evento ante el que aparecia cada `|`.
   * Permite comprobar despues que los compases cuadran.
   */
  readonly barlines: readonly number[];
}

const DYNAMIC_SET = new Set<string>(DYNAMICS);

const ARTICULATION_ALIASES: Readonly<Record<string, Articulation>> = {
  stacc: 'staccato',
  staccato: 'staccato',
  staccatissimo: 'staccatissimo',
  stacciss: 'staccatissimo',
  ten: 'tenuto',
  tenuto: 'tenuto',
  accent: 'accent',
  acc: 'accent',
  marcato: 'marcato',
  marc: 'marcato',
  legato: 'legato',
  leg: 'legato',
  portato: 'portato',
  port: 'portato',
  fermata: 'fermata',
  ferm: 'fermata',
};

/**
 * Interpreta una voz completa.
 *
 * `startingDynamic` es la dinamica vigente al entrar, para que un fragmento
 * escrito a continuacion de otro no reinicie a mezzoforte sin querer.
 */
export function parseVoice(source: string, startingDynamic?: Dynamic): ParsedVoice {
  const events: MusicalEvent[] = [];
  const barlines: number[] = [];
  let currentDynamic: Dynamic | undefined = startingDynamic;
  /** La dinamica solo se marca en el primer evento tras el cambio. */
  let dynamicPending = startingDynamic !== undefined;

  for (const token of tokenize(source)) {
    if (token === '|' || token === '||') {
      barlines.push(events.length);
      continue;
    }

    if (DYNAMIC_SET.has(token)) {
      currentDynamic = token as Dynamic;
      dynamicPending = true;
      continue;
    }

    const options: EventOptions = {};
    const event = parseEvent(token, dynamicPending ? currentDynamic : undefined, options);
    events.push(event);
    dynamicPending = false;
  }

  return { events, barlines };
}

/** Divide en tokens respetando los corchetes de acorde y quitando comentarios. */
function tokenize(source: string): string[] {
  const withoutComments = stripComments(source).join(' ');

  const tokens: string[] = [];
  let current = '';
  let insideChord = false;

  for (const char of withoutComments) {
    if (char === '[') insideChord = true;
    else if (char === ']') insideChord = false;

    if (!insideChord && /\s/.test(char)) {
      if (current !== '') tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current !== '') tokens.push(current);
  return tokens;
}

function parseEvent(
  token: string,
  dynamic: Dynamic | undefined,
  base: EventOptions,
): MusicalEvent {
  const slash = token.lastIndexOf('/');
  if (slash < 0) {
    invalid('INVALID_STRUCTURE', `Token no reconocido: "${token}"`, {
      token,
      hint: 'Una nota lleva altura y figura separadas por barra, p.ej. c4/q. Una dinamica va suelta: mf.',
    });
  }

  const pitchPart = token.slice(0, slash);
  let rest_ = token.slice(slash + 1);

  // Ligadura al final.
  let tie: 'start' | undefined;
  if (rest_.endsWith('~')) {
    tie = 'start';
    rest_ = rest_.slice(0, -1);
  }

  // Articulaciones tras el signo mas.
  const parts = rest_.split('+');
  const durationToken = parts[0]!;
  const articulations = parts.slice(1).map((name) => {
    const resolved = ARTICULATION_ALIASES[name.toLowerCase()];
    if (resolved === undefined) {
      invalid('INVALID_STRUCTURE', `Articulacion desconocida: "${name}"`, {
        name,
        known: [...new Set(Object.values(ARTICULATION_ALIASES))],
      });
    }
    return resolved;
  });

  const duration = parseDurationToken(durationToken);

  const options: EventOptions = { ...base };
  if (dynamic !== undefined) Object.assign(options, { dynamic });
  if (articulations.length > 0) Object.assign(options, { articulations });
  if (tie !== undefined) Object.assign(options, { tie });

  if (pitchPart === 'r' || pitchPart === 'R') {
    // Un silencio no lleva dinamica ni articulacion: no suena.
    return rest(duration);
  }

  if (pitchPart.startsWith('[')) {
    if (!pitchPart.endsWith(']')) {
      invalid('INVALID_STRUCTURE', `Acorde sin cerrar: "${token}"`, { token });
    }
    const names = pitchPart
      .slice(1, -1)
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '');
    if (names.length === 0) {
      invalid('INVALID_STRUCTURE', `Acorde vacio: "${token}"`, { token });
    }
    return chord(names.map((name) => Pitch.parse(name)), duration, options);
  }

  return note(Pitch.parse(pitchPart), duration, options);
}

// ------------------------------------------------------------ serializacion

export interface SerializeOptions {
  /** Inserta `|` cada vez que se completa un compas de esta duracion. */
  readonly measureDuration?: Duration;
  /** Dinamica que ya rige, para no repetirla al principio. */
  readonly startingDynamic?: Dynamic;
}

/**
 * Escribe eventos como SinfoScript.
 *
 * `parseVoice(serializeVoice(x))` devuelve los mismos eventos: ese ida y
 * vuelta esta cubierto por tests, porque es lo que garantiza que el agente
 * pueda leer una parte, modificarla y volver a escribirla sin perder nada.
 */
export function serializeVoice(
  events: readonly MusicalEvent[],
  options: SerializeOptions = {},
): string {
  const pieces: string[] = [];
  let currentDynamic = options.startingDynamic;
  let position = Duration.ZERO;
  let nextBarline = options.measureDuration;

  for (const event of events) {
    if (nextBarline !== undefined && !position.lessThan(nextBarline)) {
      pieces.push('|');
      nextBarline = nextBarline.plus(options.measureDuration!);
    }

    if (event.dynamic !== undefined && event.dynamic !== currentDynamic) {
      pieces.push(event.dynamic);
      currentDynamic = event.dynamic;
    }

    pieces.push(serializeEvent(event));
    position = position.plus(event.duration);
  }

  return pieces.join(' ');
}

/**
 * Escribe un evento, partiendolo en varios si su duracion no cabe en una
 * figura. Los silencios se reparten sin mas; las notas quedan atadas entre si
 * para que sigan sonando como una sola.
 */
function serializeEvent(event: MusicalEvent): string {
  if (formatDurationToken(event.duration) !== null) return serializeSingle(event, event.duration);

  const pieces = splitIntoWritable(event.duration);
  const isRestEvent = event.pitches.length === 0;

  return pieces
    .map((piece, index) => {
      const isLast = index === pieces.length - 1;
      const tied: MusicalEvent =
        isRestEvent || isLast ? event : { ...event, tie: 'start' as const };
      return serializeSingle(tied, piece);
    })
    .join(' ');
}

function serializeSingle(event: MusicalEvent, duration: Duration): string {
  const durationToken = formatDurationToken(duration);
  if (durationToken === null) {
    invalid(
      'INVALID_DURATION',
      `La duracion ${duration.toString()} no se puede escribir con ninguna figura`,
      { duration: duration.toString() },
    );
  }

  let head: string;
  if (event.pitches.length === 0) head = 'r';
  else if (event.pitches.length === 1) head = event.pitches[0]!.name;
  else head = `[${event.pitches.map((p) => p.name).join(',')}]`;

  let tail = durationToken;
  for (const articulation of event.articulations ?? []) {
    tail += `+${articulation}`;
  }
  if (event.tie === 'start' || event.tie === 'continue') tail += '~';

  return `${head}/${tail}`;
}

// -------------------------------------------------------------- validacion

export interface BarlineIssue {
  /** Numero de compas segun las `|` escritas, empezando en 1. */
  readonly measure: number;
  readonly expected: string;
  readonly actual: string;
  readonly message: string;
}

/**
 * Comprueba que lo escrito entre `|` suma exactamente un compas.
 *
 * Es la comprobacion mas rentable de todo el parser: el fallo mas frecuente
 * de un modelo escribiendo musica es meter demasiados o muy pocos tiempos en
 * un compas, y sin las barras ese error pasa desapercibido hasta que la
 * partitura sale descuadrada.
 */
export function validateBarlines(
  parsed: ParsedVoice,
  measureDuration: Duration,
): BarlineIssue[] {
  if (parsed.barlines.length === 0) return [];

  const issues: BarlineIssue[] = [];
  const boundaries = [...parsed.barlines, parsed.events.length];
  let previousIndex = 0;

  for (const [measureIndex, boundary] of boundaries.entries()) {
    // Una `|` inicial solo marca el comienzo, no cierra ningun compas.
    if (boundary === 0) {
      previousIndex = 0;
      continue;
    }

    let total = Duration.ZERO;
    for (let i = previousIndex; i < boundary; i++) {
      total = total.plus(parsed.events[i]!.duration);
    }

    // El ultimo tramo puede quedar incompleto: es un compas a medias, valido.
    const isLast = boundary === parsed.events.length;
    if (!total.equals(measureDuration) && !(isLast && total.lessThan(measureDuration))) {
      issues.push({
        measure: measureIndex + 1,
        expected: measureDuration.toString(),
        actual: total.toString(),
        message:
          `El compas ${measureIndex + 1} suma ${total.toString()} de redonda ` +
          `y deberia sumar ${measureDuration.toString()}`,
      });
    }
    previousIndex = boundary;
  }

  return issues;
}
