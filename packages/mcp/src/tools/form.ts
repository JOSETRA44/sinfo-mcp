import { z } from 'zod';
import { movementIdSchema, scoreIdSchema } from './common.js';
import { defineTool } from './types.js';

export const planForm = defineTool({
  name: 'plan_form',
  title: 'Planificar la forma del movimiento',
  description:
    'Divide el movimiento en secciones con nombre, funcion formal, duracion y tonalidad. Es el ' +
    'nivel en el que se decide una obra larga: sin el, se escriben compases sueltos sin saber ' +
    'donde se esta; con el, se sabe que se esta en el desarrollo y cuantos compases quedan.\n\n' +
    'FORMAS: sonata (exposicion, desarrollo, reexposicion), ternary (ABA), binary, rondo ' +
    '(ABACA), theme_and_variations, minuet_trio, song (verso-estribillo), through_composed.\n\n' +
    'Los compases se reparten segun las proporciones habituales de cada forma y el plan tonal ' +
    'sale solo: el segundo tema de una sonata va a la dominante si la obra esta en mayor, y al ' +
    'relativo mayor si esta en menor. Usa `sections` para una forma a medida.',
  inputSchema: {
    scoreId: scoreIdSchema,
    movementId: movementIdSchema,
    form: z
      .enum([
        'sonata', 'ternary', 'binary', 'rondo',
        'theme_and_variations', 'minuet_trio', 'song', 'through_composed',
      ])
      .optional()
      .describe('Plantilla formal. Por defecto ternary.'),
    totalMeasures: z
      .int()
      .min(4)
      .max(2000)
      .optional()
      .describe('Compases totales a repartir entre las secciones. Por defecto 32.'),
    sections: z
      .array(
        z.object({
          name: z.string().min(1),
          role: z
            .enum([
              'introduccion', 'exposicion', 'transicion', 'desarrollo', 'reexposicion',
              'coda', 'tema', 'variacion', 'estribillo', 'verso', 'puente', 'solo', 'libre',
            ])
            .optional(),
          measures: z.int().min(1),
          key: z.string().optional().describe('Tonalidad de la seccion.'),
          notes: z.string().optional().describe('Anotacion libre sobre la seccion.'),
        }),
      )
      .optional()
      .describe('Secciones a medida, en orden. Si se indican, se ignora `form`.'),
    replace: z
      .boolean()
      .optional()
      .describe('Sustituir el plan anterior. Por defecto si.'),
  },
  handler: (args, { service }) => service.planForm(args.scoreId, args.movementId, args),
});

export const sectionList = defineTool({
  name: 'section_list',
  title: 'Ver el plan formal',
  description:
    'Devuelve las secciones del movimiento con sus compases, funcion y tonalidad, mas cuantos ' +
    'compases hay escritos ya. Es el mapa para no perderse en una obra larga: dice donde ' +
    'empieza cada seccion y cuanto queda por componer.',
  inputSchema: {
    scoreId: scoreIdSchema,
    movementId: movementIdSchema,
  },
  hints: { readOnlyHint: true, idempotentHint: true },
  handler: (args, { service }) => service.sections(args.scoreId, args.movementId),
});

export const ensembleAdd = defineTool({
  name: 'ensemble_add',
  title: 'Anadir un conjunto completo',
  description:
    'Monta todas las partes de un conjunto de una sola llamada, en orden de partitura. Una ' +
    'orquesta sinfonica son treinta llamadas a part_add con treinta oportunidades de olvidar ' +
    'un instrumento; esto lo hace de una vez y numera solo los repetidos (violin, violin2).\n\n' +
    'Usa ensemble_list para ver los disponibles: desde cuarteto de cuerda a orquesta ' +
    'sinfonica, pasando por quinteto de viento, big band, banda de rock y coro mixto.',
  inputSchema: {
    scoreId: scoreIdSchema,
    movementId: movementIdSchema,
    ensemble: z
      .string()
      .min(1)
      .describe('Id de la plantilla, p. ej. "symphony_orchestra" o "string_quartet".'),
  },
  handler: (args, { service }) => service.addEnsemble(args.scoreId, args.movementId, args),
});

