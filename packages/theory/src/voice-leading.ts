import type { Duration, Pitch } from '@sinfo/core';
import type { LabeledVoice, Verticality } from './verticality.js';
import { extractVerticalities } from './verticality.js';

/**
 * Reglas de conduccion de voces.
 *
 * Esto es el critico del agente. Un modelo escribe acordes que por separado
 * son correctos y que juntos suenan mal, porque los errores de conduccion no
 * estan en ninguna nota sino en la relacion entre dos. Sin una comprobacion
 * mecanica no hay forma de que se de cuenta.
 *
 * Las reglas son las de la practica comun. No son leyes universales y hay
 * repertorio que las incumple a proposito, asi que se reportan con severidad y
 * explicacion, nunca bloqueando la escritura.
 */

export type VoiceLeadingRule =
  | 'quintas-paralelas'
  | 'octavas-paralelas'
  | 'quintas-directas'
  | 'octavas-directas'
  | 'cruce-de-voces'
  | 'solapamiento'
  | 'espaciado-excesivo'
  | 'salto-excesivo'
  | 'intervalo-aumentado'
  | 'sensible-sin-resolver';

export type Severity = 'error' | 'aviso';

export interface VoiceLeadingIssue {
  readonly rule: VoiceLeadingRule;
  readonly severity: Severity;
  /** Posicion donde ocurre, para poder localizarla en la partitura. */
  readonly position: Duration;
  readonly voices: readonly string[];
  readonly message: string;
}

export interface VoiceLeadingOptions {
  /** Maxima distancia entre voces agudas contiguas, en semitonos. Por defecto 12. */
  readonly maxSpacing?: number;
  /** Salto melodico maximo sin aviso, en semitonos. Por defecto 12. */
  readonly maxLeap?: number;
  /** Comprobar cruces y solapamientos. Por defecto si. */
  readonly checkCrossing?: boolean;
}

/**
 * Analiza la conduccion de voces de un pasaje.
 *
 * Las voces se pasan de GRAVE a AGUDO. El orden importa: cruce y solapamiento
 * solo tienen sentido si se sabe cual deberia estar por debajo de cual.
 */
export function checkVoiceLeading(
  voices: readonly LabeledVoice[],
  options: VoiceLeadingOptions = {},
): VoiceLeadingIssue[] {
  const verticalities = extractVerticalities(voices);
  const labels = voices.map((entry) => entry.label);
  const issues: VoiceLeadingIssue[] = [];

  for (const [index, current] of verticalities.entries()) {
    checkSimultaneous(current, labels, options, issues);

    const next = verticalities[index + 1];
    if (next) checkMotion(current, next, labels, options, issues);
  }

  return issues;
}

// ------------------------------------------------- errores dentro de un acorde

function checkSimultaneous(
  vertical: Verticality,
  labels: readonly string[],
  options: VoiceLeadingOptions,
  issues: VoiceLeadingIssue[],
): void {
  const maxSpacing = options.maxSpacing ?? 12;
  const checkCrossing = options.checkCrossing ?? true;

  for (let lower = 0; lower < vertical.pitches.length - 1; lower++) {
    const below = vertical.pitches[lower];
    const above = vertical.pitches[lower + 1];
    if (!below || !above) continue;

    if (checkCrossing && below.midi > above.midi) {
      issues.push({
        rule: 'cruce-de-voces',
        severity: 'aviso',
        position: vertical.position,
        voices: [labels[lower]!, labels[lower + 1]!],
        message:
          `${labels[lower]} (${below.name}) esta por encima de ${labels[lower + 1]} ` +
          `(${above.name}): las voces se cruzan y el oido deja de seguirlas por separado`,
      });
    }

    // El espaciado ancho solo se vigila entre las voces agudas. Entre bajo y
    // tenor es normal y hasta deseable: la serie armonica esta mas separada
    // abajo, y apretar ahi enturbia el sonido.
    const isUpperPair = lower >= 1;
    if (isUpperPair && above.midi - below.midi > maxSpacing) {
      issues.push({
        rule: 'espaciado-excesivo',
        severity: 'aviso',
        position: vertical.position,
        voices: [labels[lower]!, labels[lower + 1]!],
        message:
          `Mas de una octava entre ${labels[lower]} (${below.name}) y ` +
          `${labels[lower + 1]} (${above.name}): la textura se abre y suena hueca`,
      });
    }
  }
}

