/**
 * @sinfo/engine — capa de aplicacion.
 *
 * Define los puertos de salida y orquesta los casos de uso. No conoce ninguna
 * libreria de formato ni el protocolo MCP: es el centro estable entre el
 * dominio y los adaptadores.
 */

export type {
  AudioRenderer,
  AudioRenderOptions,
  ExportFormat,
  MidiRenderer,
  MidiRenderOptions,
  RenderedArtifact,
  RenderPorts,
  ScoreRenderer,
  ScoreRenderOptions,
} from './ports.js';
