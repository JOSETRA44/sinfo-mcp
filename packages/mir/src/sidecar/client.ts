import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Cliente del sidecar de Python.
 *
 * PRIMER uso de `child_process` en todo el proyecto, y acotado a este archivo
 * a proposito. Hasta aqui todo era JavaScript o WASM en el mismo proceso; los
 * modelos de audio no pueden serlo, asi que viven fuera y se hablan por una
 * frontera estrecha: argumentos de linea de ordenes hacia alla, una linea de
 * JSON hacia aca.
 *
 * La regla que gobierna la clase: **que no este instalado no es un error**.
 * Igual que un formato de exportacion sin adaptador, la ausencia se declara y
 * el resto del sistema sigue funcionando con lo que si tiene.
 */

export interface SidecarCapability {
  readonly name: string;
  readonly available: boolean;
  readonly backend?: string | undefined;
  readonly reason?: string | undefined;
  /** Orden exacta para instalar lo que falta. */
  readonly install?: string | undefined;
}

export interface SidecarInfo {
  readonly name: string;
  readonly version: string;
  readonly python: string;
  readonly platform: string;
  readonly capabilities: readonly SidecarCapability[];
}

export interface SidecarOptions {
  /** Ejecutable concreto. Si falta, se prueban los candidatos habituales. */
  readonly command?: string | undefined;
  /** Argumentos que preceden al subcomando (para `uvx`, `python -m`...). */
  readonly prefixArgs?: readonly string[] | undefined;
  /** Tope para las etapas largas. Separar una cancion tarda minutos. */
  readonly timeoutMs?: number | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
}

export class SidecarError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: string, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = 'SidecarError';
    this.code = code;
    this.details = details;
  }
}

/** Respuesta cruda del sidecar: siempre trae `ok`. */
interface Envelope {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: { readonly code?: string; readonly message?: string } & Record<string, unknown>;
}

/** Tope corto para `describe`: si tarda mas, algo va mal y no vale la pena esperar. */
const DESCRIBE_TIMEOUT = 20_000;
const DEFAULT_TIMEOUT = 15 * 60_000;

export class SidecarClient {
  private readonly options: SidecarOptions;
  /** Se resuelve una vez: sondear el ejecutable cuesta un proceso. */
  private resolved: Promise<Resolution> | undefined;

  constructor(options: SidecarOptions = {}) {
    this.options = options;
  }

  /**
   * Que sabe hacer el sidecar, o `null` si no esta instalado.
   *
   * Devuelve `null` en vez de lanzar porque no tenerlo es un estado normal:
   * quien solo compone o importa MIDI no necesita Python para nada.
   */
  async describe(): Promise<SidecarInfo | null> {
    const resolution = await this.resolve();
    return resolution.kind === 'ready' ? resolution.info : null;
  }

  /** Capacidades disponibles ahora mismo, por nombre. */
  async availableStages(): Promise<string[]> {
    const info = await this.describe();
    if (info === null) return [];
    return info.capabilities.filter((entry) => entry.available).map((entry) => entry.name);
  }

  /**
   * Ejecuta un subcomando y devuelve su resultado ya desenvuelto.
   *
   * Los errores del sidecar llegan con codigo estable, asi que se reenvian tal
   * cual: el mensaje de "te falta este paquete, instalalo asi" es exactamente
   * lo que el agente necesita repetirle a la persona.
   */
  async invoke(args: readonly string[], timeoutMs?: number): Promise<unknown> {
    const resolution = await this.resolve();
    if (resolution.kind !== 'ready') {
      throw new SidecarError(
        'SIDECAR_MISSING',
        'El sidecar de analisis (sinfo-mir) no esta instalado, asi que no hay separacion de ' +
          'pistas, seguimiento de pulso ni transcripcion polifonica. Instalalo con ' +
          "`uv tool install 'sinfo-mir[all]'`, o apunta la variable SINFO_MIR al ejecutable.",
        { tried: resolution.tried },
      );
    }
    return this.execute(resolution.command, resolution.prefixArgs, args, timeoutMs);
  }

  // ------------------------------------------------------------- interiores

