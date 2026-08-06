import { isRest, note, Pitch, type MusicalEvent } from '@sinfo/core';
import type { Scale } from '@sinfo/theory';
import { Motif } from './motif.js';
import { Random } from './random.js';

/**
 * Contrapunto por especies sobre un cantus firmus.
 *
 * Se resuelve con BUSQUEDA CON RETROCESO, no eligiendo nota a nota hacia
 * delante. La diferencia es decisiva: las reglas del contrapunto se
 * condicionan entre si, y una eleccion perfectamente correcta en el compas 5
 * puede dejar el 6 sin ninguna salida legal. Un algoritmo voraz se atasca ahi
 * y tiene que romper una regla; con retroceso, deshace la decision anterior y
 * prueba otra.
 */

export type Species = 1 | 2;

/** Distancias, en semitonos dentro de la octava, que son consonancia. */
const PERFECT_CONSONANCES = new Set([0, 7]);
const IMPERFECT_CONSONANCES = new Set([3, 4, 8, 9]);

function isConsonant(lower: Pitch, upper: Pitch): boolean {
  const distance = Math.abs(upper.midi - lower.midi) % 12;
  return PERFECT_CONSONANCES.has(distance) || IMPERFECT_CONSONANCES.has(distance);
}

function isPerfect(lower: Pitch, upper: Pitch): boolean {
  return PERFECT_CONSONANCES.has(Math.abs(upper.midi - lower.midi) % 12);
}

export interface CounterpointOptions {
  /** Melodia dada contra la que se escribe. */
  readonly cantus: readonly MusicalEvent[];
  readonly scale: Scale;
  /** true escribe por encima del cantus; false, por debajo. */
  readonly above?: boolean | undefined;
  readonly lowest: Pitch;
  readonly highest: Pitch;
  readonly species?: Species | undefined;
  readonly seed?: string | undefined;
  /** Tope de nodos explorados antes de rendirse. */
  readonly maxNodes?: number | undefined;
}

export interface CounterpointResult {
  readonly motif: Motif;
  readonly seed: string;
  readonly species: Species;
  /** true si la busqueda cumplio todas las reglas hasta el final. */
  readonly complete: boolean;
  readonly notes: number;
  /** Nodos explorados; delata cuando el cantus era casi imposible. */
  readonly nodesExplored: number;
  /** Reglas que hubo que relajar cuando no habia solucion estricta. */
  readonly relaxed: readonly string[];
}

interface Step {
  /** Altura del cantus en este paso. */
  readonly cantus: Pitch;
  /** Candidatos ordenados por preferencia. */
  readonly candidates: readonly Pitch[];
}

/**
 * Escribe un contrapunto contra el cantus dado.
 *
 * Si no existe solucion estricta se relajan reglas por orden de importancia
 * (primero las de estilo, nunca las disonancias) y se informa de cuales. Es
 * preferible devolver musica utilizable diciendo que se cedio, a devolver un
 * error que deja al agente sin nada.
 */
export function generateCounterpoint(options: CounterpointOptions): CounterpointResult {
  const seed = options.seed ?? 'contrapunto';
  const species = options.species ?? 1;
  const above = options.above ?? true;
  const maxNodes = options.maxNodes ?? 60_000;

  const cantusPitches = options.cantus
    .filter((event) => !isRest(event))
    .map((event) => event.pitches[0]!)
    .filter((pitch): pitch is Pitch => pitch !== undefined);

  if (cantusPitches.length === 0) {
    throw new Error('El cantus firmus no tiene ninguna nota');
  }

  const available = options.scale.between(options.lowest, options.highest);
  if (available.length === 0) {
    throw new Error(
      `La escala ${options.scale.name} no tiene notas entre ${options.lowest.name} y ${options.highest.name}`,
    );
  }

  // Escalones de relajacion. Se prueba primero el conjunto estricto; cada
  // escalon siguiente cede una regla de estilo. Las disonancias no se ceden
  // nunca: sin ellas dejaria de ser contrapunto.
  const relaxations: { name: string; rules: RuleSet }[] = [
    { name: '', rules: { ...STRICT } },
    { name: 'movimiento directo a consonancia perfecta', rules: { ...STRICT, directMotion: false } },
    { name: 'variedad de consonancias perfectas', rules: { ...STRICT, directMotion: false, limitPerfects: false } },
    {
      name: 'saltos limitados',
      rules: { ...STRICT, directMotion: false, limitPerfects: false, limitLeaps: false },
    },
  ];

  const relaxed: string[] = [];
  let nodesExplored = 0;

  for (const level of relaxations) {
    const random = new Random(`${seed}::${level.name}`);
    const steps = buildSteps(cantusPitches, available, above, random);

    const search = new Search(steps, above, level.rules, maxNodes);
    const solution = search.run();
    nodesExplored += search.nodes;

    if (solution) {
      return {
        motif: buildMotif(solution, options.cantus, species, seed),
        seed,
        species,
        complete: relaxed.length === 0,
        notes: solution.length,
        nodesExplored,
        relaxed: [...relaxed],
      };
    }
    if (level.name !== '') relaxed.push(level.name);
  }

  // Ni con todo relajado hay solucion: se devuelven consonancias sin mas.
  const fallback = cantusPitches.map((cantus) =>
    nearestConsonance(cantus, available, above),
  );
  return {
    motif: buildMotif(fallback, options.cantus, species, seed),
    seed,
    species,
    complete: false,
    notes: fallback.length,
    nodesExplored,
    relaxed: [...relaxed, 'todas las reglas de estilo'],
  };
}

