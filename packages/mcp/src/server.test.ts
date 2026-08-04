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
    expect(error.details?.['availableNow']).toEqual(['midi', 'json']);
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
