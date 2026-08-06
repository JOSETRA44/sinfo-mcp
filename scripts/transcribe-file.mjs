/**
 * Transcribe un archivo de audio real y escribe la partitura.
 *
 *   node scripts/transcribe-file.mjs "ruta/al/audio.mp3" [instrumentId]
 *
 * Pensado para probar con material de verdad, que es donde aparecen los
 * problemas que el audio sintetico no tiene: reverberacion, varios
 * instrumentos a la vez, voz con vibrato y ruido de fondo.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { AudioFileLoader } from '@sinfo/mir';
import { VerovioRenderer } from '@sinfo/render';
import { performanceToScore } from '@sinfo/transcribe';

const [input, instrumentId] = process.argv.slice(2);
if (!input) {
  console.error('Uso: node scripts/transcribe-file.mjs <audio> [instrumentId]');
  process.exit(1);
}

const OUT = join(process.cwd(), 'out');
await mkdir(OUT, { recursive: true });

const loader = new AudioFileLoader();
const status = await loader.status();
console.log(`motor=${status.engine}  polifonico=${status.polyphonic}  pulso=${status.beatTracking}`);

const started = Date.now();
const performance = await loader.load(input, {
  ...(instrumentId ? { instrumentId } : {}),
});
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const raw = performance.tracks[0]?.notes ?? [];
console.log(`\nanalisis en ${elapsed}s`);
console.log(`notas crudas: ${raw.length}`);
if (raw.length > 0) {
  const lowest = Math.min(...raw.map((n) => n.midi));
  const highest = Math.max(...raw.map((n) => n.midi));
  const last = Math.max(...raw.map((n) => n.offset));
  console.log(`registro: MIDI ${Math.round(lowest)}-${Math.round(highest)}  duracion ${last.toFixed(1)}s`);
}
console.log(`rejilla: ${performance.grid ? `${performance.grid.beats.length} pulsos, ${performance.grid.downbeats.length} fuertes` : 'ninguna'}`);

const result = performanceToScore(performance, {
  scoreId: 'transcrito',
  title: basename(input).replace(/\.[^.]+$/, ''),
});

console.log('\n== resultado ==');
console.log(`tonalidad   ${result.key.key.name}  (correlacion ${result.key.correlation.toFixed(3)}, margen ${result.key.margin.toFixed(3)})`);
console.log(`compas      ${result.timeSignature}`);
console.log(`tempo       ${result.tempo.toFixed(1)}`);
for (const track of result.tracks) {
  console.log(`${track.partId}: ${track.notes} notas, ${track.voices} voces, desviacion ${track.meanDeviation.toFixed(4)}`);
}
for (const warning of result.warnings) console.log(`  aviso: ${warning}`);

const name = basename(input).replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_');
const xml = await new VerovioRenderer().render(result.score, { format: 'musicxml' });
await writeFile(join(OUT, `${name}.musicxml`), xml.data);
console.log(`\nescrito out/${name}.musicxml`);
