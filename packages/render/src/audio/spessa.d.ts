/**
 * Superficie minima de spessasynth_core que se usa aqui.
 *
 * El paquete trae sus propios tipos, pero se declara lo justo para dejar
 * constancia de QUE se usa: el sintetizador se maneja por eventos directos,
 * sin pasar por su secuenciador ni por bytes MIDI.
 */
declare module 'spessasynth_core' {
  export class SpessaSynthProcessor {
    constructor(sampleRate: number, options?: { enableEventSystem?: boolean });
    readonly processorInitialized: Promise<void>;
    readonly soundBankManager: {
      addSoundBank(bank: unknown, id: string): void;
    };
    programChange(channel: number, program: number): void;
    noteOn(channel: number, midiNote: number, velocity: number): void;
    noteOff(channel: number, midiNote: number): void;
    process(left: Float32Array, right: Float32Array): void;
    destroySynthProcessor(): void;
  }

  export class BasicSoundBank {
    static getSampleSoundBankFile(): ArrayBuffer;
    readonly presets: readonly { program: number; name: string }[];
  }

  export const SoundBankLoader: {
    fromArrayBuffer(data: ArrayBuffer): BasicSoundBank;
  };

  export function audioToWav(
    audioData: readonly Float32Array[],
    sampleRate: number,
    options?: Record<string, unknown>,
  ): ArrayBuffer;
}
