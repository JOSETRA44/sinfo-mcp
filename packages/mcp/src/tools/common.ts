import { z } from 'zod';

/**
 * Fragmentos de esquema que se repiten en muchas herramientas.
 *
 * Centralizarlos no es solo ahorrar teclas: garantiza que `scoreId` se
 * describa igual en las quince herramientas que lo aceptan. Descripciones
 * divergentes para el mismo parametro confunden al modelo y hacen que elija
 * mal la herramienta.
 */

export const scoreIdSchema = z
  .string()
  .min(1)
  .describe('Identificador devuelto por score_create. La partitura vive en el servidor.');

export const movementIdSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Movimiento sobre el que actuar. Si se omite, el primero.');

export const partIdSchema = z
  .string()
  .min(1)
  .describe('Identificador de la parte, el que devolvio part_add (p. ej. "violin", "violin2").');

export const voiceIdSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Voz dentro de la parte. Si se omite, la principal. Util para piano o divisi.');

export const measureSchema = z
  .int()
  .min(1)
  .describe('Numero de compas, empezando en 1.');

export const timeSignatureSchema = z
  .string()
  .regex(/^(\d+\s*\/\s*\d+|C\|?)$/, 'Formato de compas invalido')
  .describe('Compas: "4/4", "3/4", "6/8", "7/8", "C" (comun) o "C|" (partido).');

export const keySchema = z
  .string()
  .min(1)
  .describe(
    'Tonalidad: "C", "Bb major", "F# minor", "D dorian". Determina la armadura y la ' +
      'escritura preferida (sostenidos o bemoles).',
  );

export const tempoSchema = z
  .number()
  .min(20)
  .max(400)
  .describe('Pulsos por minuto referidos a la negra.');
