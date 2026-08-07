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
  dropHarmonics: z
    .boolean()
    .optional()
    .describe(
      'Descartar armonicos falsos: notas que entran a la vez que otra mas grave y mas fuerte, a ' +
        'distancia de octava, doceava o quincena. Activado por defecto porque es el fallo mas ' +
        'comun de la transcripcion de audio. DESACTIVALO si la obra dobla la melodia en octavas ' +
        'de verdad, o perderas la voz de arriba.',
    ),
  mergeDuplicates: z
    .boolean()
    .optional()
    .describe(
      'Fundir en una sola las notas de la misma altura que se pisan. Los modelos parten a veces ' +
        'una nota tenida en varios trozos cuando la intensidad flaquea. Activado por defecto.',
    ),
  minConfidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      'Descartar notas por debajo de esta confianza. Util cuando la grabacion tiene ruido de ' +
        'fondo y aparecen notas fantasma sueltas.',
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

export const importAudio = defineTool({
  name: 'import_audio',
  title: 'Transcribir un archivo de audio a partitura',
  description:
    'Escucha un WAV y saca las notas, devolviendo un scoreId como cualquier otra partitura.\n\n' +
    'IMPORTANTE, porque cambia por completo cuando sirve: es MONOFONICO. Detecta una altura ' +
    'por instante, asi que funciona bien con una linea sola —voz, saxo, flauta, violin, bajo, ' +
    'silbido— y NO con acordes de piano, guitarra rasgueada ni mezclas completas. Ante un ' +
    'acorde devuelve una sola nota. Si el usuario trae una cancion entera, dilo antes de ' +
    'gastar la llamada.\n\n' +
    'Pasa SIEMPRE el tempo si lo sabes: el audio no trae mapa de tempo y sin el hay que ' +
    'suponer 120, lo que descuadra el ritmo entero. Pasa tambien instrumentId cuando lo ' +
    'conozcas: acota el registro de busqueda y elimina errores de octava.\n\n' +
    'Solo WAV sin comprimir. MP3 y OGG necesitan un decodificador nativo que este servidor ' +
    'evita a proposito; hay que convertirlos antes.',
  inputSchema: {
    path: z
      .string()
      .min(1)
      .describe(
        'Ruta a un archivo de audio en el disco (.wav, .mp3, .flac, .m4a, .ogg...), o una URL ' +
          'de la que descargarlo.\n\n' +
          'Las URL estan DESACTIVADAS por defecto y hay que habilitarlas con SINFO_ALLOW_URL=1. ' +
          'Si el usuario pide transcribir un enlace y sale desactivado, explicale que descargar ' +
          'de plataformas como YouTube incumple sus condiciones de servicio y que activarlo es ' +
          'decision suya: no lo presentes como un fallo de configuracion.',
      ),
    bpm: z
      .number()
      .min(20)
      .max(400)
      .optional()
      .describe(
        'Tempo real de la grabacion, en negras por minuto. Sin esto el ritmo sale mal salvo ' +
          'casualidad. Si el usuario no lo sabe, dile que lo cuente con un metronomo.',
      ),
    instrumentId: z
      .string()
      .optional()
      .describe(
        'Que instrumento suena, por id del catalogo (instruments_list). Acota la busqueda a su ' +
          'registro real, que es la mejor defensa contra los errores de octava. Con separateStems ' +
          'lo IMPONE a todas las pistas, asi que normalmente conviene omitirlo ahi.',
      ),
    separateStems: z
      .boolean()
      .optional()
      .describe(
        'Separar la mezcla en pistas antes de transcribir. Actívalo SIEMPRE que el audio sea una ' +
          'cancion con varios instrumentos: sin esto, voz, bajo y teclado acaban amontonados en ' +
          'una sola parte de cinco o seis voces que no representa a nadie y es ilegible. Con ' +
          'esto, cada linea va a su parte con su instrumento.\n\n' +
          'Necesita el sidecar. Tarda del orden de la duracion de la obra, pero se cachea: ' +
          'reintentar sobre el mismo archivo es instantaneo. La bateria se omite porque las ' +
          'alturas de la percusion no significan nada; su ritmo ya esta en el pulso detectado.',
      ),
    title: z.string().optional(),
    composer: z.string().optional(),
    ...quantizeShape,
  },
  hints: { readOnlyHint: false, idempotentHint: false },
  handler: (args, { service }) =>
    service.importFile(
      args.path,
      {
        ...toOptions(args),
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.composer === undefined ? {} : { composer: args.composer }),
        ...(args.instrumentId === undefined
          ? {}
          : { defaultInstrument: args.instrumentId }),
      },
      {
        ...(args.bpm === undefined ? {} : { bpm: args.bpm }),
        ...(args.instrumentId === undefined ? {} : { instrumentId: args.instrumentId }),
        ...(args.separateStems === undefined ? {} : { separateStems: args.separateStems }),
      },
    ),
});

export const mirStatus = defineTool({
  name: 'mir_status',
  title: 'Que puede leer esta instalacion',
  description:
    'Dice que formatos se saben leer, con que motor y que hace falta instalar para lo que ' +
    'falta. Consultalo ANTES de prometerle al usuario una transcripcion de audio: la ' +
    'diferencia entre tener el sidecar y no tenerlo es la diferencia entre poder con un piano ' +
    'y poder solo con una linea melodica sola.\n\n' +
    'Tambien informa de lo que hay en cache, que es lo que hace que reintentar sobre el mismo ' +
    'archivo sea instantaneo en vez de costar otros minutos.',
  inputSchema: {},
  hints: { readOnlyHint: true, idempotentHint: true },
  handler: (_args, { service }) => service.inputStatus(),
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
  dropHarmonics?: boolean | undefined;
  mergeDuplicates?: boolean | undefined;
  minConfidence?: number | undefined;
}) {
  const refine = {
    ...(args.dropHarmonics === undefined ? {} : { dropHarmonics: args.dropHarmonics }),
    ...(args.mergeDuplicates === undefined ? {} : { mergeDuplicates: args.mergeDuplicates }),
    ...(args.minConfidence === undefined ? {} : { minConfidence: args.minConfidence }),
  };
  const quantize = {
    ...(args.gapPolicy === undefined ? {} : { gapPolicy: args.gapPolicy }),
    ...(args.subdivisions === undefined ? {} : { subdivisions: args.subdivisions }),
    ...(args.complexityWeight === undefined ? {} : { complexityWeight: args.complexityWeight }),
  };
  return {
    ...(Object.keys(quantize).length === 0 ? {} : { quantize }),
    ...(Object.keys(refine).length === 0 ? {} : { refine }),
    ...(args.maxVoices === undefined ? {} : { separate: { maxVoices: args.maxVoices } }),
    ...(args.key === undefined ? {} : { key: KeySignature.parse(args.key) }),
    ...(args.timeSignature === undefined
      ? {}
      : { timeSignature: TimeSignature.parse(args.timeSignature) }),
  };
}
