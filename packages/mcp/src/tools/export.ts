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
    '"musicxml" abre en MuseScore, Sibelius, Finale y Dorico. "svg" graba la partitura como ' +
    'imagen: es la unica salida que TU puedes revisar directamente, para comprobar que la ' +
    'notacion quedo legible. "wav" sintetiza el audio para que lo escuche la persona.\n\n' +
    'El audio necesita un SoundFont General MIDI: sin el se usa un banco minimo de un solo ' +
    'sonido y el resultado no representa la obra. Se configura con la variable de entorno ' +
    'SINFO_SOUNDFONT. Los formatos lilypond, abc y mp3 aun no tienen adaptador; si pides uno ' +
    'que falta, el error te dice cuales hay disponibles ahora mismo.',
  inputSchema: {
    scoreId: scoreIdSchema,
    format: z
      .enum(['midi', 'json', 'musicxml', 'lilypond', 'abc', 'svg', 'wav', 'mp3'])
      .optional()
      .describe('Formato de salida. Por defecto, midi.'),
    movementId: movementIdSchema.describe(
      'Exportar un solo movimiento. Si se omite, todos concatenados.',
    ),
    groove: z
      .enum(['straight', 'swing', 'shuffle', 'laid_back', 'driving', 'funk', 'waltz'])
      .optional()
      .describe(
        'Groove al interpretar. Afecta solo a midi y wav: NO cambia la partitura, porque un ' +
          'pasaje con swing se escribe con corcheas rectas. Usa groove_list para ver que hace ' +
          'cada uno.',
      ),
    humanize: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        'Cuanto se desordena el resultado, de 0 a 1. Descuadra el tiempo y varia la ' +
          'intensidad para que no suene a maquina. 0.2 a 0.4 es lo natural; por encima de 0.7 ' +
          'suena a interprete inseguro.',
      ),
    performanceSeed: z
      .string()
      .optional()
      .describe('Semilla de la humanizacion: la misma da exactamente la misma interpretacion.'),
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
