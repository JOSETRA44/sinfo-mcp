import { z } from 'zod';
import {
  movementIdSchema,
  partIdSchema,
  scoreIdSchema,
  voiceIdSchema,
} from './common.js';
import { defineTool } from './types.js';

/** Documentacion de la notacion, incrustada en la descripcion de part_write. */
const SINFOSCRIPT_GUIDE = `
NOTACION SINFOSCRIPT (instrumentos afinados)
  nota        c4/q          altura + "/" + figura. c4 es do central.
  figuras     w h q e s t x = redonda, blanca, negra, corchea, semicorchea, fusa, semifusa
  puntillo    q.  q..       anade la mitad, y la mitad de la mitad
  irregular   e3  s5        tresillo de corchea, quintillo de semicorchea
  alteracion  C#4  Bb3  Ebb2   # sostenido, b bemol (se pueden repetir)
  silencio    r/h
  acorde      [c4,e4,g4]/h
  dinamica    mf            token suelto; rige hasta la siguiente. ppp pp p mp mf f ff fff
  articulac.  c4/q+stacc+accent    stacc ten accent marcato legato portato fermata
  ligadura    c4/q~ c4/h    la ~ ata con el evento siguiente
  compas      |             separador; SE VALIDA que cada compas sume lo que debe
  comentario  # solo si va precedido de espacio (para no chocar con el sostenido)

  Ejemplo:  mf c4/q e4/q g4/h | a4/e. g4/s f4/q+stacc r/q

NOTACION DE REJILLA (percusion y ritmos programados)
  Una fila por sonido, una casilla por subdivision (semicorchea por defecto).
    kick   x...x...x...x...
    snare  ....X.......X...
    hihat  x.x.x.x.x.x.x.x.
  Simbolos: x golpe, X acentuado, o suave, . o - silencio. | es decorativo.
  Nombres: kick snare hihat hihat_open crash ride clap rim tom_low tom_mid
           tom_high tambourine cowbell shaker clave (y sus alias en espanol).
  Las filas cortas se repiten en bucle contra las largas.
`.trim();

export const partAdd = defineTool({
  name: 'part_add',
  title: 'Anadir parte instrumental',
  description:
    'Anade un instrumento a un movimiento y devuelve su partId, rango y clave. Hazlo antes ' +
    'de escribir notas. Si repites instrumento, el id se numera solo ("violin", "violin2"), ' +
    'asi que no tienes que llevar la cuenta. Consulta instruments_list para ver los ' +
    'disponibles con sus rangos.',
  inputSchema: {
    scoreId: scoreIdSchema,
    movementId: movementIdSchema,
    instrumentId: z
      .string()
      .min(1)
      .describe('Id del instrumento, p. ej. "violin", "clarinet", "drums".'),
    partId: z.string().optional().describe('Id propio para la parte. Si se omite, se deriva.'),
    name: z
      .string()
      .optional()
      .describe('Nombre visible en la partitura, p. ej. "Violin I".'),
  },
  handler: (args, { service }) => service.addPart(args.scoreId, args.movementId, args),
});

export const partWrite = defineTool({
  name: 'part_write',
  title: 'Escribir musica en una parte',
  description:
    'Escribe notas en una parte usando notacion de texto compacta. Es la herramienta ' +
    'principal para componer. Por defecto ANADE al final de lo ya escrito; con ' +
    'mode:"replace" sustituye todo, y con atMeasure empieza en un compas concreto ' +
    'rellenando con silencios lo que falte (asi una trompa puede entrar en el compas 9 sin ' +
    'descuadrarse).\n\n' +
    'Si escribes barras de compas "|", se COMPRUEBA que cada compas sume los tiempos ' +
    'correctos y se rechaza la escritura si no cuadran. Usalas: es la forma mas barata de ' +
    'no acabar con una partitura descuadrada. Si el descuadre es intencionado (anacrusa), ' +
    'pasa strictBarlines:false.\n\n' +
    SINFOSCRIPT_GUIDE,
  inputSchema: {
    scoreId: scoreIdSchema,
    movementId: movementIdSchema,
    partId: partIdSchema,
    voiceId: voiceIdSchema,
    notation: z
      .string()
      .min(1)
      .describe('La musica en SinfoScript o en notacion de rejilla. Ver la guia de arriba.'),
    format: z
      .enum(['sinfoscript', 'grid'])
      .optional()
      .describe('Se detecta solo; indicalo solo si la deteccion falla.'),
    mode: z
      .enum(['append', 'replace'])
      .optional()
      .describe('append anade al final (por defecto); replace vacia la voz antes.'),
    atMeasure: z
      .int()
      .min(1)
      .optional()
      .describe('Compas donde empezar. Rellena con silencios hasta llegar.'),
    strictBarlines: z
      .boolean()
      .optional()
      .describe('Rechazar si los compases no cuadran. Por defecto, si.'),
  },
  handler: (args, { service }) => service.write(args.scoreId, args.movementId, args),
});

