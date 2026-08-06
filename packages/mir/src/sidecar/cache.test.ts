import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StageCache } from './cache.js';

let workspace: string;
let cache: StageCache;

const file = async (name: string, content: string): Promise<string> => {
  const path = join(workspace, name);
  await writeFile(path, content, 'utf8');
  return path;
};

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'sinfo-cache-'));
  cache = new StageCache({ root: join(workspace, 'cache') });
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('StageCache: la clave sale del contenido', () => {
  it('el mismo contenido da la misma clave aunque cambie el nombre', async () => {
    // Copiar o renombrar un archivo no debe obligar a repetir minutos de
    // separacion.
    const first = await file('cancion.wav', 'los mismos octetos');
    const second = await file('copia.wav', 'los mismos octetos');

    expect(await cache.keyFor(first, 'separate')).toBe(await cache.keyFor(second, 'separate'));
  });

  it('editar el archivo invalida lo cacheado aunque conserve el nombre', async () => {
    const path = await file('cancion.wav', 'version uno');
    const before = await cache.keyFor(path, 'separate');

    await writeFile(path, 'version dos', 'utf8');
    expect(await cache.keyFor(path, 'separate')).not.toBe(before);
  });

  it('cada etapa tiene su propia clave sobre el mismo archivo', async () => {
    const path = await file('cancion.wav', 'audio');
    expect(await cache.keyFor(path, 'separate')).not.toBe(await cache.keyFor(path, 'beats'));
  });

  it('los parametros entran en la clave', async () => {
    // Separar con htdemucs y con htdemucs_ft da resultados distintos; sin esto
    // el segundo modelo devolveria lo que dejo el primero.
    const path = await file('cancion.wav', 'audio');
    const a = await cache.keyFor(path, 'separate', { model: 'htdemucs' });
    const b = await cache.keyFor(path, 'separate', { model: 'htdemucs_ft' });
    expect(a).not.toBe(b);
  });

  it('el orden de los parametros no cambia la clave', async () => {
    // JSON.stringify conserva el orden de insercion, asi que sin ordenar las
    // claves la cache fallaria justo cuando deberia acertar.
    const path = await file('cancion.wav', 'audio');
    const a = await cache.keyFor(path, 'notes', { model: 'x', instrument: 'piano' });
    const b = await cache.keyFor(path, 'notes', { instrument: 'piano', model: 'x' });
    expect(a).toBe(b);
  });
});

describe('StageCache: lectura y escritura', () => {
  it('devuelve null cuando no hay nada guardado', async () => {
    expect(await cache.read('inexistente')).toBeNull();
  });

  it('guarda y recupera un resultado', async () => {
    await cache.write('a/b', { beats: [1, 2, 3] });
    expect(await cache.read('a/b')).toEqual({ beats: [1, 2, 3] });
  });

  it('through calcula una vez y reutiliza despues', async () => {
    let calls = 0;
    const compute = async () => {
      calls += 1;
      return { value: calls };
    };

    expect(await cache.through('k', compute)).toEqual({ value: 1 });
    expect(await cache.through('k', compute)).toEqual({ value: 1 });
    expect(calls).toBe(1);
  });

  it('NO cachea un fallo', async () => {
    // Guardar un error lo volveria permanente hasta vaciar la cache a mano.
    await expect(
      cache.through('k', () => Promise.reject(new Error('el modelo se cayo'))),
    ).rejects.toThrow('el modelo se cayo');

    expect(await cache.read('k')).toBeNull();
    expect(await cache.through('k', async () => ({ ok: true }))).toEqual({ ok: true });
  });

  it('un archivo de cache corrupto se recalcula en vez de reventar', async () => {
    await cache.write('k', { ok: true });
    await writeFile(join(cache.directory, 'k.json'), '{esto no es json', 'utf8');

    expect(await cache.read('k')).toBeNull();
    expect(await cache.through('k', async () => ({ recalculado: true }))).toEqual({
      recalculado: true,
    });
  });

  it('informa de cuanto ocupa', async () => {
    await cache.write('uno', { a: 1 });
    await cache.write('dos', { b: 2 });

    const stats = await cache.stats();
    expect(stats.entries).toBe(2);
    expect(stats.bytes).toBeGreaterThan(0);
  });

  it('vaciar la cache la deja a cero', async () => {
    await cache.write('uno', { a: 1 });
    await cache.clear();
    expect((await cache.stats()).entries).toBe(0);
  });
});
