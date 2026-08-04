import type { Part } from '@sinfo/core';

/** En General MIDI el canal 10 (indice 9) esta reservado a la percusion. */
export const PERCUSSION_CHANNEL = 9;

const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15] as const;

export interface ChannelAssignment {
  readonly byPartId: ReadonlyMap<string, number>;
  /**
   * true si hubo mas partes melodicas que canales y alguno se reutiliza.
   * No impide exportar: cada parte va en su propia pista y casi todos los DAW
   * las importan por separado. Se reporta para que el agente lo sepa.
   */
  readonly exhausted: boolean;
}

/**
 * Reparte canales MIDI entre las partes.
 *
 * MIDI solo tiene 16 canales y una orquesta sinfonica pasa de 20 partes, asi
 * que la colision es inevitable en obras grandes. Se reparte en orden y se
 * avisa, en vez de fallar: el formato 1 pone cada parte en su propia pista y
 * eso es lo que de verdad usan los editores al importar.
 */
export function assignChannels(parts: readonly Part[]): ChannelAssignment {
  const byPartId = new Map<string, number>();
  let melodicIndex = 0;
  let exhausted = false;

  for (const part of parts) {
    if (part.instrument.isPercussion) {
      byPartId.set(part.id, PERCUSSION_CHANNEL);
      continue;
    }
    if (part.midiChannel !== undefined) {
      byPartId.set(part.id, part.midiChannel);
      continue;
    }
    if (melodicIndex >= MELODIC_CHANNELS.length) exhausted = true;
    byPartId.set(part.id, MELODIC_CHANNELS[melodicIndex % MELODIC_CHANNELS.length]!);
    melodicIndex++;
  }

  return { byPartId, exhausted };
}
