import { KeySignature, TimeSignature } from '@sinfo/core';
import { z } from 'zod';
import { keySchema, scoreIdSchema, timeSignatureSchema } from './common.js';
import { defineTool } from './types.js';

/** Opciones de cuantizacion, compartidas por importar y recuantizar. */
const quantizeShape = {
  gapPolicy: z
    .enum(['measured', 'legato'])
    .optional()
    .describe(
      'Que hacer con los huecos entre notas. "measured" (por defecto) respeta el silencio ' +
        'tal y como se toco: fiel, pero llena la partitura de silencios cortos que nadie ' +
        'escribiria. "legato" alarga cada nota hasta la siguiente: mas limpio de leer y casi ' +
        'siempre lo que el interprete queria decir, sobre todo en cuerda y viento.',
    ),
  subdivisions: z
    .array(z.int().min(1).max(32))
    .optional()
    .describe(
      'En cuantas partes se puede dividir el pulso. Por defecto [1,2,3,4,6,8,12,16], que ' +
        'cubre binario y ternario. Limitalo a [1,2,4,8,16] si sabes que la musica no tiene ' +
        'tresillos y salen figuras ternarias donde no toca.',
    ),
  complexityWeight: z
    .number()
    .min(0)
    .max(0.1)
    .optional()
    .describe(
      'Cuanto penaliza usar figuras finas. 0.008 por defecto. Subirlo da partituras mas ' +
        'simples y menos fieles; bajarlo persigue cada microdesviacion con fusas.',
    ),
  maxVoices: z
    .int()
    .min(1)
    .max(8)
    .optional()
    .describe(
      'Voces simultaneas por parte antes de recortar notas. 4 por defecto. Se supera igualmente ' +
        'si respetarlo obligaria a perder notas.',
    ),
  key: keySchema.describe(
    'Impone la tonalidad en vez de estimarla. Util cuando la estimacion sale con poca ' +
      'correlacion o confunde una tonalidad con su relativa: cambia como se escriben las ' +
      'alteraciones, no que notas suenan.',
  ),
  timeSignature: timeSignatureSchema.describe(
    'Impone el compas en vez de deducirlo. Necesario para distinguir 6/8 de 3/4, que miden ' +
      'lo mismo y no se pueden separar mirando solo los tiempos fuertes.',
  ),
} as const;

export const importMidi = defineTool({
  name: 'import_midi',
  title: 'Importar un archivo MIDI como partitura',
  description:
    'Lee un archivo .mid del disco y lo convierte en una partitura nueva, devolviendo su ' +
    'scoreId. A partir de ahi funcionan TODAS las demas herramientas: puedes analizarle la ' +
    'armonia, comprobar la conduccion de voces, reorquestarlo para otro conjunto y ' +
    'exportarlo.\n\n' +
    'No es una conversion mecanica de notas. El archivo trae tiempos medidos —y si se grabo ' +
    'tocando, todo el rubato del interprete—, asi que hay que decidir figuras, compas, ' +
    'alteraciones y voces. Esas decisiones vienen en la respuesta: mira siempre "warnings" y ' +
    '"keyMargin" antes de dar el resultado por bueno.\n\n' +
    'Si algo no cuadra, no vuelvas a importar: usa transcribe_requantize, que reaprovecha la ' +
    'lectura y te deja probar otros parametros al instante.',
  inputSchema: {
    path: z
      .string()
      .min(1)
      .describe('Ruta al archivo .mid o .midi en el disco de la persona.'),
    title: z.string().optional().describe('Titulo de la obra. Por defecto, el nombre del archivo.'),
    composer: z.string().optional(),
    defaultInstrument: z
      .string()
      .optional()
      .describe(
        'Instrumento para las pistas que no declaran programa General MIDI. Por defecto piano. ' +
          'Usa instruments_list para ver los ids.',
      ),
    ...quantizeShape,
  },
  hints: { readOnlyHint: false, idempotentHint: false },
  handler: (args, { service }) =>
    service.importFile(args.path, {
      ...toOptions(args),
      ...(args.title === undefined ? {} : { title: args.title }),
      ...(args.composer === undefined ? {} : { composer: args.composer }),
      ...(args.defaultInstrument === undefined
        ? {}
        : { defaultInstrument: args.defaultInstrument }),
    }),
});

export const transcribeRequantize = defineTool({
  name: 'transcribe_requantize',
  title: 'Volver a cuantizar una transcripcion con otros parametros',
  description:
    'Reconvierte en partitura la MISMA interpretacion que ya se leyo, con otros ajustes, y ' +
    'devuelve un scoreId nuevo. No vuelve a tocar el disco.\n\n' +
    'Existe porque afinar una transcripcion es prueba y error: si salen tresillos donde ' +
    'esperabas semicorcheas, limita "subdivisions"; si la partitura esta plagada de silencios ' +
    'diminutos, prueba gapPolicy "legato"; si las alteraciones estan escritas al reves, impon ' +
    'la tonalidad.\n\n' +
    'La version anterior NO se borra, asi que puedes exportar las dos y compararlas. Solo ' +
    'funciona sobre partituras que vinieron de import_midi.',
  inputSchema: {
    scoreId: scoreIdSchema.describe('Partitura transcrita de la que partir.'),
    ...quantizeShape,
  },
  hints: { readOnlyHint: false, idempotentHint: true },
  handler: (args, { service }) => service.requantize(args.scoreId, toOptions(args)),
});

/** Traduce los argumentos planos de la herramienta a las opciones anidadas del motor. */
function toOptions(args: {
  gapPolicy?: 'measured' | 'legato' | undefined;
  subdivisions?: number[] | undefined;
  complexityWeight?: number | undefined;
  maxVoices?: number | undefined;
  key?: string | undefined;
  timeSignature?: string | undefined;
}) {
  const quantize = {
    ...(args.gapPolicy === undefined ? {} : { gapPolicy: args.gapPolicy }),
    ...(args.subdivisions === undefined ? {} : { subdivisions: args.subdivisions }),
    ...(args.complexityWeight === undefined ? {} : { complexityWeight: args.complexityWeight }),
  };
  return {
    ...(Object.keys(quantize).length === 0 ? {} : { quantize }),
    ...(args.maxVoices === undefined ? {} : { separate: { maxVoices: args.maxVoices } }),
    ...(args.key === undefined ? {} : { key: KeySignature.parse(args.key) }),
    ...(args.timeSignature === undefined
      ? {}
      : { timeSignature: TimeSignature.parse(args.timeSignature) }),
  };
}
