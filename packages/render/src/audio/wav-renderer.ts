import {
  articulationLengthFactor,
  Duration,
  isRest,
  resolveVelocity,
  soundingPitch,
  type Dynamic,
  type Movement,
  type Score,
} from '@sinfo/core';
import type {
  AudioRenderer,
  AudioRenderOptions,
  ExportFormat,
  RenderedArtifact,
} from '@sinfo/engine';
import { readFile } from 'node:fs/promises';
import { assignChannels } from '../midi/channels.js';

/**
 * Sintesis a WAV con spessasynth_core.
 *
 * El sintetizador se maneja por EVENTOS DIRECTOS, no a traves de su
 * secuenciador ni de un archivo MIDI intermedio. Dos motivos: se evita el
 * rodeo de escribir bytes para volver a interpretarlos, y la posicion de cada
 * nota se calcula en muestras exactas a partir de las fracciones del dominio,
 * sin pasar por la rejilla de ticks.
 *
 * Aviso sobre para quien sirve esto: el agente NO puede oir el resultado. El
 * audio es para la persona. Lo que si puede verificar el agente es la
 * partitura grabada, que es una imagen y un modelo multimodal si la mira.
 */
export class WavRenderer implements AudioRenderer {
  readonly formats: readonly ExportFormat[] = ['wav'];

  private readonly soundfontPath: string | undefined;
  private synth: Promise<SynthHandle> | null = null;

  constructor(soundfontPath?: string) {
    this.soundfontPath = soundfontPath ?? process.env['SINFO_SOUNDFONT'];
  }

  async render(score: Score, options: AudioRenderOptions = {}): Promise<RenderedArtifact> {
    const sampleRate = options.sampleRate ?? 44100;
    const movements = options.movementId
      ? [score.movement(options.movementId)]
      : [...score.movements];

    const events = scheduleEvents(score, movements);
    const seconds = events.reduce((end, event) => Math.max(end, event.at), 0) + 1.5;
    const totalSamples = Math.ceil(sampleRate * seconds);

    const { synth, soundfont, presets } = await this.load(sampleRate);
    const left = new Float32Array(totalSamples);
    const right = new Float32Array(totalSamples);

    renderBlocks(synth, events, left, right, sampleRate);

    const { audioToWav } = await import('spessasynth_core');
    const wav = audioToWav([left, right], sampleRate);

    let peak = 0;
    for (let i = 0; i < totalSamples; i += 7) peak = Math.max(peak, Math.abs(left[i]!));

    return {
      format: 'wav',
      data: new Uint8Array(wav),
      mimeType: 'audio/wav',
      filename: `${slugify(score.metadata.title)}.wav`,
      meta: {
        sampleRate,
        seconds: Math.round(seconds * 10) / 10,
        notes: events.filter((event) => event.type === 'on').length,
        soundfont,
        presets,
        peak: Math.round(peak * 1000) / 1000,
        ...(peak < 0.001
          ? {
              warning:
                'El audio ha salido en silencio. Casi siempre significa que el SoundFont no ' +
                'tiene los instrumentos que pide la partitura. Instala uno General MIDI ' +
                'completo y apuntalo con la variable SINFO_SOUNDFONT.',
            }
          : {}),
      },
    };
  }

  /**
   * Carga el sintetizador una sola vez.
   *
   * Si no hay SoundFont configurado se usa el banco incorporado de la
   * libreria, que tiene UN solo sonido. No sirve para escuchar la obra, pero
   * si para comprobar que la cadena funciona de extremo a extremo, y evita
   * que el servidor falle por no tener un archivo de 140 MB instalado.
   */
  private async load(sampleRate: number): Promise<SynthHandle> {
    this.synth ??= (async () => {
      const { BasicSoundBank, SoundBankLoader, SpessaSynthProcessor } = await import(
        'spessasynth_core'
      );

      let data: ArrayBuffer;
      let source: string;
      if (this.soundfontPath !== undefined) {
        const file = await readFile(this.soundfontPath);
        data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
        source = this.soundfontPath;
      } else {
        data = BasicSoundBank.getSampleSoundBankFile();
        source = 'incorporado (1 sonido; define SINFO_SOUNDFONT para oir la obra)';
      }

      const bank = SoundBankLoader.fromArrayBuffer(data);
      const synth = new SpessaSynthProcessor(sampleRate, { enableEventSystem: false });
      synth.soundBankManager.addSoundBank(bank, 'main');
      await synth.processorInitialized;

      return { synth, soundfont: source, presets: bank.presets.length };
    })();

    return this.synth;
  }
}

