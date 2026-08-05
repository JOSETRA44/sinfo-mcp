import { z } from 'zod';
import { movementIdSchema, partIdSchema, scoreIdSchema, voiceIdSchema } from './common.js';
import { defineTool } from './types.js';

const ROMAN_GUIDE = `
NUMEROS ROMANOS
  mayusculas = acorde mayor, minusculas = menor:  I ii iii IV V vi
  septima     V7  ii7  IV7        septima disminuida  vii°7
  calidad     vii° disminuido,  viiø7 semidisminuido,  III+ aumentado
  inversion   por cifrado de bajo:
                triadas   I (fundamental)  I6 (primera)  I64 (segunda)
                septimas  V7  V65  V43  V42
  alteracion  bVII  bVI  #iv     acordes prestados de otra tonalidad
  secundaria  V/V  V7/IV  vii°/V  dominante del grado indicado

En modo MENOR se usa la escala armonica, asi que V y vii° salen con la
sensible alterada: en la menor, V es Mi-Sol#-Si. Es lo que hace posible la
cadencia autentica.
`.trim();

export const harmonyProgression = defineTool({
  name: 'harmony_progression',
  title: 'Generar una progresion armonica',
  description:
    'Convierte una serie de numeros romanos en acordes reales de la tonalidad, y opcionalmente ' +
    'los escribe en una parte. Devuelve las notas de cada acorde, su cifrado, su funcion tonal ' +
    '(tonica, subdominante, dominante) y que cadencia forman los dos ultimos.\n\n' +
    'Usalo para armonizar antes de escribir melodia, o para materializar rapido un esqueleto ' +
    'armonico. La tonalidad se toma de la partitura si no la indicas, que es lo mas seguro: ' +
    'declararla a mano en cada llamada acaba produciendo incoherencias.\n\n' +
    ROMAN_GUIDE,
  inputSchema: {
    scoreId: scoreIdSchema,
    movementId: movementIdSchema,
    progression: z
      .array(z.string().min(1))
      .min(1)
      .describe('Numeros romanos en orden, p. ej. ["I","vi","ii","V7","I"].'),
    key: z
      .string()
      .optional()
      .describe('Tonalidad. Si se omite, la de la partitura (recomendado).'),
    partId: z
      .string()
      .optional()
      .describe('Parte donde escribir los acordes. Si se omite, solo se devuelven.'),
    voiceId: voiceIdSchema,
    duration: z
      .string()
      .optional()
      .describe('Figura de cada acorde: w h q e s, con puntillos. Por defecto w (redonda).'),
    bassOctave: z
      .int()
      .min(0)
      .max(8)
      .optional()
      .describe('Octava del bajo del acorde. Por defecto 3.'),
    atMeasure: z.int().min(1).optional().describe('Compas donde empezar a escribir.'),
  },
  handler: (args, { service }) => service.harmony(args.scoreId, args.movementId, args),
});

export const analyzeHarmony = defineTool({
  name: 'analyze_harmony',
  title: 'Analizar la armonia escrita',
  description:
    'Lee lo que hay escrito y devuelve su analisis funcional: que acorde suena en cada compas, ' +
    'su numero romano, su funcion tonal, si es diatonico o prestado, y donde hay cadencias.\n\n' +
    'Agrupa TODAS las partes seleccionadas en cada instante, porque la armonia es lo que suena ' +
    'entre todas a la vez. Usalo para comprobar que la progresion que tenias en mente es la que ' +
    'de verdad escribiste, o para entender musica importada de un archivo.',
  inputSchema: {
    scoreId: scoreIdSchema,
    movementId: movementIdSchema,
    partIds: z
      .array(z.string())
      .optional()
      .describe('Partes a considerar. Si se omite, todas menos la percusion.'),
    fromMeasure: z.int().min(1).optional().describe('Primer compas. Por defecto, el 1.'),
    toMeasure: z.int().min(1).optional().describe('Ultimo compas incluido.'),
  },
  hints: { readOnlyHint: true, idempotentHint: true },
  handler: (args, { service }) => service.analyzeHarmony(args.scoreId, args.movementId, args),
});

export const checkVoiceLeading = defineTool({
  name: 'check_voice_leading',
  title: 'Comprobar la conduccion de voces',
  description:
    'Revisa como se mueven las voces entre acordes y reporta los problemas de escritura que no ' +
    'estan en ninguna nota suelta sino en la relacion entre dos. Distingue ERRORES de AVISOS.\n\n' +
    'Errores: quintas y octavas paralelas, que funden dos voces en una y hacen perder una linea ' +
    'de la textura.\n' +
    'Avisos: quintas y octavas directas, cruces, solapamientos, espaciado de mas de una octava ' +
    'entre voces agudas, saltos mayores de octava e intervalos aumentados.\n\n' +
    'Las voces se ordenan solas de grave a agudo. Llamalo despues de armonizar y antes de dar ' +
    'por buena una seccion: son errores que un modelo no detecta leyendo su propia salida.',
  inputSchema: {
    scoreId: scoreIdSchema,
    movementId: movementIdSchema,
    partIds: z
      .array(z.string())
      .optional()
      .describe('Partes a analizar. Si se omite, todas menos la percusion.'),
    fromMeasure: z.int().min(1).optional().describe('Primer compas. Por defecto, el 1.'),
    toMeasure: z.int().min(1).optional().describe('Ultimo compas incluido.'),
    maxSpacing: z
      .int()
      .min(1)
      .max(36)
      .optional()
      .describe('Semitonos maximos entre voces agudas contiguas. Por defecto 12.'),
    maxLeap: z
      .int()
      .min(1)
      .max(36)
      .optional()
      .describe('Salto melodico maximo sin aviso, en semitonos. Por defecto 12.'),
  },
  hints: { readOnlyHint: true, idempotentHint: true },
  handler: (args, { service }) => service.checkVoiceLeading(args.scoreId, args.movementId, args),
});
