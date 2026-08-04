#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

export { createPorts, createServer, SERVER_NAME, SERVER_VERSION } from './server.js';
export { FileArtifactSink, MemoryArtifactSink } from './adapters/file-sink.js';
export { ALL_TOOLS } from './tools/index.js';
export { ok, toolError, type ToolResult } from './result.js';

/**
 * Arranque por stdio.
 *
 * Nada de este archivo puede escribir en stdout: ese canal ES el protocolo, y
 * un `console.log` de mas corrompe la conversacion con el cliente. Los avisos
 * van siempre a stderr.
 */
async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  process.stderr.write(`[sinfo-mcp] servidor listo en stdio\n`);
}

// Solo arranca si se ejecuta como programa; importarlo no levanta nada.
if (process.argv[1] !== undefined && import.meta.url.endsWith(basename(process.argv[1]))) {
  main().catch((error: unknown) => {
    process.stderr.write(`[sinfo-mcp] fallo al arrancar: ${String(error)}\n`);
    process.exitCode = 1;
  });
}

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path;
}