  private async execute(
    command: string,
    prefixArgs: readonly string[],
    args: readonly string[],
    timeoutMs?: number,
  ): Promise<unknown> {
    let stdout: string;
    try {
      const result = await run(command, [...prefixArgs, ...args], {
        timeout: timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT,
        // Una transcripcion larga son varios megas de JSON por la tuberia.
        maxBuffer: 256 * 1024 * 1024,
        windowsHide: true,
        ...(this.options.env === undefined
          ? {}
          : { env: { ...process.env, ...this.options.env } }),
      });
      stdout = result.stdout;
    } catch (error) {
      // Un fallo de etapa sale con codigo distinto de cero PERO con su JSON en
      // stdout. Hay que mirarlo antes de darlo por muerto, porque ahi esta la
      // explicacion util; sin esto solo se veria "exit 2".
      const output = (error as { stdout?: string }).stdout;
      if (typeof output === 'string' && output.trim().length > 0) {
        stdout = output;
      } else {
        throw new SidecarError(
          'SIDECAR_FAILED',
          `El sidecar fallo al ejecutar "${args.join(' ')}": ` +
            `${error instanceof Error ? error.message : String(error)}`,
          { args: [...args] },
        );
      }
    }

    return unwrap(stdout, args);
  }

  private resolve(): Promise<Resolution> {
    this.resolved ??= this.probe();
    return this.resolved;
  }

  /**
   * Busca el sidecar SOLO donde el usuario lo haya puesto a proposito.
   *
   * Aqui hubo una tercera opcion, `uvx --from sinfo-mir`, y se quito. Habria
   * sido comoda —funciona sin instalar nada— pero se descarga el paquete de
   * PyPI en cuanto alguien pide una transcripcion, sin avisar y sin permiso.
   * Es el mismo patron que el proyecto ya rechazo en el postinstall: que una
   * herramienta traiga y ejecute codigo por su cuenta tiene que ser una
   * decision de quien la usa, tomada a proposito.
   *
   * Instalar deja `sinfo-mir` en el PATH, asi que la ruta comoda sigue
   * existiendo; lo que desaparece es que ocurra a espaldas de nadie.
   */
  private async probe(): Promise<Resolution> {
    const candidates: { command: string; prefixArgs: readonly string[] }[] = [];

    if (this.options.command !== undefined) {
      candidates.push({ command: this.options.command, prefixArgs: this.options.prefixArgs ?? [] });
    } else {
      const configured = process.env['SINFO_MIR'];
      if (configured !== undefined && configured.trim() !== '') {
        candidates.push({ command: configured, prefixArgs: [] });
      }
      candidates.push({ command: 'sinfo-mir', prefixArgs: [] });
    }

    const tried: string[] = [];
    for (const candidate of candidates) {
      tried.push([candidate.command, ...candidate.prefixArgs].join(' '));
      try {
        const info = await this.execute(
          candidate.command,
          candidate.prefixArgs,
          ['describe'],
          DESCRIBE_TIMEOUT,
        );
        if (isInfo(info)) {
          return { kind: 'ready', command: candidate.command, prefixArgs: candidate.prefixArgs, info };
        }
      } catch {
        // Candidato que no responde: se prueba el siguiente sin ruido. Que no
        // este instalado es lo normal, no una incidencia que reportar.
      }
    }

    return { kind: 'missing', tried };
  }
}

type Resolution =
  | { kind: 'ready'; command: string; prefixArgs: readonly string[]; info: SidecarInfo }
  | { kind: 'missing'; tried: readonly string[] };

/** Extrae el resultado del sobre, convirtiendo los errores en excepciones. */
function unwrap(stdout: string, args: readonly string[]): unknown {
  // El sidecar puede escribir avisos antes del JSON (torch es aficionado a
  // ello), asi que se toma la ULTIMA linea que parsee, no la primera.
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'));

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(lines[i] ?? '') as Envelope;
    } catch {
      continue;
    }

    if (envelope.ok) return envelope.result;
    throw new SidecarError(
      typeof envelope.error?.code === 'string' ? envelope.error.code : 'SIDECAR_ERROR',
      envelope.error?.message ?? 'El sidecar devolvio un error sin mensaje.',
      { ...envelope.error, args: [...args] },
    );
  }

  throw new SidecarError('SIDECAR_PROTOCOL', 'El sidecar no devolvio JSON reconocible.', {
    args: [...args],
    stdout: stdout.slice(0, 500),
  });
}

function isInfo(value: unknown): value is SidecarInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { capabilities?: unknown }).capabilities)
  );
}
