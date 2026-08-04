import { writeFileSync } from 'node:fs';
import {
  Duration,
  INSTRUMENTS,
  KeySignature,
  parseGrid,
  parseVoice,
  Score,
  Tempo,
  TimeSignature,
} from '@sinfo/core';
import { MidiFileRenderer } from '@sinfo/render';

/** Velocity explicita mientras la curva de dinamicas esta pendiente. */
const at = (source, velocity) =>
  parseVoice(source).events.map((e) => ({ ...e, velocity }));

const score = new Score('demo', { title: 'Demo Fase 1', composer: 'sinfo-mcp' });
const m = score.first;
m.timeline.setTempo(Duration.ZERO, Tempo.of(96));
m.timeline.setTimeSignature(Duration.ZERO, TimeSignature.parse('4/4'));
m.timeline.setKey(Duration.ZERO, KeySignature.parse('D minor'));

// Melodia con tresillos, ligadura, staccato y acorde.
m.addPart('vln', INSTRUMENTS['violin'], 'Violin I').mainVoice.append(
  ...at('d5/q a4/e f4/e d4/q+stacc r/q | e5/e3 f5/e3 g5/e3 a5/h.~ a5/w', 92),
);

// Bajo en negras.
m.addPart('vc', INSTRUMENTS['cello'], 'Violonchelo').mainVoice.append(
  ...at('d3/h a2/h | bb2/h a2/h | d3/w', 76),
);

// Acordes en el piano.
m.addPart('pno', INSTRUMENTS['piano'], 'Piano').mainVoice.append(
  ...at('[d4,f4,a4]/h [a3,c#4,e4]/h | [bb3,d4,f4]/h [a3,c#4,e4]/h | [d4,f4,a4]/w', 64),
);

// Groove de bateria en rejilla: dos compases.
const groove = parseGrid(`
  kick   x...x...x..xx...
  snare  ....X.......X...
  hihat  x.x.x.x.x.x.x.xX
`);
const drums = m.addPart('dr', INSTRUMENTS['drums'], 'Bateria').mainVoice;
drums.append(...groove.events, ...groove.events);

const artifact = new MidiFileRenderer().render(score);
const path = process.argv[2] ?? 'demo.mid';
writeFileSync(path, artifact.data);

console.log('Archivo:', path, `(${artifact.data.length} bytes)`);
console.log('Meta   :', JSON.stringify(artifact.meta));
console.log('Resumen:', JSON.stringify(score.summary(), null, 2));
