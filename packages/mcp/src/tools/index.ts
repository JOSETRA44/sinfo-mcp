import { exportScore } from './export.js';
import {
  counterpointAdd,
  melodyGenerate,
  motifCreate,
  motifDevelop,
  motifList,
  motifWrite,
} from './generation.js';
import { analyzeHarmony, checkVoiceLeading, harmonyProgression } from './harmony.js';
import {
  checkRanges,
  instrumentsList,
  partAdd,
  partClear,
  partRead,
  partWrite,
} from './parts.js';
import {
  movementAdd,
  scoreClose,
  scoreCreate,
  scoreDescribe,
  scoreList,
  timelineDescribe,
  timelineSet,
} from './score.js';
import type { AnyToolDefinition } from './types.js';

/**
 * Catalogo de herramientas.
 *
 * El servidor recorre este array y registra lo que encuentre. Anadir una
 * herramienta nueva es escribir su modulo y sumarla aqui: no hay que tocar
 * el servidor, ni un switch, ni el arranque.
 *
 * El orden importa poco para el protocolo, pero se agrupan por flujo de
 * trabajo para que el modelo las lea en el orden en que se usan.
 */
export const ALL_TOOLS: readonly AnyToolDefinition[] = [
  // 1. abrir y estructurar
  scoreCreate,
  instrumentsList,
  partAdd,
  movementAdd,
  timelineSet,

  // 2. material tematico
  motifCreate,
  motifDevelop,
  motifWrite,
  melodyGenerate,
  counterpointAdd,

  // 3. componer
  harmonyProgression,
  partWrite,
  partClear,

  // 4. releer y verificar
  scoreDescribe,
  partRead,
  motifList,
  timelineDescribe,
  analyzeHarmony,
  checkVoiceLeading,
  checkRanges,

  // 5. sacar el resultado
  exportScore,

  // 6. gestion de sesion
  scoreList,
  scoreClose,
] as AnyToolDefinition[];

export * from './types.js';
