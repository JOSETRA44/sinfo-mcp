import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { parseMidi } from 'midi-file';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryArtifactSink } from './adapters/file-sink.js';
import { ALL_TOOLS } from './tools/index.js';
import { createServer } from './server.js';

/**
 * Integracion de verdad: un cliente MCP real hablando con el servidor por un
 * transporte en memoria. Ejercita el mismo camino que Claude Code (validacion
 * de esquemas incluida), sin tocar el disco ni levantar procesos.
 */

let client: Client;
let sink: MemoryArtifactSink;

beforeEach(async () => {
  sink = new MemoryArtifactSink();
  const server = createServer({ sink });
  client = new Client({ name: 'test', version: '0.0.0' });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

/** Llama a una herramienta y devuelve el JSON ya interpretado. */
async function call<T = Record<string, unknown>>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  const text = result.content[0]?.text ?? '{}';
  const parsed = JSON.parse(text) as T;
  if (result.isError) {
    throw Object.assign(new Error(`herramienta ${name} fallo`), { payload: parsed });
  }
  return parsed;
}

/** Igual que `call`, pero espera que falle y devuelve el error estructurado. */
async function callExpectingError(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ code: string; message: string; details?: Record<string, unknown> }> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).toBe(true);
  return JSON.parse(result.content[0]!.text);
}

describe('registro de herramientas', () => {
  it('publica todas las del catalogo', async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(ALL_TOOLS.length);
    expect(tools.map((t) => t.name).sort()).toEqual(ALL_TOOLS.map((t) => t.name).sort());
  });

  it('cada herramienta lleva descripcion y esquema', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description, `${tool.name} sin descripcion`).toBeTruthy();
      expect(tool.description!.length, `${tool.name} con descripcion muy corta`).toBeGreaterThan(60);
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it('marca como solo lectura las que no mutan', async () => {
    const { tools } = await client.listTools();
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
    expect(readOnly).toContain('score_describe');
    expect(readOnly).toContain('part_read');
    expect(readOnly).toContain('check_ranges');
    expect(readOnly).not.toContain('part_write');
  });
});

