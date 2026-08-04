import type { Score } from '@sinfo/core';
import { fail } from '../errors.js';
import type { ExportFormat, RenderedArtifact, RenderPorts } from '../ports.js';

/**
 * Exportacion a archivo.
 *
 * Un solo punto de entrada para todos los formatos: el agente pide `format` y
 * el motor decide que adaptador lo atiende. Anadir MusicXML o WAV mas
 * adelante es enchufar un adaptador y anadir una entrada al mapa, sin tocar
 * ni las herramientas MCP ni esta funcion.
 */

export interface ExportInput {
  readonly format?: ExportFormat | undefined;
  readonly movementId?: string | undefined;
  /** Solo para MIDI: pulsos por negra. */
  readonly ppq?: number | undefined;
}

export interface ExportResult {
  readonly format: ExportFormat;
  readonly path: string;
  readonly bytes: number;
  readonly meta: Readonly<Record<string, unknown>>;
}

export async function exportScore(
  score: Score,
  ports: RenderPorts,
  input: ExportInput = {},
): Promise<ExportResult> {
  const format = input.format ?? 'midi';
  const artifact = await renderArtifact(score, ports, format, input);
  const saved = await ports.sink.save(artifact, score.id);

  return {
    format,
    path: saved.path,
    bytes: saved.bytes,
    meta: artifact.meta ?? {},
  };
}

async function renderArtifact(
  score: Score,
  ports: RenderPorts,
  format: ExportFormat,
  input: ExportInput,
): Promise<RenderedArtifact> {
  const movementOption = input.movementId !== undefined ? { movementId: input.movementId } : {};

  switch (format) {
    case 'midi':
      return ports.midi.render(score, {
        ...movementOption,
        ...(input.ppq !== undefined ? { ppq: input.ppq } : {}),
      });

    case 'musicxml':
    case 'lilypond':
    case 'abc':
    case 'svg':
      if (!ports.score?.formats.includes(format)) {
        return unavailable(format, 'partitura', ports);
      }
      return ports.score.render(score, { ...movementOption, format });

    case 'wav':
    case 'mp3':
      if (!ports.audio?.formats.includes(format)) {
        return unavailable(format, 'audio', ports);
      }
      return ports.audio.render(score, { ...movementOption, format });

    case 'json':
      return {
        format: 'json',
        data: new TextEncoder().encode(JSON.stringify(score.summary(), null, 2)),
        mimeType: 'application/json',
        filename: `${score.id}.json`,
      };
  }
}

/**
 * El formato existe pero su adaptador no esta montado todavia.
 *
 * Se distingue de "formato desconocido" a proposito: el agente necesita saber
 * si debe cambiar de formato o si le falta instalar algo. La lista de lo que
 * SI hay se calcula de los puertos montados, no de una constante: una lista
 * escrita a mano se queda obsoleta en cuanto se enchufa un adaptador nuevo.
 */
function unavailable(format: ExportFormat, adapter: string, ports: RenderPorts): never {
  return fail(
    'FORMAT_UNAVAILABLE',
    `El formato "${format}" necesita el adaptador de ${adapter}, que no esta disponible en esta instalacion`,
    { format, adapter, availableNow: availableFormats(ports) },
  );
}

/** Formatos que esta instalacion puede producir ahora mismo. */
export function availableFormats(ports: RenderPorts): ExportFormat[] {
  return ['midi', 'json', ...(ports.score?.formats ?? []), ...(ports.audio?.formats ?? [])];
}