interface RuleSet {
  readonly directMotion: boolean;
  readonly limitPerfects: boolean;
  readonly limitLeaps: boolean;
}

const STRICT: RuleSet = { directMotion: true, limitPerfects: true, limitLeaps: true };

/**
 * Busqueda con retroceso.
 *
 * Se separa en una clase para llevar la cuenta de nodos: sin tope, un cantus
 * dificil puede disparar la exploracion y colgar el servidor. Con tope, la
 * peor consecuencia es que se pase al siguiente escalon de relajacion.
 */
class Search {
  nodes = 0;
  private readonly chosen: Pitch[] = [];

  constructor(
    private readonly steps: readonly Step[],
    private readonly above: boolean,
    private readonly rules: RuleSet,
    private readonly maxNodes: number,
  ) {}

  run(): Pitch[] | null {
    return this.visit(0) ? [...this.chosen] : null;
  }

  private visit(index: number): boolean {
    if (index === this.steps.length) return true;
    if (this.nodes >= this.maxNodes) return false;

    const step = this.steps[index]!;
    for (const candidate of step.candidates) {
      this.nodes++;
      if (this.nodes >= this.maxNodes) return false;
      if (!this.isLegal(candidate, index)) continue;

      this.chosen.push(candidate);
      if (this.visit(index + 1)) return true;
      this.chosen.pop();
    }
    return false;
  }

  private isLegal(candidate: Pitch, index: number): boolean {
    const step = this.steps[index]!;
    const [lower, upper] = this.above
      ? [step.cantus, candidate]
      : [candidate, step.cantus];

    // 1. Disonancia: innegociable en primera especie.
    if (!isConsonant(lower, upper)) return false;

    // 2. Sin cruce de voces.
    if (this.above && candidate.midi <= step.cantus.midi) return false;
    if (!this.above && candidate.midi >= step.cantus.midi) return false;

    const isFirst = index === 0;
    const isLast = index === this.steps.length - 1;

    // 3. Los extremos piden consonancia perfecta: es lo que da sensacion de
    //    principio y de final.
    if ((isFirst || isLast) && !isPerfect(lower, upper)) return false;

    // 4. El final, ademas, en unisono u octava.
    if (isLast && Math.abs(upper.midi - lower.midi) % 12 !== 0) return false;

    if (isFirst) return true;

    const previous = this.chosen[index - 1]!;
    const previousCantus = this.steps[index - 1]!.cantus;
    const [prevLower, prevUpper] = this.above
      ? [previousCantus, previous]
      : [previous, previousCantus];

    // 5. Repetir la misma nota es pobre en primera especie.
    if (previous.midi === candidate.midi) return false;

    const cpMotion = Math.sign(candidate.midi - previous.midi);
    const cfMotion = Math.sign(step.cantus.midi - previousCantus.midi);
    const similar = cpMotion !== 0 && cpMotion === cfMotion;

    // 6. Paralelas: dos voces que mantienen quinta u octava se funden en una.
    if (similar && isPerfect(lower, upper) && isPerfect(prevLower, prevUpper)) {
      const before = Math.abs(prevUpper.midi - prevLower.midi) % 12;
      const after = Math.abs(upper.midi - lower.midi) % 12;
      if (before === after) return false;
    }

    // 7. Movimiento directo hacia consonancia perfecta.
    //
    // La regla mira el salto de la voz SUPERIOR, no el del contrapunto: es la
    // voz de arriba la que se oye y la que produce el efecto. Cuando se
    // escribe por debajo del cantus, la superior es el cantus, y aunque sea
    // fijo el contrapunto puede evitar el choque moviendose en contrario o no
    // cayendo en consonancia perfecta. Comprobar siempre el propio salto
    // dejaba pasar octavas directas que el analizador si detectaba despues.
    if (this.rules.directMotion && similar && isPerfect(lower, upper)) {
      const upperLeap = this.above
        ? Math.abs(candidate.midi - previous.midi)
        : Math.abs(step.cantus.midi - previousCantus.midi);
      if (upperLeap > 2) return false;
    }

    // 8. Intervalos melodicos: nada de aumentados ni saltos enormes.
    const melodic = previous.intervalTo(candidate);
    if (melodic.quality.startsWith('A') && Math.abs(melodic.chromatic) > 2) return false;
    if (this.rules.limitLeaps && Math.abs(melodic.chromatic) > 12) return false;

    // 9. Demasiadas perfectas seguidas suena hueco.
    if (this.rules.limitPerfects && index >= 2) {
      const twoBack = this.chosen[index - 2]!;
      const [backLower, backUpper] = this.above
        ? [this.steps[index - 2]!.cantus, twoBack]
        : [twoBack, this.steps[index - 2]!.cantus];
      if (isPerfect(lower, upper) && isPerfect(prevLower, prevUpper) && isPerfect(backLower, backUpper)) {
        return false;
      }
    }

    // 10. Tras un salto, volver por grado conjunto en sentido contrario.
    if (this.rules.limitLeaps && index >= 2) {
      const twoBack = this.chosen[index - 2]!;
      const lastLeap = previous.midi - twoBack.midi;
      if (Math.abs(lastLeap) > 4) {
        const next = candidate.midi - previous.midi;
        if (Math.sign(next) === Math.sign(lastLeap) && Math.abs(next) > 2) return false;
      }
    }

    return true;
  }
}