describe('flujo de composicion completo', () => {
  it('crear, anadir partes, escribir y exportar', async () => {
    const created = await call<{ scoreId: string }>('score_create', {
      title: 'Cuarteto de prueba',
      composer: 'Claude',
      key: 'D minor',
      tempo: 96,
      timeSignature: '4/4',
      instruments: ['violin', 'violin', 'viola', 'cello'],
    });
    expect(created.scoreId).toBe('score-1');

    // Repetir instrumento numera el id solo.
    const summary = await call<{ summary: { movements: { parts: { id: string }[] }[] } }>(
      'score_describe',
      { scoreId: created.scoreId },
    );
    expect(summary.summary.movements[0]!.parts.map((p) => p.id)).toEqual([
      'violin',
      'violin2',
      'viola',
      'cello',
    ]);

    const written = await call<{ eventsWritten: number; endMeasure: number }>('part_write', {
      scoreId: created.scoreId,
      partId: 'violin',
      notation: 'mf d5/q a4/e f4/e d4/q+stacc r/q | e5/h f5/h',
    });
    // Siete eventos: `mf` es una marca de dinamica, no un evento sonoro.
    expect(written.eventsWritten).toBe(7);
    expect(written.endMeasure).toBe(2);

    const exported = await call<{ format: string; path: string; bytes: number }>('export', {
      scoreId: created.scoreId,
      format: 'midi',
    });
    expect(exported.format).toBe('midi');
    expect(exported.bytes).toBeGreaterThan(0);

    // El archivo generado es un MIDI valido.
    const artifact = sink.saved.at(-1)!.artifact;
    const midi = parseMidi(artifact.data);
    expect(midi.header.format).toBe(1);
    expect(midi.tracks).toHaveLength(5); // director + 4 partes
  });

  it('escribe percusion en notacion de rejilla sin declarar el formato', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Beat',
      instruments: ['drums'],
    });

    const written = await call<{ eventsWritten: number }>('part_write', {
      scoreId,
      partId: 'drums',
      notation: `
        kick   x...x...x...x...
        snare  ....X.......X...
        hihat  x.x.x.x.x.x.x.x.
      `,
    });
    expect(written.eventsWritten).toBeGreaterThan(0);
    expect(written.durationWritten ?? '1/1').toBeDefined();
  });

  it('mantiene la partitura entre llamadas sin reenviarla', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Acumulativa',
      instruments: ['piano'],
    });

    for (let i = 0; i < 5; i++) {
      await call('part_write', { scoreId, partId: 'piano', notation: 'c4/q e4/q g4/q c5/q' });
    }

    const described = await call<{ summary: { eventCount: number } }>('score_describe', { scoreId });
    expect(described.summary.eventCount).toBe(20);
  });

  it('permite releer lo escrito acotando por compases', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Lectura',
      instruments: ['flute'],
    });
    await call('part_write', {
      scoreId,
      partId: 'flute',
      notation: 'c5/w | d5/w | e5/w | f5/w',
    });

    const read = await call<{ notation: string; fromMeasure: number; toMeasure: number }>(
      'part_read',
      { scoreId, partId: 'flute', fromMeasure: 2, toMeasure: 3 },
    );
    expect(read.notation).toContain('D5');
    expect(read.notation).toContain('E5');
    expect(read.notation).not.toContain('C5');
    expect(read.notation).not.toContain('F5');
  });

  it('atMeasure alinea una entrada tardia con silencios', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Entrada tardia',
      instruments: ['horn'],
    });

    const written = await call<{ startMeasure: number }>('part_write', {
      scoreId,
      partId: 'horn',
      notation: 'c4/w',
      atMeasure: 9,
    });
    expect(written.startMeasure).toBe(9);

    const read = await call<{ notation: string }>('part_read', {
      scoreId,
      partId: 'horn',
      fromMeasure: 1,
      toMeasure: 9,
    });
    // Los ocho compases previos se rellenaron con silencio.
    expect(read.notation.startsWith('r/')).toBe(true);
  });
});

