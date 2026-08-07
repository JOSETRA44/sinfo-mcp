/**
 * Banco de pruebas de precision.
 *
 *   node scripts/benchmark-transcription.mjs
 *
 * Compone piezas conocidas, las sintetiza a audio real con el SoundFont, las
 * vuelve a transcribir y mide cuanto se recupera. La verdad de referencia sale
 * gratis porque la partitura de partida es nuestra.
 *
 * Es la unica forma honesta de decir si un cambio mejora la precision: sin
 * cifras, "afinar" es cambiar cosas y esperar.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Duration,
  KeySignature,
  Score,
  Tempo,
  TimeSignature,
  chord,
  getInstrument,
  isRest,
  note,
} from '@sinfo/core';
import { AudioFileLoader } from '@sinfo/mir';
import { WavRenderer } from '@sinfo/render';
import { evaluateNotes, notesOf, refineNotes } from '@sinfo/transcribe';

const OUT = join(process.cwd(), 'out', 'benchmark');
const TEMPO = 96;
const Q = Duration.QUARTER;
const H = Duration.HALF;
const E = Duration.EIGHTH;

/** Construye una partitura de una sola parte a partir de eventos sueltos. */
function build(title, instrumentId, events) {
  const score = new Score(title, { title });
  const movement = score.first;
  const start = movement.timeline.timeSignatureChanges[0]?.at ?? Duration.ZERO;
  movement.timeline.setTimeSignature(start, TimeSignature.of(4, 4));
  movement.timeline.setTempo(start, Tempo.of(TEMPO));
  movement.timeline.setKey(start, KeySignature.parse('C major'));

  const voice = movement.addPart('p1', getInstrument(instrumentId)).voice('v1');
  for (const event of events) voice.append(event);
  return score;
}

/** Notas de la partitura con tiempos en SEGUNDOS, que es como se comparan. */
function groundTruth(score) {
  const secondsPerQuarter = 60 / TEMPO;
  const reference = [];
  for (const part of score.first.parts) {
    for (const voice of part.voices) {
      let at = Duration.ZERO;
      for (const event of voice.events) {
        if (!isRest(event)) {
          const onset = at.quarters * secondsPerQuarter;
          const offset = at.plus(event.duration).quarters * secondsPerQuarter;
          for (const pitch of event.pitches) reference.push({ onset, offset, midi: pitch.midi });
        }
        at = at.plus(event.duration);
      }
    }
  }
  return reference.sort((a, b) => a.onset - b.onset || a.midi - b.midi);
}

const CASES = [
  {
    name: 'melodia monofonica (flauta)',
    instrument: 'flute',
    events: ['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'G5', 'E5', 'C5'].map((p) => note(p, Q)),
  },
  {
    name: 'melodia con ritmo variado (flauta)',
    instrument: 'flute',
    events: [
      note('C5', Q), note('D5', E), note('E5', E), note('F5', H),
      note('G5', E), note('F5', E), note('E5', Q), note('D5', H),
      note('C5', Q), note('E5', Q), note('G5', H),
    ],
  },
  {
    name: 'linea de bajo (bajo electrico)',
    instrument: 'bass_guitar',
    events: ['C2', 'C2', 'G2', 'C2', 'F2', 'F2', 'C2', 'G2'].map((p) => note(p, Q)),
  },
  {
    name: 'acordes a tres voces (piano)',
    instrument: 'piano',
    events: [
      chord(['C4', 'E4', 'G4'], H),
      chord(['F4', 'A4', 'C5'], H),
      chord(['G4', 'B4', 'D5'], H),
      chord(['C4', 'E4', 'G4'], H),
    ],
  },
  {
    name: 'melodia con acompanamiento (piano)',
    instrument: 'piano',
    events: [
      chord(['C3', 'E4'], Q), chord(['C3', 'G4'], Q),
      chord(['F3', 'A4'], Q), chord(['F3', 'C5'], Q),
      chord(['G3', 'B4'], Q), chord(['G3', 'D5'], Q),
      chord(['C3', 'E5'], H),
    ],
  },
];

const percent = (value) => `${(value * 100).toFixed(1).padStart(5)}%`;

async function main() {
  await mkdir(OUT, { recursive: true });

  const renderer = new WavRenderer();
  const loader = new AudioFileLoader();
  const status = await loader.status();
  console.log(`motor=${status.engine}  polifonico=${status.polyphonic}\n`);

  // Se mide ANTES y DESPUES de depurar: la diferencia es lo que aporta el
  // criterio musical sobre lo que devuelve el modelo a secas.
  const header = 'caso'.padEnd(36) + '  crudo   depurado   ataques   ref/crudo/dep';
  console.log(header);
  console.log('-'.repeat(header.length));

  const totals = { raw: 0, refined: 0, onsets: 0, count: 0 };

  for (const testCase of CASES) {
    const score = build(testCase.name, testCase.instrument, testCase.events);
    const reference = groundTruth(score);

    const audio = await renderer.render(score, {});
    const path = join(OUT, `${testCase.name.replace(/[^\w]+/g, '_')}.wav`);
    await writeFile(path, audio.data);

    const performance = await loader.load(path, {
      bpm: TEMPO,
      instrumentId: testCase.instrument,
    });
    const rawNotes = performance.tracks[0]?.notes ?? [];
    const refined = refineNotes(rawNotes, { instrumentId: testCase.instrument }).notes;

    const raw = evaluateNotes(reference, notesOf(performance.tracks));
    const result = evaluateNotes(reference, notesOf([{ notes: refined }]));

    totals.raw += raw.notes.f1;
    totals.refined += result.notes.f1;
    totals.onsets += result.onsets.f1;
    totals.count += 1;

    console.log(
      testCase.name.padEnd(36) +
        percent(raw.notes.f1).padStart(8) +
        percent(result.notes.f1).padStart(10) +
        percent(result.onsets.f1).padStart(10) +
        `   ${reference.length}/${rawNotes.length}/${refined.length}`,
    );
  }

  console.log('-'.repeat(header.length));
  console.log(
    'MEDIA'.padEnd(36) +
      percent(totals.raw / totals.count).padStart(8) +
      percent(totals.refined / totals.count).padStart(10) +
      percent(totals.onsets / totals.count).padStart(10),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