export const ensembleList = defineTool({
  name: 'ensemble_list',
  title: 'Listar plantillas de conjunto',
  description:
    'Devuelve las plantillas disponibles con su descripcion y cuantas partes tiene cada una.',
  inputSchema: {},
  hints: { readOnlyHint: true, idempotentHint: true },
  handler: (_args, { service }) => service.ensembles(),
});

export const formList = defineTool({
  name: 'form_list',
  title: 'Listar formas musicales',
  description:
    'Devuelve las formas que entiende plan_form, con su descripcion y cuantas secciones tiene ' +
    'cada una.',
  inputSchema: {},
  hints: { readOnlyHint: true, idempotentHint: true },
  handler: (_args, { service }) => service.forms(),
});

export const orchestrate = defineTool({
  name: 'orchestrate',
  title: 'Orquestar un pasaje',
  description:
    'Reparte la musica de una parte entre el resto del conjunto: decide quien lleva la melodia, ' +
    'quien la armonia y quien el bajo, ajusta cada linea al registro comodo de su instrumento ' +
    'por OCTAVAS (nunca por otro intervalo, que cambiaria la tonalidad) y aplica la ' +
    'transposicion de cada instrumento.\n\n' +
    'ESTILOS\n' +
    '  melodia-acompanamiento  una linea destacada sobre acompanamiento (por defecto)\n' +
    '  tutti                   la melodia doblada en muchos instrumentos; masa sonora\n' +
    '  coral                   cada instrumento con su propia linea, sin relleno\n' +
    '  camara                  textura aligerada; parte del acompanamiento calla\n\n' +
    'Comprueba el BALANCE y avisa si el acompanamiento tapa a la melodia. El peso de cada ' +
    'linea sale del tamano de seccion y la proyeccion de cada instrumento: una flauta sola ' +
    'contra tres trombones queda enterrada aunque las dos lineas esten bien escritas, y eso no ' +
    'se ve leyendo la partitura nota a nota.',
  inputSchema: {
    scoreId: scoreIdSchema,
    movementId: movementIdSchema,
    sourcePartId: z.string().min(1).describe('Parte de la que sale el material melodico.'),
    sourceVoiceId: z.string().optional().describe('Voz dentro de la parte de origen.'),
    targetPartIds: z
      .array(z.string())
      .optional()
      .describe('Partes destino. Si se omite, todas menos la de origen y la percusion.'),
    progression: z
      .array(z.string())
      .optional()
      .describe('Numeros romanos que sostienen el pasaje. Sin ellos, la armonia calla.'),
    key: z.string().optional().describe('Tonalidad. Por defecto, la de la obra.'),
    style: z
      .enum(['tutti', 'melodia-acompanamiento', 'coral', 'camara'])
      .optional()
      .describe('Estilo de textura.'),
    fromMeasure: z.int().min(1).optional().describe('Primer compas a orquestar.'),
    toMeasure: z.int().min(1).optional().describe('Ultimo compas incluido.'),
    maxMelodyDoublings: z
      .int()
      .min(1)
      .max(40)
      .optional()
      .describe('Tope de instrumentos que doblan la melodia.'),
    replace: z
      .boolean()
      .optional()
      .describe('Vaciar las partes destino antes de escribir. Por defecto no.'),
    seed: z
      .string()
      .optional()
      .describe('Semilla: la misma da el mismo reparto de papeles.'),
  },
  handler: (args, { service }) => service.orchestrate(args.scoreId, args.movementId, args),
});

export const grooveList = defineTool({
  name: 'groove_list',
  title: 'Listar grooves disponibles',
  description:
    'Devuelve los grooves que entiende `export`, con lo que hace cada uno. El groove es ' +
    'INTERPRETACION, no notacion: cambia como suena el MIDI y el audio, no lo que aparece en ' +
    'la partitura. Un pasaje con swing se escribe con corcheas rectas y se interpreta ' +
    'balanceado; escribirlo en tresillos seria notacion incorrecta.',
  inputSchema: {},
  hints: { readOnlyHint: true, idempotentHint: true },
  handler: (_args, { service }) => service.grooves(),
});