describe('el servidor corrige al agente en vez de romperse', () => {
  it('rechaza un compas con tiempos de mas y explica cual', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Descuadre',
      instruments: ['violin'],
    });

    const error = await callExpectingError('part_write', {
      scoreId,
      partId: 'violin',
      notation: 'c4/q e4/q g4/q c5/q e5/q | d5/h e5/h',
    });

    expect(error.code).toBe('NOTATION_ERROR');
    expect(error.message).toContain('compas 1');
    expect(error.details?.['hint']).toBeTruthy();
  });

  it('deja pasar el descuadre si es intencionado', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Anacrusa',
      instruments: ['violin'],
    });

    const written = await call<{ eventsWritten: number; warnings: string[] }>('part_write', {
      scoreId,
      partId: 'violin',
      notation: 'g4/q | c5/h e5/h',
      strictBarlines: false,
    });
    expect(written.eventsWritten).toBe(3);
    expect(written.warnings.length).toBeGreaterThan(0);
  });

  it('un instrumento inexistente devuelve la lista de los que hay', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', { title: 'X' });
    const error = await callExpectingError('part_add', {
      scoreId,
      instrumentId: 'theremin_cuantico',
    });

    expect(error.code).toBe('INVALID_REQUEST');
    expect(error.details?.['available']).toContain('violin');
  });

  it('una notacion mal escrita se marca como corregible, no como fallo interno', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Mala notacion',
      instruments: ['violin'],
    });

    const error = await callExpectingError('part_write', {
      scoreId,
      partId: 'violin',
      notation: 'c4 e4 g4',
    });
    expect(error.code).toBe('NOTATION_ERROR');
  });

  it('un scoreId desconocido dice cuales estan abiertos', async () => {
    await call('score_create', { title: 'Abierta' });
    const error = await callExpectingError('score_describe', { scoreId: 'score-999' });

    expect(error.code).toBe('SESSION_NOT_FOUND');
    expect(error.details?.['open']).toEqual(['score-1']);
  });

  it('un formato sin adaptador dice cuales estan disponibles', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Sin adaptador',
      instruments: ['violin'],
    });
    await call('part_write', { scoreId, partId: 'violin', notation: 'c4/w' });

    const error = await callExpectingError('export', { scoreId, format: 'wav' });
    expect(error.code).toBe('FORMAT_UNAVAILABLE');
    // La lista se calcula de los adaptadores montados, no de una constante.
    expect(error.details?.['availableNow']).toContain('midi');
    expect(error.details?.['availableNow']).toContain('musicxml');
    expect(error.details?.['availableNow']).not.toContain('wav');
  });

  // LilyPond comparte puerto con MusicXML: sin declarar que formatos cubre
  // cada adaptador, pedir LilyPond devolvia un MusicXML sin avisar.
  it('no entrega un formato por otro cuando comparten adaptador', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Formato equivocado',
      instruments: ['violin'],
    });
    await call('part_write', { scoreId, partId: 'violin', notation: 'c4/w' });

    const error = await callExpectingError('export', { scoreId, format: 'lilypond' });
    expect(error.code).toBe('FORMAT_UNAVAILABLE');
  });

  it('exporta MusicXML de verdad', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Partitura',
      instruments: ['violin'],
    });
    await call('part_write', { scoreId, partId: 'violin', notation: 'c4/q d4/q e4/q f4/q' });

    const result = await call<{ format: string; meta: Record<string, unknown> }>('export', {
      scoreId,
      format: 'musicxml',
    });
    expect(result.format).toBe('musicxml');
    expect(result.meta['measures']).toBe(1);

    const xml = new TextDecoder().decode(sink.saved.at(-1)!.artifact.data);
    expect(xml).toContain('<score-partwise version="4.0">');
  });

  it('la escritura fallida no deja la partitura a medias', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Atomicidad',
      instruments: ['violin'],
    });
    await call('part_write', { scoreId, partId: 'violin', notation: 'c4/w' });

    await callExpectingError('part_write', {
      scoreId,
      partId: 'violin',
      notation: 'd4/q e4/basura f4/q',
    });

    const described = await call<{ summary: { eventCount: number } }>('score_describe', { scoreId });
    expect(described.summary.eventCount).toBe(1);
  });
});

describe('verificacion musical', () => {
  it('detecta notas fuera del rango del instrumento', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Rangos',
      instruments: ['violin'],
    });
    // El violin no baja de Sol3: un Do2 es imposible.
    await call('part_write', { scoreId, partId: 'violin', notation: 'c2/h g5/h' });

    const check = await call<{ issueCount: number; issues: { verdict: string }[] }>(
      'check_ranges',
      { scoreId },
    );
    expect(check.issueCount).toBeGreaterThan(0);
    expect(check.issues.some((i) => i.verdict === 'below-range')).toBe(true);
  });

  it('tiene en cuenta la transposicion al comprobar rangos', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Transposicion',
      instruments: ['clarinet'],
    });
    // El clarinete en Sib llega hasta Re3 SONANTE. Escrito Re3 suena Do3, que
    // es imposible; escrito Mi3 suena Re3, que si llega. Si la comprobacion
    // ignorase la transposicion, ambas pareceran validas.
    await call('part_write', { scoreId, partId: 'clarinet', notation: 'd3/h e3/h' });

    const check = await call<{ issues: { sounding: string; written: string; verdict: string }[] }>(
      'check_ranges',
      { scoreId },
    );

    const writtenD3 = check.issues.find((i) => i.written === 'D3');
    expect(writtenD3?.sounding).toBe('C3');
    expect(writtenD3?.verdict).toBe('below-range');

    const writtenE3 = check.issues.find((i) => i.written === 'E3');
    expect(writtenE3?.verdict).not.toBe('below-range');
  });

  it('cambia el compas a partir de un punto concreto', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Cambio de metro',
      timeSignature: '4/4',
      instruments: ['piano'],
    });
    await call('timeline_set', { scoreId, atMeasure: 3, timeSignature: '6/8' });

    const timeline = await call<{ timeSignatures: { measure: number; value: string }[] }>(
      'timeline_describe',
      { scoreId },
    );
    expect(timeline.timeSignatures).toEqual([
      { measure: 1, value: '4/4' },
      { measure: 3, value: '6/8' },
    ]);
  });
});

