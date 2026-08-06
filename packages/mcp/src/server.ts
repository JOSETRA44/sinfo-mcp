import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ScoreService, type ArtifactSink, type RenderPorts } from '@sinfo/engine';
import { MidiFileRenderer, VerovioRenderer, WavRenderer } from '@sinfo/render';
import { FileArtifactSink } from './adapters/file-sink.js';
import { ok, toolError } from './result.js';
import { ALL_TOOLS, type ToolContext } from './tools/index.js';

export const SERVER_NAME = 'sinfo-mcp';
export const SERVER_VERSION = '0.1.0';

export interface CreateServerOptions {
  /** Adaptadores de salida. Si faltan, se montan los de serie. */
  readonly ports?: Partial<RenderPorts>;
  readonly sink?: ArtifactSink;
  readonly service?: ScoreService;
}

/**
 * Raiz de composicion.
 *
 * El unico sitio de todo el proyecto donde se decide que implementacion
 * concreta atiende cada puerto. Todo lo demas trabaja contra interfaces, y por
 * eso los tests pueden montar el servidor entero con un sumidero en memoria
 * sin tocar el disco.
 */
export function createPorts(options: CreateServerOptions = {}): RenderPorts {
  return {
    midi: options.ports?.midi ?? new MidiFileRenderer(),
    sink: options.sink ?? options.ports?.sink ?? new FileArtifactSink(),
    score: options.ports?.score ?? new VerovioRenderer(),
    audio: options.ports?.audio ?? new WavRenderer(),
  };
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const service = options.service ?? new ScoreService(createPorts(options));
  const context: ToolContext = { service };

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        'Servidor de composicion musical. Flujo tipico: score_create para abrir la obra, ' +
        'part_add por cada instrumento, part_write para escribir la musica en notacion de ' +
        'texto, check_ranges para verificar, y export para sacar el archivo. La partitura ' +
        'vive en el servidor entre llamadas: no la reenvies, referenciala por scoreId. ' +
        'Nunca se devuelve la obra entera; usa score_describe para el resumen y part_read ' +
        'acotado por compases para ver las notas.',
    },
  );

  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.hints ? { annotations: { title: tool.title, ...tool.hints } } : {}),
      },
      // El envoltorio comun da a todas las herramientas el mismo formato de
      // salida y el mismo tratamiento de errores. Cada modulo se limita a
      // devolver datos; ninguno repite este cableado.
      (async (args: unknown) => {
        try {
          return ok(await tool.handler(args as never, context));
        } catch (error) {
          return toolError(error);
        }
      }) as never,
    );
  }

  return server;
}
