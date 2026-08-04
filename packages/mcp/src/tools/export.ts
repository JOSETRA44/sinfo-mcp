import { z } from 'zod';
import { movementIdSchema, scoreIdSchema } from './common.js';
import { defineTool } from './types.js';

export const exportScore = defineTool({
  name: 'export',
  title: 'Exportar la partitura a un archivo',
  description:
    'Genera un archivo con la obra y devuelve su ruta en disco. "midi" produce un archivo ' +
    'estandar de formato 1 (una pista por parte, con mapa de tempo) que abre cualquier DAW ' +
    'o editor de partituras. "json" devuelve la estructura, util para inspeccionar sin ' +
    'abrir nada.\n\n' +
    'Los formatos musicxml, lilypond, abc, svg, wav y mp3 estan previstos pero necesitan ' +
    'adaptadores que pueden no estar montados; si pides uno que falta, el error te dice ' +
    'cuales hay disponibles ahora mismo.',
  inputSchema: {
    scoreId: scoreIdSchema,
    format: z
      .enum(['midi', 'json', 'musicxml', 'lilypond', 'abc', 'svg', 'wav', 'mp3'])
      .optional()
      .describe('Formato de salida. Por defecto, midi.'),
    movementId: movementIdSchema.describe(
      'Exportar un solo movimiento. Si se omite, todos concatenados.',
    ),
    ppq: z
      .int()
      .min(96)
      .max(15360)
      .optional()
      .describe(
        'Solo MIDI: pulsos por negra. 480 por defecto, exacto para tresillos y quintillos. ' +
          'Sube a 1680 si usas septillos.',
      ),
  },
  handler: (args, { service }) => service.export(args.scoreId, args),
});