export const partRead = defineTool({
  name: 'part_read',
  title: 'Leer la musica de una parte',
  description:
    'Devuelve en SinfoScript los compases pedidos de una parte, para releer lo escrito ' +
    'antes de continuar o corregir. Hay que acotar por compases y el maximo por lectura es ' +
    '64: una obra entera no cabe en el contexto, y por eso no se devuelve nunca completa. ' +
    'Si no indicas rango, se leen 8 compases desde el primero.',
  inputSchema: {
    scoreId: scoreIdSchema,
    movementId: movementIdSchema,
    partId: partIdSchema,
    voiceId: voiceIdSchema,
    fromMeasure: z.int().min(1).optional().describe('Primer compas. Por defecto, el 1.'),
    toMeasure: z.int().min(1).optional().describe('Ultimo compas incluido.'),
  },
  hints: { readOnlyHint: true, idempotentHint: true },
  handler: (args, { service }) => service.read(args.scoreId, args.movementId, args),
});

export const partClear = defineTool({
  name: 'part_clear',
  title: 'Vaciar una parte',
  description:
    'Borra toda la musica de una parte, o de una sola de sus voces. La parte sigue ' +
    'existiendo, vacia. No se puede deshacer.',
  inputSchema: {
    scoreId: scoreIdSchema,
    movementId: movementIdSchema,
    partId: partIdSchema,
    voiceId: voiceIdSchema,
  },
  hints: { destructiveHint: true, idempotentHint: true },
  handler: (args, { service }) => service.clear(args.scoreId, args.movementId, args),
});

export const checkRanges = defineTool({
  name: 'check_ranges',
  title: 'Comprobar rangos instrumentales',
  description:
    'Revisa si alguna nota queda fuera del rango de su instrumento o en una zona incomoda, ' +
    'teniendo en cuenta la transposicion (lo que escribe un clarinete no es lo que suena). ' +
    'Distingue lo IMPOSIBLE (below-range, above-range: hay que corregirlo) de lo INCOMODO ' +
    '(low-strain, high-strain: valido pero forzado, evitalo en pasajes largos). Conviene ' +
    'llamarla despues de orquestar y antes de exportar.',
  inputSchema: {
    scoreId: scoreIdSchema,
    movementId: movementIdSchema,
    partId: z
      .string()
      .optional()
      .describe('Limitar a una parte. Si se omite, se revisan todas.'),
  },
  hints: { readOnlyHint: true, idempotentHint: true },
  handler: (args, { service }) => service.checkRanges(args.scoreId, args.movementId, args.partId),
});

export const instrumentsList = defineTool({
  name: 'instruments_list',
  title: 'Listar instrumentos disponibles',
  description:
    'Devuelve los instrumentos que se pueden usar en part_add, con su rango sonante, su ' +
    'clave y si transponen. Consultalo antes de orquestar para no escribir notas ' +
    'imposibles ni asignar un id que no existe.',
  inputSchema: {},
  hints: { readOnlyHint: true, idempotentHint: true },
  handler: (_args, { service }) => ({ instruments: service.instruments() }),
});
