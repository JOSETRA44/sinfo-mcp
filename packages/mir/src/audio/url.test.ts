import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StageCache } from '../sidecar/cache.js';
import { SidecarClient } from '../sidecar/client.js';
import { fetchAudio, looksLikeUrl, urlIngestEnabled } from './url.js';

/**
 * La ingesta desde URL esta apagada por defecto, y eso es una decision de
 * producto que conviene fijar por escrito.
 *
 * Descargar de YouTube incumple sus condiciones de servicio. Que la puerta
 * este cerrada mientras nadie la abra a proposito no es un detalle de
 * configuracion: es lo que separa una herramienta que el usuario decide usar
 * asi de una que lo hace por su cuenta. Un cambio que la abriera sin querer
 * tiene que romper una prueba.
 */

const original = process.env['SINFO_ALLOW_URL'];

beforeEach(() => {
  delete process.env['SINFO_ALLOW_URL'];
});

afterEach(() => {
  if (original === undefined) delete process.env['SINFO_ALLOW_URL'];
  else process.env['SINFO_ALLOW_URL'] = original;
});

describe('looksLikeUrl', () => {
  it('reconoce direcciones web', () => {
    expect(looksLikeUrl('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(looksLikeUrl('http://ejemplo.com/audio.mp3')).toBe(true);
  });

  it('no confunde una ruta de disco con una URL', () => {
    expect(looksLikeUrl('C:\\musica\\cancion.wav')).toBe(false);
    expect(looksLikeUrl('/home/usuario/cancion.mp3')).toBe(false);
    // Ni siquiera algo que empieza parecido: importa el esquema, no el texto.
    expect(looksLikeUrl('httpsalgo.wav')).toBe(false);
  });
});

describe('urlIngestEnabled', () => {
  it('esta apagada si nadie dice nada', () => {
    expect(urlIngestEnabled()).toBe(false);
  });

  it('se enciende solo con un valor afirmativo explicito', () => {
    process.env['SINFO_ALLOW_URL'] = '1';
    expect(urlIngestEnabled()).toBe(true);
    process.env['SINFO_ALLOW_URL'] = 'true';
    expect(urlIngestEnabled()).toBe(true);
  });

  it('no se enciende con cualquier cosa', () => {
    // Que la variable EXISTA no basta: alguien que la ponga a 0 esta diciendo
    // que no, y leerlo como que si seria justo lo contrario de lo que pidio.
    for (const value of ['0', 'false', 'no', '']) {
      process.env['SINFO_ALLOW_URL'] = value;
      expect(urlIngestEnabled()).toBe(false);
    }
  });
});

describe('fetchAudio', () => {
  const client = new SidecarClient({ command: 'sinfo-mir-ausente-a-proposito' });
  const cache = new StageCache({ root: 'no-se-usa' });

  it('se niega mientras la puerta este cerrada, sin tocar la red', async () => {
    await expect(fetchAudio('https://youtube.com/watch?v=x', client, cache)).rejects.toThrow(
      /SINFO_ALLOW_URL/,
    );
  });

  it('el mensaje explica por que esta apagada, no solo que lo esta', async () => {
    // Un "desactivado" a secas invita a activarlo sin pensar. Lo util es que
    // quien lo lea sepa que esta decidiendo.
    await expect(fetchAudio('https://youtube.com/watch?v=x', client, cache)).rejects.toThrow(
      /condiciones de servicio/,
    );
  });

  it('con la puerta abierta pero sin sidecar, dice que falta el sidecar', async () => {
    process.env['SINFO_ALLOW_URL'] = '1';
    await expect(fetchAudio('https://youtube.com/watch?v=x', client, cache)).rejects.toThrow(
      /yt-dlp/,
    );
  });
});
