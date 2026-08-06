import { z } from 'zod';
import { movementIdSchema, partIdSchema, scoreIdSchema, voiceIdSchema } from './common.js';
import { defineTool } from './types.js';

const seedSchema = z
  .string()
  .optional()
  .describe(
    'Semilla de aleatoriedad. La MISMA semilla con los mismos parametros da exactamente el ' +
      'mismo resultado, siempre. Si te gusta lo que sale, apunta la semilla que devuelve la ' +
      'herramienta y podras reproducirlo o variar solo una cosa manteniendo el resto.',
  );

export const motifCreate = defineTool({
  name: 'motif_create',
  title: 'Crear un motivo tematico',
  description:
    'Guarda una celula tematica en la sesion y devuelve su motifId. Un motivo es material ' +
    'destinado a TRANSFORMARSE: casi todo el repertorio clasico crece aplicando inversion, ' +
    'retrogradacion, aumentacion y secuencia a celulas de tres o cuatro notas.\n\n' +
    'Guardarlo en el servidor conserva su genealogia y evita que tengas que reenviar las ' +
    'notas en cada transformacion. Se escribe en notacion SinfoScript, igual que part_write.',
  inputSchema: {
    scoreId: scoreIdSchema,
    notation: z.string().min(1).describe('El motivo en SinfoScript, p. ej. "c4/e d4/e e4/q".'),
    motifId: z.string().optional().describe('Id propio. Si se omite: motif-1, motif-2...'),
  },
  handler: (args, { service }) => service.motifCreate(args.scoreId, args),
});

export const motifDevelop = defineTool({
  name: 'motif_develop',
  title: 'Desarrollar un motivo',
  description:
    'Aplica una cadena de transformaciones tematicas y guarda el resultado como motivo nuevo. ' +
    'El original nunca se toca, asi que puedes derivar varias variantes del mismo tema sin ' +
    'que unas dependan de otras.\n\n' +
    'TRANSFORMACIONES\n' +
    '  transpose        traslada; necesita interval ("P5", "-M2", "m3")\n' +
    '  invert           da la vuelta al perfil por GRADOS de la escala (se queda en la tonalidad)\n' +
    '  invertChromatic  da la vuelta a los intervalos exactos (puede salir de la tonalidad)\n' +
    '  retrograde       del final al principio\n' +
    '  augment          alarga las duraciones; factor (2 por defecto)\n' +
    '  diminish         acorta las duraciones; factor (2 por defecto)\n' +
    '  sequence         repite desplazado; steps e interval\n' +
    '  fragment         se queda con un trozo; from y count\n' +
    '  repeat           repite tal cual; factor\n\n' +
    'Para desarrollos, `fragment` sobre la cabeza del tema es lo que sostiene una seccion ' +
    'entera sin volver a exponer el tema completo.',
  inputSchema: {
    scoreId: scoreIdSchema,
    movementId: movementIdSchema,
    motifId: z.string().min(1).describe('Motivo de partida.'),
    transformations: z
      .array(
        z.object({
          op: z.enum([
            'transpose', 'invert', 'invertChromatic', 'retrograde',
            'augment', 'diminish', 'sequence', 'fragment', 'repeat',
          ]),
          interval: z.string().optional().describe('Para transpose y sequence: "P5", "-M2".'),
          factor: z.number().optional().describe('Para augment, diminish y repeat.'),
          steps: z.int().optional().describe('Para sequence: cuantas repeticiones.'),
          from: z.int().optional().describe('Para fragment: primer evento, base 0.'),
          count: z.int().optional().describe('Para fragment: cuantos eventos.'),
          axis: z.string().optional().describe('Para invert: eje, p. ej. "G4".'),
        }),
      )
      .min(1)
      .describe('Se aplican en orden, encadenadas.'),
    key: z.string().optional().describe('Tonalidad de referencia. Por defecto, la de la obra.'),
    scaleType: z.string().optional().describe('Escala: major, minor, harmonicMinor, dorian...'),
    resultId: z.string().optional().describe('Id del motivo resultante.'),
  },
  handler: (args, { service }) => service.motifDevelop(args.scoreId, args.movementId, args),
});

export const motifWrite = defineTool({
  name: 'motif_write',
  title: 'Escribir un motivo en una parte',
  description:
    'Vuelca un motivo guardado en una parte de la partitura, opcionalmente transportado. Es el ' +
    'paso que convierte material tematico en musica escrita.',
  inputSchema: {
    scoreId: scoreIdSchema,
    movementId: movementIdSchema,
    motifId: z.string().min(1).describe('Motivo a escribir.'),
    partId: partIdSchema,
    voiceId: voiceIdSchema,
    atMeasure: z.int().min(1).optional().describe('Compas donde empezar.'),
    transposeTo: z
      .string()
      .optional()
      .describe('Transportar al escribir: "P5", "-P8". Util para exponer el tema en otra voz.'),
  },
  handler: (args, { service }) => service.motifWrite(args.scoreId, args.movementId, args),
});

