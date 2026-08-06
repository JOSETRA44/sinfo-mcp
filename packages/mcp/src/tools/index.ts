import { exportScore } from './export.js';
import {
  ensembleAdd,
  ensembleList,
  formList,
  grooveList,
  orchestrate,
  planForm,
  sectionList,
} from './form.js';
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
import { importMidi, transcribeRequantize } from './transcribe.js';
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
  // 0. entrar material ya existente
  //
  // Va primero porque es una forma alternativa de EMPEZAR: en vez de abrir una
  // obra en blanco, se parte de algo que ya suena. Lo que sale es un scoreId
  // corriente, asi que todo lo de abajo se le aplica igual.
  importMidi,
  transcribeRequantize,

  // 1. abrir y estructurar
  scoreCreate,
  instrumentsList,
  ensembleList,
  ensembleAdd,
  partAdd,
  movementAdd,
  timelineSet,

  // 1b. planificar la forma
  formList,
  grooveList,
  planForm,

  // 2. material tematico
  motifCreate,
  motifDevelop,
  motifWrite,
  melodyGenerate,
  counterpointAdd,
  orchestrate,

  // 3. componer
  harmonyProgression,
  partWrite,
  partClear,

  // 4. releer y verificar
  scoreDescribe,
  partRead,
  motifList,
  sectionList,
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
