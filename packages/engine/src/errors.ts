/**
 * Errores de la capa de aplicacion.
 *
 * Separados de los del dominio porque hablan de otra cosa: el dominio se
 * queja de musica imposible ("esa altura no existe"), la aplicacion se queja
 * de peticiones imposibles ("esa sesion no existe", "ese formato no esta
 * disponible"). El adaptador MCP los traduce a codigos de protocolo sin tener
 * que leer mensajes de texto.
 */

export type ApplicationErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_LIMIT_REACHED'
  | 'INVALID_REQUEST'
  | 'FORMAT_UNAVAILABLE'
  | 'NOTATION_ERROR'
  /** Se pidio algo de la sesion que no existe: un motivo, una parte. */
  | 'NOT_FOUND';

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: ApplicationErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
    this.details = details;
  }
}

export function fail(
  code: ApplicationErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new ApplicationError(code, message, details);
}
