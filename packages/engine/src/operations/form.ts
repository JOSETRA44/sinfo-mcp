import {
  distributeMeasures,
  ENSEMBLE_PRESETS,
  FORM_TEMPLATES,
  getInstrument,
  KeySignature,
  type Movement,
  type Score,
  type SectionRole,
} from '@sinfo/core';
import { Scale } from '@sinfo/theory';
import { fail } from '../errors.js';
import { addPart } from './structure.js';

/**
 * Planificacion de la forma.
 *
 * Es el nivel en el que se decide una obra larga: cuantas secciones, de que
 * tipo, cuanto dura cada una y en que tonalidad. Sin este nivel, un agente
 * escribe compases sueltos y no sabe donde esta; con el, sabe que esta en el
 * desarrollo y que le quedan cuarenta compases.
 */

export interface PlanFormInput {
  /** Plantilla: sonata, ternary, rondo, theme_and_variations, song... */
  readonly form?: string | undefined;
  readonly totalMeasures?: number | undefined;
  /** Secciones a medida. Si se indican, se ignora la plantilla. */
  readonly sections?: readonly {
    readonly name: string;
    readonly role?: string | undefined;
    readonly measures: number;
    readonly key?: string | undefined;
    readonly notes?: string | undefined;
  }[] | undefined;
  /** Sustituye el plan anterior en vez de anadir al final. */
  readonly replace?: boolean | undefined;
}

export interface PlanFormResult {
  readonly form: string;
  readonly totalMeasures: number;
  readonly sections: readonly {
    id: string;
    name: string;
    role: string;
    from: number;
    to: number;
    measures: number;
    key: string;
  }[];
}

export function planForm(movement: Movement, input: PlanFormInput = {}): PlanFormResult {
  if (input.replace ?? true) movement.form.clear();

  const home = movement.timeline.keyAt(movement.timeline.keyChanges[0]!.at);

  if (input.sections && input.sections.length > 0) {
    for (const [index, section] of input.sections.entries()) {
      movement.form.append(`s${movement.form.sections.length + 1}`, {
        name: section.name,
        role: parseRole(section.role, index),
        measures: section.measures,
        ...(section.key !== undefined ? { key: KeySignature.parse(section.key) } : {}),
        ...(section.notes !== undefined ? { notes: section.notes } : {}),
      });
    }
    return describePlan('a medida', movement);
  }

  const formId = input.form ?? 'ternary';
  const template = FORM_TEMPLATES[formId];
  if (!template) {
    fail('INVALID_REQUEST', `Forma desconocida: "${formId}"`, {
      form: formId,
      available: Object.keys(FORM_TEMPLATES),
    });
  }

  const measures = distributeMeasures(template, input.totalMeasures ?? 32);

  for (const [index, section] of template.sections.entries()) {
    const key = section.degree !== undefined ? keyOfDegree(home, section.degree) : undefined;
    movement.form.append(`s${index + 1}`, {
      name: section.name,
      role: section.role,
      measures: measures[index]!,
      ...(key !== undefined ? { key } : {}),
    });
  }

  return describePlan(template.name, movement);
}

function describePlan(form: string, movement: Movement): PlanFormResult {
  return {
    form,
    totalMeasures: movement.form.totalMeasures,
    sections: movement.form.sections.map((section) => ({
      id: section.id,
      name: section.name,
      role: section.role,
      from: section.fromMeasure,
      to: section.toMeasure,
      measures: section.toMeasure - section.fromMeasure + 1,
      key: section.key?.name ?? movement.timeline.keyAt(movement.timeline.keyChanges[0]!.at).name,
    })),
  };
}

const ROLES = new Set<SectionRole>([
  'introduccion', 'exposicion', 'transicion', 'desarrollo', 'reexposicion',
  'coda', 'tema', 'variacion', 'estribillo', 'verso', 'puente', 'solo', 'libre',
]);

function parseRole(role: string | undefined, index: number): SectionRole {
  if (role === undefined) return index === 0 ? 'exposicion' : 'libre';
  if (!ROLES.has(role as SectionRole)) {
    fail('INVALID_REQUEST', `Funcion formal desconocida: "${role}"`, {
      role,
      available: [...ROLES],
    });
  }
  return role as SectionRole;
}