export const motifList = defineTool({
  name: 'motif_list',
  title: 'Listar los motivos de la sesion',
  description:
    'Devuelve los motivos guardados con su notacion y su genealogia: de que motivo sale cada ' +
    'uno y por que transformaciones. Util para no perder el hilo del material tematico.',
  inputSchema: { scoreId: scoreIdSchema },
  hints: { readOnlyHint: true, idempotentHint: true },
  handler: (args, { service }) => service.motifList(args.scoreId),
});

export const melodyGenerate = defineTool({
  name: 'melody_generate',
  title: 'Generar una melodia',
  description:
    'Genera una melodia sobre la armonia indicada y la guarda como motivo, opcionalmente ' +
    'escribiendola en una parte. Respeta la escala, se mantiene en el rango, prefiere el grado ' +
    'conjunto, coloca notas del acorde en tiempo fuerte, resuelve los saltos y cierra en una ' +
    'nota estable.\n\n' +
    'Si indicas partId, el rango se toma de la TESITURA del instrumento: no hace falta que ' +
    'calcules tu que notas puede tocar una flauta.\n\n' +
    'CONTORNOS: arch (arco, culmina por el medio), inverted-arch, ascending, descending, ' +
    'wave, flat. El contorno es lo que convierte una sucesion de notas correctas en una FRASE.\n\n' +
    'Devuelve tambien por que se eligio cada nota, para que puedas ajustar los parametros en ' +
    'vez de tirar el resultado.',
  inputSchema: {
    scoreId: scoreIdSchema,
    movementId: movementIdSchema,
    partId: z
      .string()
      .optional()
      .describe('Parte donde escribir. Tambien fija el rango segun su tesitura.'),
    voiceId: voiceIdSchema,
    measures: z.int().min(1).max(64).optional().describe('Cuantos compases. Por defecto 4.'),
    progression: z
      .array(z.string())
      .optional()
      .describe('Numeros romanos que sostienen la melodia, p. ej. ["I","vi","ii","V7"].'),
    key: z.string().optional().describe('Tonalidad. Por defecto, la de la obra.'),
    scaleType: z
      .string()
      .optional()
      .describe('Escala: major, minor, harmonicMinor, dorian, majorPentatonic, blues...'),
    lowest: z.string().optional().describe('Nota mas grave, p. ej. "G3".'),
    highest: z.string().optional().describe('Nota mas aguda, p. ej. "E5".'),
    contour: z
      .enum(['arch', 'inverted-arch', 'ascending', 'descending', 'wave', 'flat'])
      .optional()
      .describe('Perfil de la frase.'),
    rhythm: z
      .array(z.string())
      .optional()
      .describe('Figuras disponibles: ["q","e","h"]. Se reparten al azar hasta cuadrar.'),
    restProbability: z
      .number()
      .min(0)
      .max(0.8)
      .optional()
      .describe('Probabilidad de silencio en cada figura, de 0 a 0.8.'),
    atMeasure: z.int().min(1).optional().describe('Compas donde empezar a escribir.'),
    motifId: z.string().optional().describe('Id con el que guardar la melodia.'),
    seed: seedSchema,
  },
  handler: (args, { service }) => service.melodyGenerate(args.scoreId, args.movementId, args),
});

export const counterpointAdd = defineTool({
  name: 'counterpoint_add',
  title: 'Anadir una voz en contrapunto',
  description:
    'Escribe una segunda voz contra la musica de otra parte, respetando las reglas del ' +
    'contrapunto de primera especie: solo consonancias, sin quintas ni octavas paralelas, sin ' +
    'cruce de voces, empezando y terminando en consonancia perfecta, y con los saltos ' +
    'resueltos por grado conjunto.\n\n' +
    'Usa busqueda con RETROCESO, no eleccion nota a nota: las reglas se condicionan entre si y ' +
    'una eleccion correcta en un compas puede dejar el siguiente sin salida legal. Si no ' +
    'existe solucion estricta, cede reglas de estilo (nunca las disonancias) y te dice cuales ' +
    'en el campo `relaxed`.\n\n' +
    'El rango sale de la tesitura de la parte destino si no lo indicas.',
  inputSchema: {
    scoreId: scoreIdSchema,
    movementId: movementIdSchema,
    sourcePartId: z.string().min(1).describe('Parte que hace de cantus firmus.'),
    targetPartId: z.string().min(1).describe('Parte donde se escribe el contrapunto.'),
    sourceVoiceId: voiceIdSchema,
    targetVoiceId: voiceIdSchema,
    above: z
      .boolean()
      .optional()
      .describe('true escribe por encima del cantus (por defecto), false por debajo.'),
    key: z.string().optional().describe('Tonalidad. Por defecto, la de la obra.'),
    scaleType: z.string().optional().describe('Escala de referencia.'),
    lowest: z.string().optional().describe('Nota mas grave permitida.'),
    highest: z.string().optional().describe('Nota mas aguda permitida.'),
    fromMeasure: z.int().min(1).optional().describe('Primer compas del cantus a usar.'),
    toMeasure: z.int().min(1).optional().describe('Ultimo compas incluido.'),
    seed: seedSchema,
  },
  handler: (args, { service }) => service.counterpoint(args.scoreId, args.movementId, args),
});
