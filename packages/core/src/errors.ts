/**
 * Errores del dominio.
 *
 * El dominio nunca lanza `Error` pelado ni strings: cada fallo lleva un codigo
 * estable que las capas de arriba (engine, mcp) pueden mapear a errores MCP sin
 * inspeccionar mensajes de texto.
 */

export type DomainErrorCode =
  | 'INVALID_DURATION'
  | 'INVALID_PITCH'
  | 'INVALID_INTERVAL'
  | 'INVALID_TIME_SIGNATURE'
  | 'INVALID_TEMPO'
  | 'INVALID_KEY'
  | 'INVALID_STRUCTURE'
  | 'NOT_FOUND';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: DomainErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function invalid(
  code: DomainErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new DomainError(code, message, details);
}