describe('obras de varios movimientos', () => {
  it('el movimiento nuevo hereda la plantilla orquestal', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Sinfonia',
      instruments: ['flute', 'horn', 'violin', 'cello'],
    });

    const second = await call<{ movementId: string; parts: string[] }>('movement_add', {
      scoreId,
      title: 'II. Andante',
      tempo: 66,
      key: 'Bb major',
    });

    expect(second.movementId).toBe('m2');
    expect(second.parts).toEqual(['flute', 'horn', 'violin', 'cello']);
  });

  it('exporta un solo movimiento cuando se pide', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Dos tiempos',
      instruments: ['piano'],
    });
    await call('part_write', { scoreId, partId: 'piano', notation: 'c4/w' });
    await call('movement_add', { scoreId, title: 'II' });
    await call('part_write', { scoreId, movementId: 'm2', partId: 'piano', notation: 'e4/w' });

    await call('export', { scoreId, movementId: 'm2' });
    const midi = parseMidi(sink.saved.at(-1)!.artifact.data);
    const notes = midi.tracks[1]!.filter((e) => e.type === 'noteOn');
    expect(notes).toHaveLength(1);
  });
});

describe('material tematico', () => {
  it('crea un motivo y lo guarda en la sesion', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', { title: 'Tema' });

    const motif = await call<{ motifId: string; notation: string; notes: number }>(
      'motif_create',
      { scoreId, notation: 'c4/e d4/e e4/q' },
    );
    expect(motif.motifId).toBe('motif-1');
    expect(motif.notes).toBe(3);

    const listed = await call<{ motifs: { motifId: string }[] }>('motif_list', { scoreId });
    expect(listed.motifs.map((m) => m.motifId)).toEqual(['motif-1']);
  });

  it('encadena transformaciones y guarda la genealogia', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Desarrollo',
      key: 'C major',
    });
    await call('motif_create', { scoreId, notation: 'c4/e d4/e e4/q', motifId: 'tema' });

    const developed = await call<{ motifId: string; derivation: string[]; notation: string }>(
      'motif_develop',
      {
        scoreId,
        motifId: 'tema',
        transformations: [
          { op: 'transpose', interval: 'P5' },
          { op: 'retrograde' },
          { op: 'augment', factor: 2 },
        ],
      },
    );

    expect(developed.derivation).toEqual([
      'origen',
      'transposicion P5',
      'retrogradacion',
      'aumentacion x2',
    ]);
    // El original sigue intacto.
    const original = await call<{ motifs: { motifId: string; notation: string }[] }>(
      'motif_list',
      { scoreId },
    );
    expect(original.motifs.find((m) => m.motifId === 'tema')!.notation).toBe('C4/e D4/e E4/q');
  });

  it('la inversion tonal se queda dentro de la tonalidad', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Inversion',
      key: 'C major',
    });
    await call('motif_create', { scoreId, notation: 'c4/q e4/q g4/q', motifId: 'tema' });

    const inverted = await call<{ notation: string }>('motif_develop', {
      scoreId,
      motifId: 'tema',
      transformations: [{ op: 'invert' }],
    });
    expect(inverted.notation).toBe('C4/q A3/q F3/q');
  });

  it('escribe un motivo en una parte, transportado si se pide', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Exposicion',
      instruments: ['violin', 'cello'],
    });
    await call('motif_create', { scoreId, notation: 'c4/q e4/q g4/h', motifId: 'tema' });

    await call('motif_write', { scoreId, motifId: 'tema', partId: 'violin' });
    await call('motif_write', {
      scoreId,
      motifId: 'tema',
      partId: 'cello',
      transposeTo: '-P8',
    });

    const violin = await call<{ notation: string }>('part_read', { scoreId, partId: 'violin' });
    const cello = await call<{ notation: string }>('part_read', { scoreId, partId: 'cello' });
    expect(violin.notation).toContain('C4/q');
    expect(cello.notation).toContain('C3/q');
  });

  it('un motivo inexistente dice cuales hay', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', { title: 'X' });
    await call('motif_create', { scoreId, notation: 'c4/q', motifId: 'existe' });

    const error = await callExpectingError('motif_develop', {
      scoreId,
      motifId: 'no-existe',
      transformations: [{ op: 'retrograde' }],
    });
    expect(error.code).toBe('NOT_FOUND');
    expect(error.details?.['available']).toEqual(['existe']);
  });

  it('una transformacion sin su intervalo lo explica con ejemplos', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', { title: 'X' });
    await call('motif_create', { scoreId, notation: 'c4/q', motifId: 'tema' });

    const error = await callExpectingError('motif_develop', {
      scoreId,
      motifId: 'tema',
      transformations: [{ op: 'transpose' }],
    });
    expect(error.details?.['examples']).toContain('P5');
  });
});