/**
 * Prepara los candidatos de cada paso, ya ordenados por preferencia.
 *
 * El orden importa mucho: la busqueda prueba en ese orden y se queda con la
 * primera solucion completa, asi que ordenar por preferencia hace que la
 * primera que encuentre sea ademas la mas musical. El azar entra como
 * desempate, y por eso semillas distintas dan contrapuntos distintos sobre el
 * mismo cantus.
 */
function buildSteps(
  cantus: readonly Pitch[],
  available: readonly Pitch[],
  above: boolean,
  random: Random,
): Step[] {
  return cantus.map((cantusPitch) => {
    const usable = available.filter((pitch) =>
      above ? pitch.midi > cantusPitch.midi : pitch.midi < cantusPitch.midi,
    );

    const scored = usable.map((pitch) => {
      const [lower, upper] = above ? [cantusPitch, pitch] : [pitch, cantusPitch];
      const distance = Math.abs(upper.midi - lower.midi);

      // Las imperfectas primero: son las que dan color. Y se prefiere la
      // distancia media, ni pegada al cantus ni a dos octavas.
      let weight = isPerfect(lower, upper) ? 1 : 3;
      weight *= 1 + 2 / (1 + Math.abs(distance - 8) / 4);
      weight *= 0.6 + random.next() * 0.8;

      return { pitch, weight };
    });

    return {
      cantus: cantusPitch,
      candidates: scored.sort((a, b) => b.weight - a.weight).map((entry) => entry.pitch),
    };
  });
}

/** Ultimo recurso: la consonancia mas cercana, sin mirar nada mas. */
function nearestConsonance(
  cantus: Pitch,
  available: readonly Pitch[],
  above: boolean,
): Pitch {
  const usable = available.filter((pitch) =>
    above ? pitch.midi > cantus.midi : pitch.midi < cantus.midi,
  );
  const consonant = usable.filter((pitch) =>
    above ? isConsonant(cantus, pitch) : isConsonant(pitch, cantus),
  );
  const pool = consonant.length > 0 ? consonant : usable.length > 0 ? usable : available;

  return pool.reduce((best, pitch) =>
    Math.abs(pitch.midi - cantus.midi - (above ? 8 : -8)) <
    Math.abs(best.midi - cantus.midi - (above ? 8 : -8))
      ? pitch
      : best,
  );
}

/** Monta el motivo dando a cada nota la duracion de su nota del cantus. */
function buildMotif(
  pitches: readonly Pitch[],
  cantus: readonly MusicalEvent[],
  species: Species,
  seed: string,
): Motif {
  const sounding = cantus.filter((event) => !isRest(event));
  const events = pitches.map((pitch, index) =>
    note(pitch, sounding[index]?.duration ?? sounding[0]!.duration),
  );
  return Motif.of(events, [`contrapunto de ${species}a especie con semilla "${seed}"`]);
}
