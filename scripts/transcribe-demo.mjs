/**
 * Demostracion de la ida y vuelta completa, con archivos que puedes abrir.
 *
 * Compone una pieza, la "toca" con desajuste humano, la vuelve a leer como si
 * llegara de fuera y escribe las dos partituras para compararlas en MuseScore.
 *
 *   node scripts/transcribe-demo.mjs
 *
 * Lo que hay que mirar al abrirlas: que las figuras del transcrito sean las
 * mismas que las del original —sobre todo el tresillo—, que los compases
 * cuadren sin marcas de error, y que las alteraciones esten escritas como
 * bemoles, que es lo que pide si bemol mayor.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Duration,
  KeySignature,
  Score,
  Tempo,
  TimeSignature,
  getInstrument,
  note,
} from '@sinfo/core';
import { readMidi } from '@sinfo/mir';
import { MidiFileRenderer, VerovioRenderer } from '@sinfo/render';
import { performanceToScore } from '@sinfo/transcribe';

const OUT = join(process.cwd(), 'out');

const Q = Duration.QUARTER;
const H = Duration.HALF;
const E = Duration.EIGHTH;
/** Tresillo de corchea: tres en el tiempo de dos. */
const T = Duration.of(1, 12);

/** Vals en si bemol mayor: bemoles, tresillos y dos voces. */
function compose() {
  const score = new Score('demo', { title: 'Vals de ida y vuelta', composer: 'sinfo-mcp' });
  const movement = score.first;
  const start = movement.timeline.timeSignatureChanges[0]?.at ?? Duration.ZERO;
  movement.timeline.setTimeSignature(start, TimeSignature.of(3, 4));
  movement.timeline.setTempo(start, Tempo.of(152));
  movement.timeline.setKey(start, KeySignature.parse('Bb major'));

  const piano = getInstrument('piano');
  const part = movement.addPart('piano', piano);

  const melody = [
    ['Bb4', Q], ['D5', Q], ['F5', Q],
    ['Bb5', H], ['A5', Q],
    ['G5', T], ['F5', T], ['Eb5', T], ['D5', H],
    ['Eb5', Q], ['F5', Q], ['G5', Q],
    ['F5', H], ['D5', Q],
    ['C5', E], ['D5', E], ['Eb5', E], ['C5', E], ['Bb4', Q],
    ['A4', H], ['C5', Q],
    ['Bb4', H.plus(Q)],
  ];
  const right = part.voice('v1');
  for (const [pitch, duration] of melody) right.append(note(pitch, duration));

  // Bajo de vals: fundamental y dos acordes por compas, en la voz de abajo.
  const bass = [
    'Bb2', 'F3', 'F3', 'Bb2', 'F3', 'F3',
    'Eb3', 'Bb3', 'Bb3', 'Bb2', 'F3', 'F3',
    'Eb3', 'Bb3', 'Bb3', 'Bb2', 'F3', 'F3',
    'F2', 'C3', 'C3', 'Bb2', 'F3', 'F3',
  ];
  const left = part.ensureVoice('v2');
  for (const pitch of bass) left.append(note(pitch, Q));

  return score;
}

function summarize(score) {
  const rows = [];
  let pitches = 0;
  for (const part of score.first.parts) {
    for (const voice of part.voices) {
      const sounding = voice.events.filter((event) => event.pitches.length > 0);
      const heads = sounding.reduce((sum, event) => sum + event.pitches.length, 0);
      pitches += heads;
      rows.push(`  ${part.id}/${voice.id}: ${sounding.length} ataques, ${heads} notas`);
    }
  }
  rows.push(`  TOTAL ${pitches} notas`);
  return rows.join('\n');
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const original = compose();
  const midi = new MidiFileRenderer();
  const engraver = new VerovioRenderer();

  // 1. Tocada por un humano: los ataques se desplazan.
  const played = midi.render(original, { humanize: 0.35, performanceSeed: 'demo-vals' });
  await writeFile(join(OUT, 'vals-tocado.mid'), played.data);

  // 2. Leida como si llegara de fuera, sin saber de donde vino.
  const performance = readMidi(played.data, { name: 'vals-tocado.mid' });
  const result = performanceToScore(performance, { scoreId: 'transcrito' });

  // 3. Las dos partituras, para comparar.
  const before = await engraver.render(original, { format: 'musicxml' });
  const after = await engraver.render(result.score, { format: 'musicxml' });
  await writeFile(join(OUT, 'vals-original.musicxml'), before.data);
  await writeFile(join(OUT, 'vals-transcrito.musicxml'), after.data);

  console.log('\nOriginal');
  console.log(summarize(original));
  console.log('\nTranscrito');
  console.log(summarize(result.score));

  console.log('\nDetectado');
  console.log(`  tonalidad   ${result.key.key.name}`);
  console.log(`  correlacion ${result.key.correlation.toFixed(3)}  margen ${result.key.margin.toFixed(3)}`);
  console.log(`  compas      ${result.timeSignature.toString()}`);
  console.log(`  tempo       ${result.tempo.toFixed(1)}`);
  for (const track of result.tracks) {
    console.log(`  ${track.partId}: ${track.voices} voces, desviacion ${track.meanDeviation.toFixed(4)}`);
  }

  if (result.warnings.length > 0) {
    console.log('\nAvisos');
    for (const warning of result.warnings) console.log(`  - ${warning}`);
  } else {
    console.log('\nSin avisos.');
  }

  console.log(`\nArchivos en ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