describe('generacion de melodia', () => {
  it('genera y la escribe en una parte', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Melodia',
      key: 'C major',
      instruments: ['flute'],
    });

    const result = await call<{
      seed: string;
      notes: number;
      writtenTo: string;
      motifId: string;
    }>('melody_generate', {
      scoreId,
      partId: 'flute',
      measures: 4,
      progression: ['I', 'vi', 'ii', 'V7'],
      contour: 'arch',
      seed: 'melodia-test',
    });

    expect(result.writtenTo).toBe('flute');
    expect(result.notes).toBeGreaterThan(0);
    expect(result.seed).toBe('melodia-test');

    const described = await call<{ summary: { eventCount: number } }>('score_describe', { scoreId });
    expect(described.summary.eventCount).toBe(result.notes);
  });

  // La razon de ser de la semilla: poder repetir lo que gusto.
  it('la misma semilla da exactamente la misma melodia', async () => {
    const generate = async (): Promise<string> => {
      const { scoreId } = await call<{ scoreId: string }>('score_create', {
        title: 'Repetible',
        key: 'D minor',
      });
      const result = await call<{ notation: string }>('melody_generate', {
        scoreId,
        measures: 4,
        seed: 'identica',
      });
      return result.notation;
    };

    expect(await generate()).toBe(await generate());
  });

  it('toma el rango de la tesitura del instrumento', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Rango',
      instruments: ['contrabass'],
    });
    await call('melody_generate', { scoreId, partId: 'contrabass', measures: 4, seed: 'grave' });

    // Nada fuera de rango: el generador respeto la tesitura sin que se le diga.
    const check = await call<{ issueCount: number }>('check_ranges', { scoreId });
    expect(check.issueCount).toBe(0);
  });

  it('se queda en la escala pedida', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Pentatonica',
      key: 'C major',
    });
    const result = await call<{ notation: string }>('melody_generate', {
      scoreId,
      measures: 4,
      scaleType: 'majorPentatonic',
      seed: 'penta',
    });

    // La pentatonica mayor de Do no tiene ni Fa ni Si.
    expect(result.notation).not.toMatch(/\bF\d/);
    expect(result.notation).not.toMatch(/\bB\d/);
  });
});

