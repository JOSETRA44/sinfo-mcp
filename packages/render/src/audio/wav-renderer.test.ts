import { Duration, INSTRUMENTS, parseVoice, Score, Tempo } from '@sinfo/core';
import { describe, expect, it } from 'vitest';
import { VerovioRenderer } from '../engraving/verovio-renderer.js';
import { WavRenderer } from './wav-renderer.js';

/**
 * El banco incorporado de la libreria tiene UN solo sonido, en el programa 0.
 * Se usa el piano en los tests para que la sintesis produzca audio audible sin
 * depender de un SoundFont de 140 MB instalado en la maquina.
 */
function pianoScore(notation = 'mf c4/q e4/q g4/q c5/q', bpm = 120): Score {
  const score = new Score('t', { title: 'Prueba', composer: 'sinfo' });
  score.first.timeline.setTempo(Duration.ZERO, Tempo.of(bpm));
  score.first.addPart('pno', INSTRUMENTS['piano']!).mainVoice.append(
    ...parseVoice(notation).events,
  );
  return score;
}

describe('WavRenderer', () => {
  const renderer = new WavRenderer();

  it('declara que solo cubre WAV', () => {
    expect(renderer.formats).toEqual(['wav']);
  });

  it('produce un WAV con cabecera valida', async () => {
    const artifact = await renderer.render(pianoScore());
    const header = new TextDecoder().decode(artifact.data.subarray(0, 12));

    expect(artifact.format).toBe('wav');
    expect(artifact.mimeType).toBe('audio/wav');
    expect(header.startsWith('RIFF')).toBe(true);
    expect(header.endsWith('WAVE')).toBe(true);
  });

  // Lo que separa "genero un archivo" de "genero musica".
  it('el audio suena: no sale en silencio', async () => {
    const artifact = await renderer.render(pianoScore());
    expect(artifact.meta?.['peak'] as number).toBeGreaterThan(0.001);
    expect(artifact.meta?.['warning']).toBeUndefined();
  });

  it('un instrumento sin preset propio cae al que hay en vez de callar', async () => {
    // El trombon pide el programa 57 y el banco incorporado solo trae el 0.
    const score = new Score('t', { title: 'Sustituido' });
    score.first.addPart('tbn', INSTRUMENTS['trombone']!).mainVoice.append(
      ...parseVoice('c3/w').events,
    );

    const artifact = await renderer.render(score);
    expect(artifact.meta?.['peak'] as number).toBeGreaterThan(0);
  });

  it('avisa cuando el resultado sale mudo', async () => {
    // Una partitura sin notas no puede sonar: es el caso donde el aviso ayuda.
    const score = new Score('t', { title: 'Mudo' });
    score.first.addPart('pno', INSTRUMENTS['piano']!).mainVoice.append(
      ...parseVoice('r/w r/w').events,
    );

    const artifact = await renderer.render(score);
    expect(artifact.meta?.['peak']).toBe(0);
    expect(String(artifact.meta?.['warning'])).toContain('SINFO_SOUNDFONT');
  });

  it('cuenta las notas que ha sintetizado', async () => {
    const artifact = await renderer.render(pianoScore('c4/q e4/q g4/q c5/q'));
    expect(artifact.meta?.['notes']).toBe(4);
  });

  it('los silencios no generan notas', async () => {
    const artifact = await renderer.render(pianoScore('c4/q r/q r/q c5/q'));
    expect(artifact.meta?.['notes']).toBe(2);
  });

  it('los acordes suenan todas sus notas', async () => {
    const artifact = await renderer.render(pianoScore('[c4,e4,g4]/w'));
    expect(artifact.meta?.['notes']).toBe(3);
  });

  /**
   * Si el tempo no se respetara, el mismo pasaje duraria lo mismo a cualquier
   * velocidad y toda la obra iria corrida a partir del primer cambio.
   */
  it('la duracion depende del tempo', async () => {
    const lento = await renderer.render(pianoScore('c4/w c4/w c4/w c4/w', 60));
    const rapido = await renderer.render(pianoScore('c4/w c4/w c4/w c4/w', 180));

    expect(lento.meta?.['seconds'] as number).toBeGreaterThan(
      (rapido.meta?.['seconds'] as number) * 2,
    );
  });

  it('respeta un cambio de tempo a mitad de obra', async () => {
    const score = pianoScore('c4/w c4/w c4/w c4/w', 120);
    score.first.timeline.setTempo(Duration.of(2, 1), Tempo.of(40));

    const artifact = await renderer.render(score);
    // Dos redondas a negra=120 son 4 s; las dos siguientes a negra=40 son 12 s.
    // Sin respetar el cambio, las cuatro medirian 8 s en total.
    const seconds = artifact.meta?.['seconds'] as number;
    expect(seconds).toBeGreaterThan(16);
    expect(seconds).toBeLessThan(19);
  });

  it('la frecuencia de muestreo es configurable', async () => {
    const artifact = await renderer.render(pianoScore(), { sampleRate: 22050 });
    expect(artifact.meta?.['sampleRate']).toBe(22050);
    expect(artifact.data.length).toBeLessThan(600_000);
  });

  it('informa de que SoundFont uso', async () => {
    const artifact = await renderer.render(pianoScore());
    expect(String(artifact.meta?.['soundfont'])).toContain('incorporado');
    expect(artifact.meta?.['presets']).toBe(1);
  });

  it('el nombre del archivo sale del titulo', async () => {
    const score = pianoScore();
    const artifact = await renderer.render(score);
    expect(artifact.filename).toBe('prueba.wav');
  });
});

describe('VerovioRenderer', () => {
  const renderer = new VerovioRenderer();

  it('declara que cubre SVG y MusicXML', () => {
    expect(renderer.formats).toEqual(['svg', 'musicxml']);
  });

  it('graba la partitura a SVG', async () => {
    const artifact = await renderer.render(pianoScore());
    const svg = new TextDecoder().decode(artifact.data);

    expect(artifact.format).toBe('svg');
    expect(artifact.mimeType).toBe('image/svg+xml');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('el SVG contiene notacion de verdad, no un lienzo vacio', async () => {
    const svg = new TextDecoder().decode((await renderer.render(pianoScore())).data);
    // Verovio marca cada elemento con su clase MEI.
    expect(svg).toContain('class="note"');
    expect(svg).toContain('class="staff"');
    expect(svg).toContain('class="measure"');
    expect(svg.length).toBeGreaterThan(10_000);
  });

  it('sigue pudiendo entregar el MusicXML de origen', async () => {
    const artifact = await renderer.render(pianoScore(), { format: 'musicxml' });
    expect(artifact.format).toBe('musicxml');
    expect(new TextDecoder().decode(artifact.data)).toContain('<score-partwise');
  });

  it('una partitura larga se apila en un solo SVG', async () => {
    const long = pianoScore(Array.from({ length: 40 }, () => 'c4/q e4/q g4/q c5/q').join(' '));
    const artifact = await renderer.render(long);
    const svg = new TextDecoder().decode(artifact.data);

    expect(artifact.meta?.['pages'] as number).toBeGreaterThanOrEqual(1);
    // Un unico elemento raiz, aunque haya varias paginas dentro.
    expect(svg.match(/^<svg/gm)).toHaveLength(1);
  });

  it('varias partes se graban juntas', async () => {
    const score = pianoScore();
    score.first.addPart('vc', INSTRUMENTS['cello']!).mainVoice.append(
      ...parseVoice('c3/w').events,
    );

    const artifact = await renderer.render(score);
    expect(artifact.meta?.['parts']).toBe(2);
  });
});