interface SynthHandle {
  readonly synth: import('spessasynth_core').SpessaSynthProcessor;
  readonly soundfont: string;
  readonly presets: number;
}

interface TimedEvent {
  /** Segundos desde el inicio de la obra. */
  readonly at: number;
  readonly type: 'program' | 'on' | 'off';
  readonly channel: number;
  readonly value: number;
  readonly velocity: number;
}

/**
 * Convierte la partitura en eventos con su instante en SEGUNDOS.
 *
 * El tiempo se acumula respetando los cambios de tempo: dos notas iguales en
 * un adagio y en un presto no caen en el mismo sitio, y calcularlo con un
 * tempo unico desplazaria todo lo que viene despues del primer cambio.
 */
function scheduleEvents(score: Score, movements: readonly Movement[]): TimedEvent[] {
  const parts = movements.flatMap((movement) => movement.parts);
  const channels = assignChannels(parts);
  const events: TimedEvent[] = [];
  const seen = new Set<number>();

  let elapsed = 0;
  for (const movement of movements) {
    for (const part of movement.parts) {
      const channel = channels.byPartId.get(part.id)!;

      if (!part.instrument.isPercussion && !seen.has(channel)) {
        events.push({ at: elapsed, type: 'program', channel, value: part.instrument.midiProgram, velocity: 0 });
        seen.add(channel);
      }

      for (const voice of part.voices) {
        let dynamic: Dynamic | undefined;

        for (const { position, event } of voice.positioned()) {
          if (event.dynamic !== undefined) dynamic = event.dynamic;
          if (isRest(event)) continue;

          const start = elapsed + secondsAt(movement, position);
          const written = secondsAt(movement, position.plus(event.duration)) -
            secondsAt(movement, position);
          const factor = Math.min(1, articulationLengthFactor(event.articulations ?? []));
          const sounding = Math.max(0.02, written * factor);

          const velocity = resolveVelocity(event, {
            instrumentOffset: part.instrument.velocityOffset,
            ...(dynamic !== undefined ? { prevailingDynamic: dynamic } : {}),
          });

          for (const pitch of event.pitches) {
            const midi = part.instrument.isPercussion
              ? pitch.midi
              : soundingPitch(part.instrument, pitch).midi;
            if (midi < 0 || midi > 127) continue;

            events.push({ at: start, type: 'on', channel, value: midi, velocity });
            events.push({ at: start + sounding, type: 'off', channel, value: midi, velocity: 0 });
          }
        }
      }
    }
    elapsed += secondsAt(movement, movement.duration);
  }

  // Los apagados van antes que los encendidos en el mismo instante, para que
  // repetir una nota no apague la que se acaba de pulsar.
  const order = { program: 0, off: 1, on: 2 } as const;
  return events.sort((a, b) => a.at - b.at || order[a.type] - order[b.type]);
}

/** Segundos transcurridos hasta esa posicion, respetando los cambios de tempo. */
function secondsAt(movement: Movement, position: Duration): number {
  const changes = movement.timeline.tempoChanges;
  let seconds = 0;

  for (const [index, change] of changes.entries()) {
    if (change.at.greaterThan(position)) break;
    const next = changes[index + 1]?.at;
    const segmentEnd = next && next.lessThan(position) ? next : position;
    seconds += change.value.secondsFor(segmentEnd.minus(change.at));
  }
  return seconds;
}

/** Tamano de bloque del sintetizador. */
const BLOCK = 128;

function renderBlocks(
  synth: import('spessasynth_core').SpessaSynthProcessor,
  events: readonly TimedEvent[],
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): void {
  let next = 0;

  for (let offset = 0; offset + BLOCK <= left.length; offset += BLOCK) {
    const until = (offset + BLOCK) / sampleRate;

    // Los eventos se aplican al principio del bloque que les toca. El desfase
    // maximo son 128 muestras, menos de 3 ms: por debajo del umbral en que el
    // oido percibe que dos ataques no son simultaneos.
    while (next < events.length && events[next]!.at < until) {
      const event = events[next]!;
      if (event.type === 'program') synth.programChange(event.channel, event.value);
      else if (event.type === 'on') synth.noteOn(event.channel, event.value, event.velocity);
      else synth.noteOff(event.channel, event.value);
      next++;
    }

    synth.process(left.subarray(offset, offset + BLOCK), right.subarray(offset, offset + BLOCK));
  }
}

function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'audio' : slug;
}
