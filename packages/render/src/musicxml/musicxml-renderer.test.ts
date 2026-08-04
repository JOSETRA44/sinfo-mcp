import {
  Duration,
  INSTRUMENTS,
  KeySignature,
  note,
  parseGrid,
  parseVoice,
  Score,
  Tempo,
  TimeSignature,
} from '@sinfo/core';
import { describe, expect, it } from 'vitest';
import { MusicXmlRenderer } from './musicxml-renderer.js';

const renderer = new MusicXmlRenderer();

function build(configure: (score: Score) => void): Score {
  const score = new Score('s1', { title: 'Prueba', composer: 'Claude' });
  configure(score);
  return score;
}

async function xmlOf(score: Score, movementId?: string): Promise<string> {
  const artifact = await renderer.render(score, movementId ? { movementId } : {});
  return new TextDecoder().decode(artifact.data);
}

/** Todos los `<measure number="N">` del XML, con su contenido. */
function measuresOf(xml: string, partIndex = 0): string[] {
  const parts = xml.split(/<part id="P\d+">/).slice(1);
  const part = parts[partIndex] ?? '';
  return [...part.matchAll(/<measure number="\d+">([\s\S]*?)<\/measure>/g)].map((m) => m[1]!);
}

function countOf(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

/**
 * Comprobacion de buena formacion: las etiquetas abren y cierran en orden.
 * Devuelve null si el documento es correcto, o el primer fallo encontrado.
 */
function checkWellFormed(xml: string): string | null {
  const stack: string[] = [];
  const tagPattern = /<(\/?)([\w-]+)((?:\s+[\w-]+="[^"]*")*)\s*(\/?)>/g;

  for (const [, closing, name, , selfClosing] of xml
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<![\s\S]*?>/g, '')
    .matchAll(tagPattern)) {
    if (selfClosing === '/') continue;
    if (closing === '/') {
      const open = stack.pop();
      if (open !== name) return `</${name}> cierra <${open ?? 'nada'}>`;
    } else {
      stack.push(name!);
    }
  }

  return stack.length === 0 ? null : `sin cerrar: ${stack.join(', ')}`;
}

/**
 * Suma las duraciones sonantes de un compas, en unidades de `divisions`.
 * Las notas de acorde no cuentan (suenan a la vez que la primera) y el
 * `<backup>` resta, porque rebobina el reloj para otra voz.
 */
function sumMeasureDurations(measure: string): number {
  let total = 0;
  for (const match of measure.matchAll(
    /<(note|backup|forward)>([\s\S]*?)<\/(?:note|backup|forward)>/g,
  )) {
    const [, tag, body] = match as unknown as [string, string, string];
    const duration = Number(/<duration>(\d+)<\/duration>/.exec(body)?.[1] ?? 0);
    if (tag === 'backup') total -= duration;
    else if (tag === 'note' && body.includes('<chord/>')) continue;
    else total += duration;
  }
  return total;
}

describe('MusicXmlRenderer', () => {
  it('produce un documento con la cabecera correcta', async () => {
    const score = build((s) => {
      s.first.addPart('vln', INSTRUMENTS['violin']!).mainVoice.append(...parseVoice('c4/w').events);
    });

    const xml = await xmlOf(score);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN"');
    expect(xml).toContain('<score-partwise version="4.0">');
    expect(xml).toContain('<work-title>Prueba</work-title>');
    expect(xml).toContain('<creator type="composer">Claude</creator>');
  });

  it('escapa los caracteres que romperian el XML', async () => {
    const score = new Score('s1', { title: 'Preludio & Fuga <BWV 846>' });
    score.first.addPart('vln', INSTRUMENTS['violin']!).mainVoice.append(...parseVoice('c4/w').events);

    const xml = await xmlOf(score);
    expect(xml).toContain('<work-title>Preludio &amp; Fuga &lt;BWV 846&gt;</work-title>');
    expect(xml).not.toContain('& Fuga');
  });

  it('declara una parte por instrumento con su programa MIDI', async () => {
    const score = build((s) => {
      s.first.addPart('fl', INSTRUMENTS['flute']!, 'Flauta I').mainVoice
        .append(...parseVoice('c5/w').events);
      s.first.addPart('vc', INSTRUMENTS['cello']!).mainVoice.append(...parseVoice('c3/w').events);
    });

    const xml = await xmlOf(score);
    expect(xml).toContain('<part-name>Flauta I</part-name>');
    expect(countOf(xml, /<score-part id="P\d+">/g)).toBe(2);
    // MusicXML numera los programas desde 1; la flauta es 73 en base 0.
    expect(xml).toContain('<midi-program>74</midi-program>');
  });

  describe('contenido de los compases', () => {
    it('reparte las notas en compases numerados', async () => {
      const score = build((s) => {
        s.first
          .addPart('vln', INSTRUMENTS['violin']!)
          .mainVoice.append(...parseVoice('c4/q d4/q e4/q f4/q | g4/w').events);
      });

      const xml = await xmlOf(score);
      expect(xml).toContain('<measure number="1">');
      expect(xml).toContain('<measure number="2">');
      expect(measuresOf(xml)).toHaveLength(2);
    });

    it('escribe la altura con su ortografia, no como numero MIDI', async () => {
      const score = build((s) => {
        s.first
          .addPart('vln', INSTRUMENTS['violin']!)
          .mainVoice.append(...parseVoice('C#4/h Db4/h').events);
      });

      const measures = measuresOf(await xmlOf(score));
      // Do sostenido: paso C con alteracion +1. Re bemol: paso D con -1.
      expect(measures[0]).toContain('<step>C</step>');
      expect(measures[0]).toContain('<alter>1</alter>');
      expect(measures[0]).toContain('<step>D</step>');
      expect(measures[0]).toContain('<alter>-1</alter>');
    });

    it('un acorde son notas encadenadas con <chord/>', async () => {
      const score = build((s) => {
        s.first
          .addPart('pno', INSTRUMENTS['piano']!)
          .mainVoice.append(...parseVoice('[c4,e4,g4]/w').events);
      });

      const measure = measuresOf(await xmlOf(score))[0]!;
      expect(countOf(measure, /<note>/g)).toBe(3);
      // La primera nota del acorde NO lleva <chord/>; las otras dos si.
      expect(countOf(measure, /<chord\/>/g)).toBe(2);
    });

    it('el silencio de compas entero usa el simbolo especial', async () => {
      const score = build((s) => {
        s.first
          .addPart('vln', INSTRUMENTS['violin']!)
          .mainVoice.append(...parseVoice('r/w | c4/w').events);
      });

      const measures = measuresOf(await xmlOf(score));
      expect(measures[0]).toContain('<rest measure="yes"/>');
      // Y no declara figura: la dibuja el editor segun el compas.
      expect(measures[0]).not.toContain('<type>');
    });
  });

  describe('ligaduras a traves de la barra', () => {
    it('parte la nota y la une con tie y tied', async () => {
      const score = build((s) => {
        s.first
          .addPart('vln', INSTRUMENTS['violin']!)
          .mainVoice.append(...parseVoice('c4/h. d4/h e4/q').events);
      });

      const measures = measuresOf(await xmlOf(score));
      expect(measures[0]).toContain('<tie type="start"/>');
      expect(measures[0]).toContain('<tied type="start"/>');
      expect(measures[1]).toContain('<tie type="stop"/>');
      expect(measures[1]).toContain('<tied type="stop"/>');
    });

    it('los silencios partidos no llevan ligadura', async () => {
      const score = build((s) => {
        s.first
          .addPart('vln', INSTRUMENTS['violin']!)
          .mainVoice.append(note('C4', Duration.HALF), ...parseVoice('r/w').events);
      });

      const xml = await xmlOf(score);
      const restSection = xml.slice(xml.indexOf('<rest'));
      expect(restSection).not.toContain('<tie ');
    });
  });

  describe('grupos irregulares', () => {
    it('declara la modificacion de tiempo en cada nota del grupo', async () => {
      const score = build((s) => {
        s.first
          .addPart('vln', INSTRUMENTS['violin']!)
          .mainVoice.append(...parseVoice('c4/e3 d4/e3 e4/e3 f4/h.').events);
      });

      const measure = measuresOf(await xmlOf(score))[0]!;
      expect(countOf(measure, /<time-modification>/g)).toBe(3);
      expect(measure).toContain('<actual-notes>3</actual-notes>');
      expect(measure).toContain('<normal-notes>2</normal-notes>');
    });

    it('marca el corchete solo al principio y al final del grupo', async () => {
      const score = build((s) => {
        s.first
          .addPart('vln', INSTRUMENTS['violin']!)
          .mainVoice.append(...parseVoice('c4/e3 d4/e3 e4/e3 f4/h.').events);
      });

      const measure = measuresOf(await xmlOf(score))[0]!;
      expect(countOf(measure, /<tuplet type="start"/g)).toBe(1);
      expect(countOf(measure, /<tuplet type="stop"/g)).toBe(1);
      // La nota del medio no repite el numerito.
      expect(countOf(measure, /<tuplet /g)).toBe(2);
    });

    it('las divisiones hacen exacta la duracion del tresillo', async () => {
      const score = build((s) => {
        s.first
          .addPart('vln', INSTRUMENTS['violin']!)
          .mainVoice.append(...parseVoice('c4/e3 d4/e3 e4/e3 f4/h.').events);
      });

      const xml = await xmlOf(score);
      const divisions = Number(/<divisions>(\d+)<\/divisions>/.exec(xml)![1]);
      // 1/12 de redonda en negras = 1/3; multiplicado por divisions debe ser entero.
      expect((divisions / 3) % 1).toBe(0);
    });
  });

  describe('claves, armaduras y transposicion', () => {
    it('asigna la clave propia de cada instrumento', async () => {
      const score = build((s) => {
        s.first.addPart('vc', INSTRUMENTS['cello']!).mainVoice.append(...parseVoice('c3/w').events);
        s.first.addPart('vla', INSTRUMENTS['viola']!).mainVoice.append(...parseVoice('c4/w').events);
      });

      const xml = await xmlOf(score);
      expect(xml).toContain('<sign>F</sign>');
      expect(xml).toContain('<sign>C</sign>');
    });

    it('escribe la armadura como numero de quintas', async () => {
      const score = build((s) => {
        s.first.timeline.setKey(Duration.ZERO, KeySignature.parse('Eb major'));
        s.first.addPart('vln', INSTRUMENTS['violin']!).mainVoice.append(...parseVoice('c4/w').events);
      });

      const xml = await xmlOf(score);
      expect(xml).toContain('<fifths>-3</fifths>');
      expect(xml).toContain('<mode>major</mode>');
    });

    // Sin esto la particella se ve bien pero la partitura general suena mal.
    it('declara la transposicion de los instrumentos transpositores', async () => {
      const score = build((s) => {
        s.first.addPart('cl', INSTRUMENTS['clarinet']!).mainVoice.append(...parseVoice('c4/w').events);
      });

      const xml = await xmlOf(score);
      expect(xml).toContain('<transpose>');
      // El clarinete en Sib suena una segunda mayor por debajo.
      expect(xml).toContain('<diatonic>-1</diatonic>');
      expect(xml).toContain('<chromatic>-2</chromatic>');
    });

    it('separa el componente de octava en instrumentos que bajan mas de una', async () => {
      const score = build((s) => {
        s.first
          .addPart('cb', INSTRUMENTS['contrabass']!)
          .mainVoice.append(...parseVoice('c3/w').events);
      });

      const xml = await xmlOf(score);
      expect(xml).toContain('<octave-change>-1</octave-change>');
    });

    it('un instrumento en Do no declara transposicion', async () => {
      const score = build((s) => {
        s.first.addPart('vln', INSTRUMENTS['violin']!).mainVoice.append(...parseVoice('c4/w').events);
      });
      expect(await xmlOf(score)).not.toContain('<transpose>');
    });

    it('reimprime el compas solo donde cambia', async () => {
      const score = build((s) => {
        s.first.timeline.setTimeSignature(Duration.of(2, 1), TimeSignature.parse('3/4'));
        s.first
          .addPart('vln', INSTRUMENTS['violin']!)
          .mainVoice.append(...parseVoice('c4/w | d4/w | e4/h. | f4/h.').events);
      });

      const measures = measuresOf(await xmlOf(score));
      expect(measures[0]).toContain('<beats>4</beats>');
      expect(measures[1]).not.toContain('<time>');
      expect(measures[2]).toContain('<beats>3</beats>');
    });
  });

  describe('dinamicas y tempo', () => {
    it('escribe el tempo al principio', async () => {
      const score = build((s) => {
        s.first.timeline.setTempo(Duration.ZERO, Tempo.of(132));
        s.first.addPart('vln', INSTRUMENTS['violin']!).mainVoice.append(...parseVoice('c4/w').events);
      });

      const xml = await xmlOf(score);
      expect(xml).toContain('<per-minute>132</per-minute>');
      expect(xml).toContain('<sound tempo="132"/>');
    });

    it('escribe las marcas de dinamica', async () => {
      const score = build((s) => {
        s.first
          .addPart('vln', INSTRUMENTS['violin']!)
          .mainVoice.append(...parseVoice('pp c4/w | ff d4/w').events);
      });

      const measures = measuresOf(await xmlOf(score));
      expect(measures[0]).toContain('<pp/>');
      expect(measures[1]).toContain('<ff/>');
    });

    it('traduce las articulaciones a sus etiquetas', async () => {
      const score = build((s) => {
        s.first
          .addPart('vln', INSTRUMENTS['violin']!)
          .mainVoice.append(...parseVoice('c4/q+stacc d4/q+accent e4/q+marcato f4/q+ferm').events);
      });

      const measure = measuresOf(await xmlOf(score))[0]!;
      expect(measure).toContain('<staccato/>');
      expect(measure).toContain('<accent/>');
      expect(measure).toContain('<strong-accent/>');
      // El calderon va bajo <notations>, no dentro de <articulations>.
      expect(measure).toMatch(/<notations>\s*<fermata\/>/);
    });
  });

  describe('percusion', () => {
    it('usa unpitched en vez de alturas', async () => {
      const score = build((s) => {
        s.first
          .addPart('dr', INSTRUMENTS['drums']!)
          .mainVoice.append(...parseGrid('kick x...x...').events);
      });

      const xml = await xmlOf(score);
      expect(xml).toContain('<unpitched>');
      expect(xml).toContain('<display-step>');
      expect(xml).toContain('<sign>percussion</sign>');
      expect(xml).toContain('<midi-channel>10</midi-channel>');
    });
  });

  describe('varias voces en una parte', () => {
    it('rebobina con backup y numera las voces', async () => {
      const score = build((s) => {
        const part = s.first.addPart('pno', INSTRUMENTS['piano']!);
        part.mainVoice.append(...parseVoice('c5/w').events);
        part.ensureVoice('lh').append(...parseVoice('c3/h e3/h').events);
      });

      const measure = measuresOf(await xmlOf(score))[0]!;
      expect(measure).toContain('<backup>');
      expect(measure).toContain('<voice>1</voice>');
      expect(measure).toContain('<voice>2</voice>');
    });
  });

  describe('alineacion de las partes', () => {
    it('todas las partes tienen el mismo numero de compases', async () => {
      const score = build((s) => {
        s.first
          .addPart('vln', INSTRUMENTS['violin']!)
          .mainVoice.append(...parseVoice('c5/w | d5/w | e5/w').events);
        // El fagot solo toca un compas.
        s.first.addPart('fg', INSTRUMENTS['bassoon']!).mainVoice.append(...parseVoice('c3/w').events);
      });

      const xml = await xmlOf(score);
      expect(measuresOf(xml, 0)).toHaveLength(3);
      expect(measuresOf(xml, 1)).toHaveLength(3);
      // Y los compases vacios del fagot llevan silencio de compas entero.
      expect(measuresOf(xml, 1)[2]).toContain('<rest measure="yes"/>');
    });
  });

  /**
   * Validacion estructural: sin abrir un editor, estas dos comprobaciones
   * detectan la practica totalidad de los archivos que un editor rechazaria o
   * dibujaria descuadrados.
   */
  describe('validez del documento', () => {
    const repertoire = [
      ['tresillos y ligaduras', '4/4', 'c4/e3 d4/e3 e4/e3 f4/h. | g4/w'],
      ['notas que cruzan barra', '4/4', 'c4/q d4/w e4/w f4/q'],
      ['tres por cuatro', '3/4', 'c4/q d4/q e4/q | f4/h.'],
      ['seis por ocho', '6/8', 'c4/e d4/e e4/e f4/e g4/e a4/e | b4/h.'],
      ['compas irregular', '5/8', 'c4/q d4/e | e4/h e4/e'],
      ['puntillos y silencios', '4/4', 'c4/q. r/e d4/h | r/w'],
      ['acordes', '4/4', '[c4,e4,g4]/h [d4,f4,a4]/h'],
    ] as const;

    it.each(repertoire)('%s produce XML bien formado', async (_name, signature, source) => {
      const score = build((s) => {
        s.first.timeline.setTimeSignature(Duration.ZERO, TimeSignature.parse(signature));
        s.first.addPart('vln', INSTRUMENTS['violin']!).mainVoice.append(...parseVoice(source).events);
      });

      expect(checkWellFormed(await xmlOf(score))).toBeNull();
    });

    it.each(repertoire)(
      '%s: cada compas suma su duracion en divisions',
      async (_name, signature, source) => {
        const timeSignature = TimeSignature.parse(signature);
        const score = build((s) => {
          s.first.timeline.setTimeSignature(Duration.ZERO, timeSignature);
          s.first
            .addPart('vln', INSTRUMENTS['violin']!)
            .mainVoice.append(...parseVoice(source).events);
        });

        const xml = await xmlOf(score);
        const divisions = Number(/<divisions>(\d+)<\/divisions>/.exec(xml)![1]);
        const expected = Math.round(timeSignature.measureDuration.quarters * divisions);

        for (const [index, measure] of measuresOf(xml).entries()) {
          expect(sumMeasureDurations(measure), `compas ${index + 1}`).toBe(expected);
        }
      },
    );
  });

  describe('formatos declarados', () => {
    it('solo dice cubrir MusicXML', () => {
      expect(renderer.formats).toEqual(['musicxml']);
    });

    it('informa de lo generado', async () => {
      const score = build((s) => {
        s.first
          .addPart('vln', INSTRUMENTS['violin']!)
          .mainVoice.append(...parseVoice('c4/w | d4/w').events);
      });

      const artifact = await renderer.render(score);
      expect(artifact.format).toBe('musicxml');
      expect(artifact.filename).toBe('prueba.musicxml');
      expect(artifact.meta).toMatchObject({ parts: 1, measures: 2 });
    });
  });
});
