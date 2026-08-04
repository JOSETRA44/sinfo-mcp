import { DomainError } from '@sinfo/core';
import { ApplicationError } from '@sinfo/engine';

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/** Respuesta correcta: JSON legible, sin envoltorios innecesarios. */
export function ok(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

/**
 * Respuesta de error.
 *
 * Se devuelve como resultado con `isError`, no como error de protocolo. La
 * diferencia importa: un error de protocolo aborta la llamada y el modelo no
 * ve el motivo, mientras que asi lee el mensaje y puede corregirse solo. Casi
 * todos los fallos aqui son de ese tipo: notacion mal escrita, un compas que
 * no cuadra, un instrumento que no existe. Todos tienen arreglo evidente si
 * se explica bien.
 */
export function toolError(error: unknown): ToolResult {
  const payload = describeError(error);
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}

interface ErrorPayload {
  error: string;
  code: string;
  message: string;
  details?: Readonly<Record<string, unknown>>;
}

function describeError(error: unknown): ErrorPayload {
  if (error instanceof ApplicationError) {
    return {
      error: 'ApplicationError',
      code: error.code,
      message: error.message,
      ...(hasDetails(error.details) ? { details: error.details } : {}),
    };
  }

  if (error instanceof DomainError) {
    return {
      error: 'DomainError',
      code: error.code,
      message: error.message,
      ...(hasDetails(error.details) ? { details: error.details } : {}),
    };
  }

  if (error instanceof Error) {
    return { error: 'InternalError', code: 'INTERNAL', message: error.message };
  }

  return { error: 'InternalError', code: 'INTERNAL', message: String(error) };
}

function hasDetails(details: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(details).length > 0;
}