describe('contrapunto', () => {
  it('escribe una voz contra otra sin paralelas', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Contrapunto',
      key: 'C major',
      instruments: ['cello', 'violin'],
    });
    await call('part_write', {
      scoreId,
      partId: 'cello',
      notation: 'c4/w | d4/w | e4/w | c4/w | f4/w | e4/w | d4/w | c4/w',
    });

    const result = await call<{
      writtenTo: string;
      notes: number;
      strict: boolean;
      relaxed: string[];
    }>('counterpoint_add', {
      scoreId,
      sourcePartId: 'cello',
      targetPartId: 'violin',
      seed: 'cp-mcp',
    });

    expect(result.writtenTo).toBe('violin');
    expect(result.notes).toBe(8);

    // Y lo generado pasa el mismo analizador que critica lo escrito a mano.
    const check = await call<{ byRule: Record<string, number> }>('check_voice_leading', {
      scoreId,
    });
    expect(check.byRule['quintas-paralelas']).toBeUndefined();
    expect(check.byRule['octavas-paralelas']).toBeUndefined();
  });

  it('avisa si tuvo que ceder reglas de estilo', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Estrecho',
      key: 'C major',
      instruments: ['cello', 'violin'],
    });
    await call('part_write', {
      scoreId,
      partId: 'cello',
      notation: 'c4/w | d4/w | e4/w | f4/w | g4/w',
    });

    const result = await call<{ strict: boolean; relaxed: string[]; notes: number }>(
      'counterpoint_add',
      {
        scoreId,
        sourcePartId: 'cello',
        targetPartId: 'violin',
        lowest: 'C5',
        highest: 'E5',
        seed: 'apretado',
      },
    );

    expect(result.notes).toBe(5);
    if (!result.strict) expect(result.relaxed.length).toBeGreaterThan(0);
  });

  it('rechaza contrapuntar una parte vacia', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Vacia',
      instruments: ['cello', 'violin'],
    });

    const error = await callExpectingError('counterpoint_add', {
      scoreId,
      sourcePartId: 'cello',
      targetPartId: 'violin',
    });
    expect(error.code).toBe('INVALID_REQUEST');
  });
});

