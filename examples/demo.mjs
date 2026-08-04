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
import { MidiFileRenderer, MusicXmlRenderer } from '@sinfo/render';

/** Las dinamicas escritas se traducen solas a velocity (curva calibrada). */
const at = (source) => parseVoice(source).events;

const score = new Score('demo', { title: 'Demo Fase 1', composer: 'sinfo-mcp' });
const m = score.first;
m.timeline.setTempo(Duration.ZERO, Tempo.of(96));
m.timeline.setTimeSignature(Duration.ZERO, TimeSignature.parse('4/4'));
m.timeline.setKey(Duration.ZERO, KeySignature.parse('D minor'));

// Melodia con tresillos, ligadura, staccato y acorde.
m.addPart('vln', INSTRUMENTS['violin'], 'Violin I').mainVoice.append(
  ...at('mf d5/q a4/e f4/e d4/q+stacc r/q | e5/e3 f5/e3 g5/e3 a5/h.~ a5/w'),
);

// Bajo en negras.
m.addPart('vc', INSTRUMENTS['cello'], 'Violonchelo').mainVoice.append(
  ...at('mp d3/h a2/h | bb2/h a2/h | d3/w'),
);

// Acordes en el piano.
m.addPart('pno', INSTRUMENTS['piano'], 'Piano').mainVoice.append(
  ...at('p [d4,f4,a4]/h [a3,c#4,e4]/h | [bb3,d4,f4]/h [a3,c#4,e4]/h | [d4,f4,a4]/w'),
);

// Groove de bateria en rejilla: dos compases.
const groove = parseGrid(`
  kick   x...x...x..xx...
  snare  ....X.......X...
  hihat  x.x.x.x.x.x.x.xX
`);
const drums = m.addPart('dr', INSTRUMENTS['drums'], 'Bateria').mainVoice;
drums.append(...groove.events, ...groove.events);

const midiPath = process.argv[2] ?? 'demo.mid';
const xmlPath = midiPath.replace(/\.mid$/, '.musicxml');

const midi = new MidiFileRenderer().render(score);
writeFileSync(midiPath, midi.data);
console.log(`MIDI     : ${midiPath} (${midi.data.length} bytes)`);
console.log(`  meta   : ${JSON.stringify(midi.meta)}`);

const xml = await new MusicXmlRenderer().render(score);
writeFileSync(xmlPath, xml.data);
console.log(`MusicXML : ${xmlPath} (${xml.data.length} bytes)`);
console.log(`  meta   : ${JSON.stringify(xml.meta)}`);