/**
 * Tonalidad del grado indicado respecto a la tonica.
 *
 * En la forma sonata el segundo tema va en la dominante si la obra esta en
 * mayor, y en el relativo mayor si esta en menor: es la convencion que hace
 * que el plan tonal suene a lo que se espera de la forma.
 */
function keyOfDegree(home: KeySignature, degree: number): KeySignature {
  if (degree === 1) return home;

  if (home.isMinorLike && degree === 5) {
    // El relativo mayor, no la dominante menor.
    return KeySignature.of(Scale.of(home.tonic, 'minor').degree(3), 'major');
  }

  const scale = home.isMinorLike
    ? Scale.of(home.tonic, 'minor')
    : Scale.fromKey(home);
  const tonic = scale.degree(degree);

  // Los grados 2, 3 y 6 son menores en modo mayor; el 4 y el 5, mayores.
  const minorDegrees = home.isMinorLike ? [4, 5] : [2, 3, 6];
  return KeySignature.of(tonic, minorDegrees.includes(degree) ? 'minor' : 'major');
}

// ------------------------------------------------------------------ lectura

export interface SectionListResult {
  readonly sections: readonly {
    id: string;
    name: string;
    role: string;
    from: number;
    to: number;
    measures: number;
    key: string | null;
    motifs: readonly string[];
  }[];
  readonly totalMeasures: number;
  /** Compases ya escritos, para ver cuanto queda por componer. */
  readonly writtenMeasures: number;
}

export function listSections(movement: Movement): SectionListResult {
  return {
    sections: movement.form.sections.map((section) => ({
      id: section.id,
      name: section.name,
      role: section.role,
      from: section.fromMeasure,
      to: section.toMeasure,
      measures: section.toMeasure - section.fromMeasure + 1,
      key: section.key?.name ?? null,
      motifs: section.motifs,
    })),
    totalMeasures: movement.form.totalMeasures,
    writtenMeasures: movement.measureCount,
  };
}

// --------------------------------------------------------------- conjuntos

export interface EnsembleAddInput {
  readonly ensemble: string;
}

export interface EnsembleAddResult {
  readonly ensemble: string;
  readonly parts: readonly { partId: string; instrument: string; name: string }[];
}

/**
 * Monta un conjunto completo de una sola llamada.
 *
 * Una orquesta sinfonica son treinta llamadas a `part_add` con sus treinta
 * oportunidades de olvidar un instrumento o equivocar un id. Las plantillas
 * ponen las partes en ORDEN DE PARTITURA, que es como se lee una obra.
 */
export function addEnsemble(movement: Movement, input: EnsembleAddInput): EnsembleAddResult {
  const preset = ENSEMBLE_PRESETS[input.ensemble];
  if (!preset) {
    fail('INVALID_REQUEST', `Conjunto desconocido: "${input.ensemble}"`, {
      ensemble: input.ensemble,
      available: Object.keys(ENSEMBLE_PRESETS),
    });
  }

  const parts = preset.instruments.map((instrumentId) => {
    const instrument = getInstrument(instrumentId);
    if (!instrument) {
      return fail('INVALID_REQUEST', `La plantilla "${input.ensemble}" usa "${instrumentId}"`, {
        instrumentId,
      });
    }
    const result = addPart(movement, { instrumentId });
    return { partId: result.partId, instrument: result.instrument, name: result.name };
  });

  return { ensemble: preset.name, parts };
}

export function listEnsembles(): readonly {
  id: string;
  name: string;
  description: string;
  size: number;
}[] {
  return Object.entries(ENSEMBLE_PRESETS).map(([id, preset]) => ({
    id,
    name: preset.name,
    description: preset.description,
    size: preset.instruments.length,
  }));
}

export function listForms(): readonly {
  id: string;
  name: string;
  description: string;
  sections: number;
}[] {
  return Object.entries(FORM_TEMPLATES).map(([id, template]) => ({
    id,
    name: template.name,
    description: template.description,
    sections: template.sections.length,
  }));
}

export type { Score };