describe('armonia', () => {
  it('realiza una progresion de numeros romanos', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Progresion',
      key: 'C major',
    });

    const result = await call<{
      key: string;
      chords: { roman: string; symbol: string; fn: string }[];
      cadence: { type: string } | null;
    }>('harmony_progression', { scoreId, progression: ['I', 'vi', 'ii', 'V7', 'I'] });

    expect(result.key).toBe('C major');
    expect(result.chords.map((c) => c.symbol)).toEqual(['C', 'Am', 'Dm', 'G7', 'C']);
    expect(result.chords[3]!.fn).toBe('dominante');
    expect(result.cadence?.type).toBe('autentica-perfecta');
  });

  it('toma la tonalidad de la partitura sin que haya que repetirla', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'En mi bemol',
      key: 'Eb major',
    });

    const result = await call<{ chords: { symbol: string }[] }>('harmony_progression', {
      scoreId,
      progression: ['I', 'V7'],
    });
    expect(result.chords.map((c) => c.symbol)).toEqual(['Eb', 'Bb7']);
  });

  it('en modo menor el V lleva la sensible', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'En la menor',
      key: 'A minor',
    });

    const result = await call<{ chords: { symbol: string; pitches: string[] }[] }>(
      'harmony_progression',
      { scoreId, progression: ['i', 'V', 'i'] },
    );
    expect(result.chords[1]!.symbol).toBe('E');
    expect(result.chords[1]!.pitches.some((p) => p.startsWith('G#'))).toBe(true);
  });

  it('escribe la progresion en una parte cuando se le pide', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Escrita',
      key: 'C major',
      instruments: ['piano'],
    });

    const result = await call<{ writtenTo: string }>('harmony_progression', {
      scoreId,
      progression: ['I', 'IV', 'V', 'I'],
      partId: 'piano',
    });
    expect(result.writtenTo).toBe('piano');

    const described = await call<{ summary: { eventCount: number } }>('score_describe', { scoreId });
    expect(described.summary.eventCount).toBe(4);
  });

  it('analiza la armonia de lo que hay escrito', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Analisis',
      key: 'C major',
      instruments: ['piano'],
    });
    await call('part_write', {
      scoreId,
      partId: 'piano',
      notation: '[c3,e3,g3]/w | [f3,a3,c4]/w | [g2,b2,d3,f3]/w | [c3,e3,g3]/w',
    });

    const result = await call<{
      chords: { measure: number; roman: string }[];
      cadences: { type: string }[];
      summary: { diatonic: number };
    }>('analyze_harmony', { scoreId });

    expect(result.chords.map((c) => c.roman)).toEqual(['I', 'IV', 'V7', 'I']);
    expect(result.summary.diatonic).toBe(4);
    expect(result.cadences.some((c) => c.type === 'autentica-perfecta')).toBe(true);
  });

  it('marca los acordes prestados como no diatonicos', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Prestado',
      key: 'C major',
      instruments: ['piano'],
    });
    await call('part_write', {
      scoreId,
      partId: 'piano',
      notation: '[c3,e3,g3]/w | [bb2,d3,f3]/w',
    });

    const result = await call<{
      chords: { roman: string; isDiatonic: boolean }[];
      summary: { borrowed: number };
    }>('analyze_harmony', { scoreId });

    expect(result.chords[1]!.roman).toBe('bVII');
    expect(result.chords[1]!.isDiatonic).toBe(false);
    expect(result.summary.borrowed).toBe(1);
  });

  // El bucle de autocritica: errores que el modelo no ve releyendo su salida.
  it('detecta quintas paralelas entre dos partes', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Paralelas',
      instruments: ['cello', 'violin'],
    });
    await call('part_write', { scoreId, partId: 'cello', notation: 'c3/q d3/q' });
    await call('part_write', { scoreId, partId: 'violin', notation: 'g3/q a3/q' });

    const result = await call<{
      errors: number;
      byRule: Record<string, number>;
      issues: { rule: string; measure: number; message: string }[];
    }>('check_voice_leading', { scoreId });

    expect(result.errors).toBeGreaterThan(0);
    expect(result.byRule['quintas-paralelas']).toBe(1);
    expect(result.issues[0]!.measure).toBe(1);
    expect(result.issues[0]!.message).toContain('C3-G3');
  });

  it('ordena las voces de grave a agudo aunque se anadan al reves', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Orden',
      instruments: ['violin', 'cello'],
    });
    await call('part_write', { scoreId, partId: 'violin', notation: 'g5/w' });
    await call('part_write', { scoreId, partId: 'cello', notation: 'c3/w' });

    const result = await call<{ voices: string[] }>('check_voice_leading', { scoreId });
    expect(result.voices).toEqual(['cello', 'violin']);
  });

  it('un pasaje bien escrito no da errores', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Limpio',
      instruments: ['cello', 'violin'],
    });
    await call('part_write', { scoreId, partId: 'cello', notation: 'c3/q d3/q' });
    await call('part_write', { scoreId, partId: 'violin', notation: 'e4/q d4/q' });

    const result = await call<{ errors: number }>('check_voice_leading', { scoreId });
    expect(result.errors).toBe(0);
  });

  it('pide al menos dos voces para poder analizar', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Una sola',
      instruments: ['violin'],
    });
    await call('part_write', { scoreId, partId: 'violin', notation: 'c4/w' });

    const error = await callExpectingError('check_voice_leading', { scoreId });
    expect(error.code).toBe('INVALID_REQUEST');
  });

  it('rechaza numeros romanos inventados explicando la sintaxis', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', { title: 'Malo' });
    const error = await callExpectingError('harmony_progression', {
      scoreId,
      progression: ['I', 'ZZ'],
    });
    expect(error.details?.['examples']).toBeTruthy();
  });
});

describe('gestion de sesiones', () => {
  it('lista y cierra partituras', async () => {
    const a = await call<{ scoreId: string }>('score_create', { title: 'Primera' });
    const b = await call<{ scoreId: string }>('score_create', { title: 'Segunda' });

    const listed = await call<{ scores: { scoreId: string }[] }>('score_list');
    expect(listed.scores.map((s) => s.scoreId).sort()).toEqual([a.scoreId, b.scoreId].sort());

    await call('score_close', { scoreId: a.scoreId });
    const after = await call<{ scores: { scoreId: string }[] }>('score_list');
    expect(after.scores.map((s) => s.scoreId)).toEqual([b.scoreId]);
  });

  it('el historial deja retomar el hilo', async () => {
    const { scoreId } = await call<{ scoreId: string }>('score_create', {
      title: 'Con historia',
      instruments: ['violin'],
    });
    await call('part_write', { scoreId, partId: 'violin', notation: 'c4/w' });

    const described = await call<{ history: string[] }>('score_describe', { scoreId });
    expect(described.history.length).toBeGreaterThanOrEqual(2);
    expect(described.history.join(' ')).toContain('violin');
  });
});