// --------------------------------------------------- errores entre dos acordes

function checkMotion(
  from: Verticality,
  to: Verticality,
  labels: readonly string[],
  options: VoiceLeadingOptions,
  issues: VoiceLeadingIssue[],
): void {
  checkMelodicIntervals(from, to, labels, options, issues);

  for (let lower = 0; lower < from.pitches.length; lower++) {
    for (let upper = lower + 1; upper < from.pitches.length; upper++) {
      const a1 = from.pitches[lower];
      const a2 = to.pitches[lower];
      const b1 = from.pitches[upper];
      const b2 = to.pitches[upper];
      if (!a1 || !a2 || !b1 || !b2) continue;

      const pair = [labels[lower]!, labels[upper]!];
      checkParallels(a1, a2, b1, b2, pair, to.position, issues);
      checkDirect(a1, a2, b1, b2, pair, to.position, upper === from.pitches.length - 1, issues);
      checkOverlap(a1, a2, b1, b2, pair, to.position, options, issues);
    }
  }
}

/**
 * Quintas y octavas paralelas.
 *
 * El error clasico. Dos voces separadas por quinta u octava que se mueven
 * manteniendo ese intervalo dejan de oirse como dos voces: se funden en una
 * sola con refuerzo armonico, y la textura pierde una linea.
 */
function checkParallels(
  lowerFrom: Pitch,
  lowerTo: Pitch,
  upperFrom: Pitch,
  upperTo: Pitch,
  voices: readonly string[],
  position: Duration,
  issues: VoiceLeadingIssue[],
): void {
  const before = intervalClass(lowerFrom, upperFrom);
  const after = intervalClass(lowerTo, upperTo);
  if (before !== after) return;
  if (before !== 7 && before !== 0) return;

  // Repetir el mismo acorde no es movimiento paralelo: nadie se mueve.
  const lowerMoved = lowerFrom.midi !== lowerTo.midi;
  const upperMoved = upperFrom.midi !== upperTo.midi;
  if (!lowerMoved || !upperMoved) return;

  const isOctave = before === 0;
  issues.push({
    rule: isOctave ? 'octavas-paralelas' : 'quintas-paralelas',
    severity: 'error',
    position,
    voices,
    message:
      `${isOctave ? 'Octavas' : 'Quintas'} paralelas entre ${voices[0]} y ${voices[1]}: ` +
      `${lowerFrom.name}-${upperFrom.name} pasa a ${lowerTo.name}-${upperTo.name}. ` +
      'Las dos voces se funden en una y la textura pierde independencia',
  });
}

/**
 * Quintas y octavas directas (llamadas tambien ocultas).
 *
 * Llegar a una quinta u octava con las dos voces moviendose en la misma
 * direccion y con salto en la voz superior produce el mismo efecto de fusion
 * que las paralelas, aunque el intervalo anterior fuese otro. Solo se vigila
 * entre las voces extremas, que son las que se oyen.
 */
function checkDirect(
  lowerFrom: Pitch,
  lowerTo: Pitch,
  upperFrom: Pitch,
  upperTo: Pitch,
  voices: readonly string[],
  position: Duration,
  isOuterPair: boolean,
  issues: VoiceLeadingIssue[],
): void {
  if (!isOuterPair) return;

  const after = intervalClass(lowerTo, upperTo);
  if (after !== 7 && after !== 0) return;

  const lowerStep = Math.sign(lowerTo.midi - lowerFrom.midi);
  const upperStep = Math.sign(upperTo.midi - upperFrom.midi);
  if (lowerStep === 0 || upperStep === 0 || lowerStep !== upperStep) return;

  // Si la voz superior llega por grado conjunto el efecto desaparece: la regla
  // solo aplica cuando salta.
  if (Math.abs(upperTo.midi - upperFrom.midi) <= 2) return;

  const isOctave = after === 0;
  issues.push({
    rule: isOctave ? 'octavas-directas' : 'quintas-directas',
    severity: 'aviso',
    position,
    voices,
    message:
      `${isOctave ? 'Octava' : 'Quinta'} directa entre ${voices[0]} y ${voices[1]}: ` +
      `ambas llegan a ${lowerTo.name}-${upperTo.name} en la misma direccion y con salto arriba`,
  });
}

