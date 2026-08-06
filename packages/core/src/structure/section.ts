import { DomainError } from '../errors.js';
import type { KeySignature } from '../pitch/key-signature.js';

/**
 * Funcion formal de una seccion.
 *
 * No es decorativa: dice QUE hace la seccion en el discurso, y de ahi salen
 * decisiones concretas. Una exposicion presenta material nuevo; un desarrollo
 * fragmenta y moduła lo ya presentado; una reexposicion vuelve a la tonalidad
 * principal. Sin esta etiqueta, el agente tiene que recordar el papel de cada
 * tramo por su cuenta, y en una obra de veinte secciones no lo hace.
 */
export type SectionRole =
  | 'introduccion'
  | 'exposicion'
  | 'transicion'
  | 'desarrollo'
  | 'reexposicion'
  | 'coda'
  | 'tema'
  | 'variacion'
  | 'estribillo'
  | 'verso'
  | 'puente'
  | 'solo'
  | 'libre';

/**
 * Una seccion: un tramo de compases con nombre, funcion y tonalidad.
 *
 * Se guarda por NUMERO DE COMPAS y no por posicion absoluta porque es como se
 * habla de la forma ("el desarrollo empieza en el 97") y porque sobrevive a
 * los cambios de compas: si el metro cambia a mitad de obra, las posiciones
 * absolutas se desplazan pero los numeros de compas siguen valiendo.
 */
export interface Section {
  readonly id: string;
  readonly name: string;
  readonly role: SectionRole;
  /** Primer compas, base 1. */
  readonly fromMeasure: number;
  /** Ultimo compas incluido. */
  readonly toMeasure: number;
  /** Tonalidad de la seccion, si difiere de la del movimiento. */
  readonly key: KeySignature | undefined;
  /** Material tematico que usa, por id de motivo. */
  readonly motifs: readonly string[];
  readonly notes: string | undefined;
}

export interface SectionInput {
  readonly name: string;
  readonly role?: SectionRole;
  readonly measures: number;
  readonly key?: KeySignature;
  readonly motifs?: readonly string[];
  readonly notes?: string;
}

/**
 * Plan formal de un movimiento: sus secciones en orden, sin huecos.
 *
 * Las secciones se encadenan automaticamente a partir de su duracion en
 * compases. Dejar que el agente indique inicio y fin de cada una invita a
 * solapamientos y huecos, que son estados imposibles: una obra no tiene
 * compases que no pertenezcan a ninguna seccion.
 */
export class FormPlan {
  private readonly items: Section[] = [];

