import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SidecarClient, SidecarError } from './client.js';

/**
 * Pruebas contra el sidecar de Python DE VERDAD, no contra un simulacro.
 *
 * Un doble de prueba aqui no valdria de nada: lo que puede salir mal es
 * justamente el paso de la frontera —como se lanza el proceso en Windows, que
 * pasa con la salida cuando el codigo de retorno no es cero, si el JSON llega
 * entero—, y todo eso lo simula un doble a su gusto.
 *
 * El paquete base no tiene dependencias, asi que `describe` funciona sin
 * instalar nada. Si algun dia no hubiera Python, estas pruebas se saltan solas
 * en vez de dar un fallo enganoso.
 */

const SIDECAR_SRC = join(process.cwd(), 'sidecar', 'src');

const local = (): SidecarClient =>
  new SidecarClient({
    command: 'python',
    prefixArgs: ['-m', 'sinfo_mir.cli'],
    env: { PYTHONPATH: SIDECAR_SRC },
  });

const hasPython = await local()
  .describe()
  .then((info) => info !== null)
  .catch(() => false);

describe.skipIf(!hasPython)('SidecarClient contra el sidecar real', () => {
  it('describe informa de version y capacidades', async () => {
    const info = await local().describe();
    expect(info?.name).toBe('sinfo-mir');
    expect(info?.capabilities.map((entry) => entry.name)).toEqual([
      'beats',
      'separate',
      'notes',
    ]);
  });

  it('cada capacidad que falta trae la orden para instalarla', async () => {
    // Es lo que convierte "no puedo" en algo accionable para el usuario.
    const info = await local().describe();
    for (const capability of info?.capabilities ?? []) {
      if (!capability.available) {
        expect(capability.install).toMatch(/uv pip install/);
        expect(capability.reason).toBeTruthy();
      }
    }
  });

  it('una etapa sin dependencias falla con codigo estable, no con un batacazo', async () => {
    const stages = await local().availableStages();
    if (stages.includes('beats')) return;

    // El sidecar sale con codigo 2 PERO escribe su JSON en stdout. Que el
    // cliente lo lea de ahi es justo lo que separa un error util de un
    // "exit 2" sin explicacion.
    await expect(local().invoke(['beats', '--input', 'nada.wav'])).rejects.toMatchObject({
      code: 'CAPABILITY_MISSING',
    });
  });

  it('un archivo que no existe se distingue de una capacidad que falta', async () => {
    const stages = await local().availableStages();
    if (!stages.includes('beats')) return;
    await expect(local().invoke(['beats', '--input', 'nada.wav'])).rejects.toMatchObject({
      code: 'INPUT_NOT_FOUND',
    });
  });
});

describe('SidecarClient cuando no hay sidecar', () => {
  const absent = () => new SidecarClient({ command: 'sinfo-mir-que-no-existe-jamas' });

  it('describe devuelve null en vez de lanzar', async () => {
    // No tenerlo instalado es un estado NORMAL: quien solo compone o importa
    // MIDI no necesita Python para nada.
    expect(await absent().describe()).toBeNull();
  });

  it('no declara ninguna capacidad', async () => {
    expect(await absent().availableStages()).toEqual([]);
  });

  it('al invocarlo explica como instalarlo', async () => {
    await expect(absent().invoke(['beats', '--input', 'x.wav'])).rejects.toThrow(
      /uv tool install/,
    );
  });

  it('el error lleva codigo estable', async () => {
    await expect(absent().invoke(['describe'])).rejects.toBeInstanceOf(SidecarError);
    await expect(absent().invoke(['describe'])).rejects.toMatchObject({
      code: 'SIDECAR_MISSING',
    });
  });
});