/**
 * Solapamiento: una voz se mete donde estaba su vecina.
 *
 * Distinto del cruce. En el cruce las voces estan mal ordenadas a la vez; en
 * el solapamiento, la voz aguda baja por debajo de donde estaba la grave un
 * momento antes, y el oido pierde el hilo de cual es cual.
 */
function checkOverlap(
  lowerFrom: Pitch,
  lowerTo: Pitch,
  upperFrom: Pitch,
  upperTo: Pitch,
  voices: readonly string[],
  position: Duration,
  options: VoiceLeadingOptions,
  issues: VoiceLeadingIssue[],
): void {
  if (options.checkCrossing === false) return;

  if (upperTo.midi < lowerFrom.midi) {
    issues.push({
      rule: 'solapamiento',
      severity: 'aviso',
      position,
      voices,
      message:
        `${voices[1]} baja a ${upperTo.name}, por debajo de donde estaba ${voices[0]} ` +
        `(${lowerFrom.name}): se solapan y se pierde el hilo de cada voz`,
    });
  }

  if (lowerTo.midi > upperFrom.midi) {
    issues.push({
      rule: 'solapamiento',
      severity: 'aviso',
      position,
      voices,
      message:
        `${voices[0]} sube a ${lowerTo.name}, por encima de donde estaba ${voices[1]} ` +
        `(${upperFrom.name}): se solapan y se pierde el hilo de cada voz`,
    });
  }
}

/** Saltos melodicos problematicos dentro de una misma voz. */
function checkMelodicIntervals(
  from: Verticality,
  to: Verticality,
  labels: readonly string[],
  options: VoiceLeadingOptions,
  issues: VoiceLeadingIssue[],
): void {
  const maxLeap = options.maxLeap ?? 12;

  for (const [index, before] of from.pitches.entries()) {
    const after = to.pitches[index];
    if (!before || !after || before.midi === after.midi) continue;

    const interval = before.intervalTo(after);
    const semitones = Math.abs(interval.chromatic);

    if (semitones > maxLeap) {
      issues.push({
        rule: 'salto-excesivo',
        severity: 'aviso',
        position: to.position,
        voices: [labels[index]!],
        message:
          `${labels[index]} salta ${interval.name} de ${before.name} a ${after.name}: ` +
          'mas de una octava es dificil de cantar y de seguir',
      });
    }

    // Los intervalos aumentados son especialmente dificiles de entonar; los
    // disminuidos se aceptan porque suelen resolver por dentro del salto.
    if (interval.quality.startsWith('A') && semitones > 2) {
      issues.push({
        rule: 'intervalo-aumentado',
        severity: 'aviso',
        position: to.position,
        voices: [labels[index]!],
        message:
          `${labels[index]} salta un intervalo aumentado (${interval.name}) de ` +
          `${before.name} a ${after.name}: mal de entonar, mejor reescribirlo`,
      });
    }
  }
}

/**
 * Distancia entre dos alturas reducida a una octava, en semitonos.
 * La octava y el unisono comparten clase 0, que es justo lo que hace falta
 * para detectar paralelas: una octava y un unisono se funden igual.
 */
function intervalClass(lower: Pitch, upper: Pitch): number {
  return Math.abs(upper.midi - lower.midi) % 12;
}

/** Reparto de los problemas encontrados por severidad. */
export function summarizeIssues(issues: readonly VoiceLeadingIssue[]): {
  errors: number;
  warnings: number;
  byRule: Record<string, number>;
} {
  const byRule: Record<string, number> = {};
  let errors = 0;
  let warnings = 0;

  for (const issue of issues) {
    byRule[issue.rule] = (byRule[issue.rule] ?? 0) + 1;
    if (issue.severity === 'error') errors++;
    else warnings++;
  }

  return { errors, warnings, byRule };
}
