import { z } from 'zod';
import { keySchema, movementIdSchema, scoreIdSchema, tempoSchema, timeSignatureSchema } from './common.js';
import { defineTool } from './types.js';

export const scoreCreate = defineTool({
  name: 'score_create',
  title: 'Crear partitura',
  description:
    'Empieza una obra nueva y devuelve su scoreId. Es SIEMPRE el primer paso: todas las ' +
    'demas herramientas trabajan sobre una partitura ya creada. La partitura se guarda en ' +
    'el servidor, asi que no hay que reenviarla en cada llamada; eso es lo que permite ' +
    'escribir obras largas sin agotar el contexto. Sirve igual para una cancion que para ' +
    'una sinfonia: toda obra empieza con un movimiento y se anaden mas con movement_add.',
  inputSchema: {
    title: z.string().min(1).describe('Titulo de la obra.'),
    composer: z.string().optional().describe('Nombre del compositor.'),
    timeSignature: timeSignatureSchema.optional(),
    tempo: tempoSchema.optional(),
    key: keySchema.optional(),
    instruments: z
      .array(z.string())
      .optional()
      .describe(
        'Instrumentos iniciales por id (usa instruments_list para verlos). Crea una parte ' +
          'por cada uno. Repetir un id genera "violin", "violin2", etc.',
      ),
  },
  hints: { readOnlyHint: false, idempotentHint: false },
  handler: (args, { service }) => service.create(args),
});

export const scoreDescribe = defineTool({
  name: 'score_describe',
  title: 'Resumen de la partitura',
  description:
    'Devuelve la estructura de la obra: movimientos, partes, compases, tempo, tonalidad y ' +
    'duracion estimada, mas las ultimas acciones realizadas. Es un RESUMEN, no las notas: ' +
    'usalo para orientarte antes de seguir componiendo o cuando hayas perdido el hilo. ' +
    'Para ver las notas de una parte concreta, usa part_read.',
  inputSchema: {
    scoreId: scoreIdSchema,
  },
  hints: { readOnlyHint: true, idempotentHint: true },
  handler: (args, { service }) => service.describe(args.scoreId),
});

export const scoreList = defineTool({
  name: 'score_list',
  title: 'Listar partituras abiertas',
  description:
    'Lista las partituras abiertas en esta sesion del servidor, de la mas reciente a la mas ' +
    'antigua. Util si perdiste un scoreId o para retomar un trabajo anterior.',
  inputSchema: {},
  hints: { readOnlyHint: true, idempotentHint: true },
  handler: (_args, { service }) => ({ scores: service.list() }),
});

export const scoreClose = defineTool({
  name: 'score_close',
  title: 'Cerrar partitura',
  description:
    'Descarta una partitura de la memoria del servidor. Exporta antes lo que quieras ' +
    'conservar: esto no se puede deshacer.',
  inputSchema: {
    scoreId: scoreIdSchema,
  },
  hints: { destructiveHint: true, idempotentHint: true },
  handler: (args, { service }) => service.close(args.scoreId),
});

export const movementAdd = defineTool({
  name: 'movement_add',
  title: 'Anadir movimiento',
  description:
    'Anade un movimiento a la obra: el segundo tiempo de una sinfonia, el trio de un ' +
    'scherzo. Por defecto hereda las partes del movimiento anterior (la plantilla ' +
    'orquestal no cambia entre movimientos) y su compas, tempo y tonalidad, que puedes ' +
    'sobrescribir aqui mismo.',
  inputSchema: {
    scoreId: scoreIdSchema,
    title: z.string().min(1).describe('Titulo del movimiento, p. ej. "II. Andante".'),
    movementId: z.string().optional().describe('Id propio. Si se omite: m2, m3...'),
    marking: z
      .string()
      .optional()
      .describe('Indicacion de caracter, p. ej. "Allegro con brio".'),
    timeSignature: timeSignatureSchema.optional(),
    tempo: tempoSchema.optional(),
    key: keySchema.optional(),
    inheritParts: z
      .boolean()
      .optional()
      .describe('Copiar las partes del movimiento anterior. Por defecto, si.'),
  },
  handler: (args, { service }) => service.addMovement(args.scoreId, args),
});

export const timelineSet = defineTool({
  name: 'timeline_set',
  title: 'Cambiar compas, tempo o tonalidad',
  description:
    'Cambia el compas, el tempo o la tonalidad A PARTIR de un compas concreto. Se aplica a ' +
    'todo el movimiento, no a una parte suelta: cuando el director cambia a 6/8, cambia ' +
    'para todos. Sirve para modulaciones, cambios de metro y rubato por secciones.',
  inputSchema: {
    scoreId: scoreIdSchema,
    movementId: movementIdSchema,
    atMeasure: z
      .int()
      .min(1)
      .optional()
      .describe('Compas desde el que rige el cambio. Por defecto, el 1.'),
    timeSignature: timeSignatureSchema.optional(),
    tempo: tempoSchema.optional(),
    tempoMarking: z
      .string()
      .optional()
      .describe('Indicacion italiana: adagio, andante, allegro, presto...'),
    key: keySchema.optional(),
  },
  handler: (args, { service }) => service.setTimeline(args.scoreId, args.movementId, args),
});

export const timelineDescribe = defineTool({
  name: 'timeline_describe',
  title: 'Ver cambios de compas, tempo y tonalidad',
  description:
    'Lista donde cambia el compas, el tempo y la tonalidad a lo largo de un movimiento, ' +
    'indicando el numero de compas de cada cambio.',
  inputSchema: {
    scoreId: scoreIdSchema,
    movementId: movementIdSchema,
  },
  hints: { readOnlyHint: true, idempotentHint: true },
  handler: (args, { service }) => service.timeline(args.scoreId, args.movementId),
});