  get sections(): readonly Section[] {
    return this.items;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** Compas siguiente al ultimo ocupado. */
  get nextMeasure(): number {
    const last = this.items.at(-1);
    return last ? last.toMeasure + 1 : 1;
  }

  /** Compases que abarca el plan completo. */
  get totalMeasures(): number {
    return this.nextMeasure - 1;
  }

  /** Anade una seccion a continuacion de la ultima. */
  append(id: string, input: SectionInput): Section {
    if (!Number.isInteger(input.measures) || input.measures < 1) {
      throw new DomainError('INVALID_STRUCTURE', 'Una seccion dura al menos un compas', {
        name: input.name,
        measures: input.measures,
      });
    }
    if (this.items.some((section) => section.id === id)) {
      throw new DomainError('INVALID_STRUCTURE', `La seccion "${id}" ya existe`, { id });
    }

    const fromMeasure = this.nextMeasure;
    const section: Section = Object.freeze({
      id,
      name: input.name,
      role: input.role ?? 'libre',
      fromMeasure,
      toMeasure: fromMeasure + input.measures - 1,
      key: input.key,
      motifs: Object.freeze([...(input.motifs ?? [])]),
      notes: input.notes,
    });

    this.items.push(section);
    return section;
  }

  /** Seccion que contiene el compas dado, o null si esta fuera del plan. */
  at(measure: number): Section | null {
    return (
      this.items.find(
        (section) => measure >= section.fromMeasure && measure <= section.toMeasure,
      ) ?? null
    );
  }

  get(id: string): Section {
    const found = this.items.find((section) => section.id === id);
    if (!found) {
      throw new DomainError('NOT_FOUND', `No existe la seccion "${id}"`, {
        id,
        available: this.items.map((section) => section.id),
      });
    }
    return found;
  }

  has(id: string): boolean {
    return this.items.some((section) => section.id === id);
  }

  clear(): void {
    this.items.length = 0;
  }

  toJSON(): {
    sections: { id: string; name: string; role: SectionRole; from: number; to: number; key: string | null }[];
    totalMeasures: number;
  } {
    return {
      sections: this.items.map((section) => ({
        id: section.id,
        name: section.name,
        role: section.role,
        from: section.fromMeasure,
        to: section.toMeasure,
        key: section.key?.name ?? null,
      })),
      totalMeasures: this.totalMeasures,
    };
  }
}

/**
 * Formas predefinidas.
 *
 * Cada plantilla es la sucesion de funciones formales con sus proporciones
 * relativas. El agente pide "sonata" y una duracion total, y las secciones
 * salen repartidas: es lo que evita que tenga que calcular a mano que un
 * desarrollo suele ocupar un tercio de un primer movimiento.
 */
export interface FormTemplate {
  readonly name: string;
  readonly description: string;
  readonly sections: readonly {
    readonly name: string;
    readonly role: SectionRole;
    /** Peso relativo en el reparto de compases. */
    readonly weight: number;
    /**
     * Grado de la escala donde va la seccion, respecto a la tonica.
     * 1 = tonica, 5 = dominante, 6 = relativo menor. null = sin cambio.
     */
    readonly degree?: number;
  }[];
}

export const FORM_TEMPLATES: Readonly<Record<string, FormTemplate>> = {
  sonata: {
    name: 'Forma sonata',
    description:
      'Exposicion con dos temas en tonalidades distintas, desarrollo que los fragmenta y ' +
      'reexposicion que los reune en la tonica. Primer movimiento tipico de sinfonia.',
    sections: [
      { name: 'Primer tema', role: 'exposicion', weight: 3, degree: 1 },
      { name: 'Transicion', role: 'transicion', weight: 2 },
      { name: 'Segundo tema', role: 'exposicion', weight: 3, degree: 5 },
      { name: 'Desarrollo', role: 'desarrollo', weight: 4 },
      { name: 'Reexposicion del primer tema', role: 'reexposicion', weight: 3, degree: 1 },
      { name: 'Reexposicion del segundo tema', role: 'reexposicion', weight: 3, degree: 1 },
      { name: 'Coda', role: 'coda', weight: 2, degree: 1 },
    ],
  },
  ternary: {
    name: 'Forma ternaria (ABA)',
    description: 'Seccion central contrastante entre dos exposiciones del mismo material.',
    sections: [
      { name: 'A', role: 'exposicion', weight: 3, degree: 1 },
      { name: 'B', role: 'desarrollo', weight: 3, degree: 4 },
      { name: 'A (reexposicion)', role: 'reexposicion', weight: 3, degree: 1 },
    ],
  },
  binary: {
    name: 'Forma binaria',
    description: 'Dos mitades, la primera hacia la dominante y la segunda de vuelta.',
    sections: [
      { name: 'A', role: 'exposicion', weight: 1, degree: 1 },
      { name: 'B', role: 'reexposicion', weight: 1, degree: 5 },
    ],
  },
  rondo: {
    name: 'Rondo (ABACA)',
    description: 'Un estribillo que vuelve entre episodios contrastantes.',
    sections: [
      { name: 'A', role: 'estribillo', weight: 2, degree: 1 },
      { name: 'B', role: 'exposicion', weight: 2, degree: 5 },
      { name: 'A', role: 'estribillo', weight: 2, degree: 1 },
      { name: 'C', role: 'exposicion', weight: 2, degree: 4 },
      { name: 'A', role: 'estribillo', weight: 2, degree: 1 },
      { name: 'Coda', role: 'coda', weight: 1, degree: 1 },
    ],
  },
  theme_and_variations: {
    name: 'Tema y variaciones',
    description: 'Un tema seguido de cuatro variaciones y una coda.',
    sections: [
      { name: 'Tema', role: 'tema', weight: 2, degree: 1 },
      { name: 'Variacion I', role: 'variacion', weight: 2, degree: 1 },
      { name: 'Variacion II', role: 'variacion', weight: 2, degree: 1 },
      { name: 'Variacion III', role: 'variacion', weight: 2, degree: 6 },
      { name: 'Variacion IV', role: 'variacion', weight: 2, degree: 1 },
      { name: 'Coda', role: 'coda', weight: 1, degree: 1 },
    ],
  },
  minuet_trio: {
    name: 'Minueto y trio',
    description: 'Minueto, trio contrastante y vuelta al minueto. Tercer movimiento clasico.',
    sections: [
      { name: 'Minueto', role: 'exposicion', weight: 3, degree: 1 },
      { name: 'Trio', role: 'exposicion', weight: 3, degree: 4 },
      { name: 'Minueto da capo', role: 'reexposicion', weight: 3, degree: 1 },
    ],
  },
  song: {
    name: 'Cancion (verso-estribillo)',
    description: 'Estructura de cancion popular con puente.',
    sections: [
      { name: 'Introduccion', role: 'introduccion', weight: 1, degree: 1 },
      { name: 'Verso I', role: 'verso', weight: 2, degree: 1 },
      { name: 'Estribillo I', role: 'estribillo', weight: 2, degree: 1 },
      { name: 'Verso II', role: 'verso', weight: 2, degree: 1 },
      { name: 'Estribillo II', role: 'estribillo', weight: 2, degree: 1 },
      { name: 'Puente', role: 'puente', weight: 1, degree: 6 },
      { name: 'Estribillo final', role: 'estribillo', weight: 2, degree: 1 },
      { name: 'Coda', role: 'coda', weight: 1, degree: 1 },
    ],
  },
  through_composed: {
    name: 'Libre',
    description: 'Una sola seccion sin estructura predefinida.',
    sections: [{ name: 'Completo', role: 'libre', weight: 1, degree: 1 }],
  },
};

/**
 * Reparte `totalMeasures` entre las secciones segun sus pesos.
 *
 * El ultimo tramo absorbe el resto de la division: asi la suma cuadra siempre
 * con lo pedido y no aparece un compas suelto sin seccion.
 */
export function distributeMeasures(
  template: FormTemplate,
  totalMeasures: number,
): number[] {
  const weights = template.sections.map((section) => section.weight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  const measures = weights.map((weight) =>
    Math.max(1, Math.round((weight / totalWeight) * totalMeasures)),
  );

  const assigned = measures.reduce((sum, count) => sum + count, 0);
  const remainder = totalMeasures - assigned;
  const lastIndex = measures.length - 1;
  measures[lastIndex] = Math.max(1, measures[lastIndex]! + remainder);

  return measures;
}
