import type { ScoreService } from '@sinfo/engine';
import type { z, ZodRawShape } from 'zod';

export interface ToolContext {
  readonly service: ScoreService;
}

/**
 * Pistas de comportamiento para el cliente MCP.
 *
 * Merecen rellenarse: permiten al cliente saber que una herramienta solo lee
 * (y puede llamarla sin pedir permiso) o que borra cosas (y conviene
 * confirmar antes).
 */
export interface ToolHints {
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
}

/**
 * Una herramienta MCP, autocontenida.
 *
 * El servidor recorre la lista y las registra todas: no hay ningun switch
 * gigante que haya que tocar. Anadir una capacidad es escribir un archivo en
 * `tools/` y sumarlo al array de `tools/index.ts`.
 */
export interface ToolDefinition<Shape extends ZodRawShape = ZodRawShape> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Shape;
  readonly hints?: ToolHints;
  handler(args: z.infer<z.ZodObject<Shape>>, context: ToolContext): unknown | Promise<unknown>;
}

/** Conserva la inferencia del esquema en el handler. */
export function defineTool<Shape extends ZodRawShape>(
  definition: ToolDefinition<Shape>,
): ToolDefinition<Shape> {
  return definition;
}

/** Forma comun para guardarlas todas en un mismo array. */
export type AnyToolDefinition = ToolDefinition<ZodRawShape>;
