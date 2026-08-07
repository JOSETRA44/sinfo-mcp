import { existsSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ApplicationError } from '@sinfo/engine';
import type { StageCache } from '../sidecar/cache.js';
import type { SidecarClient } from '../sidecar/client.js';

/**
 * Ingesta de audio desde una URL.
 *
 * Deliberadamente APAGADA por defecto, y no por timidez tecnica. Descargar de
 * YouTube incumple sus condiciones de servicio, asi que activarlo tiene que
 * ser una decision consciente de quien monta el servidor y no algo que ocurra
 * porque un agente encontro la herramienta y le parecio util.
 *
 * Se activa con `SINFO_ALLOW_URL=1`.
 */

/** Variable que abre la puerta. Cualquier otro valor la deja cerrada. */
const ENABLE_FLAG = 'SINFO_ALLOW_URL';

export function urlIngestEnabled(): boolean {
  const value = process.env[ENABLE_FLAG];
  return value === '1' || value?.toLowerCase() === 'true';
}

/** Si el texto parece una direccion web y no una ruta de disco. */
export function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export interface FetchedAudio {
  readonly path: string;
  readonly title?: string | undefined;
  readonly uploader?: string | undefined;
  readonly duration?: number | undefined;
}

/**
 * Descarga el audio de una URL, cacheado por la propia direccion.
 *
 * La clave sale de la URL y no del contenido porque aqui todavia no hay
 * contenido que medir. Es la unica etapa de toda la cadena que no puede
 * indexarse por contenido, y por eso tambien la unica en la que un video
 * reeditado bajo la misma direccion devolveria lo antiguo.
 */
export async function fetchAudio(
  url: string,
  sidecar: SidecarClient,
  cache: StageCache,
): Promise<FetchedAudio> {
  if (!urlIngestEnabled()) {
    throw new ApplicationError(
      'FORMAT_UNAVAILABLE',
      'La ingesta desde URL esta desactivada. Se activa poniendo la variable de entorno ' +
        `${ENABLE_FLAG}=1.\n\n` +
        'Conviene saber por que esta apagada: descargar de YouTube incumple sus condiciones de ' +
        'servicio. Transcribir una obra para estudiarla es normal y legitimo; publicar la ' +
        'transcripcion de una obra protegida es otra cosa. La decision es de quien usa la ' +
        'herramienta, no de la herramienta.',
      { url, flag: ENABLE_FLAG },
    );
  }

  const stages = await sidecar.availableStages();
  if (!stages.includes('fetch')) {
    throw new ApplicationError(
      'FORMAT_UNAVAILABLE',
      "Falta la capacidad de descarga en el sidecar. Instalala con `uv pip install yt-dlp` " +
        'en el entorno del sidecar.',
      { url },
    );
  }

  const key = `url/${hashUrl(url)}`;
  const directory = await cache.directoryFor(key);

  const cached = await cache.read<FetchedAudio>(key);
  if (cached !== null && existsSync(cached.path)) return cached;

  const result = (await sidecar.invoke(['fetch', '--url', url, '--out', directory])) as {
    out?: string;
    title?: string;
    uploader?: string;
    duration?: number;
  };

  const path = result.out ?? findDownloaded(directory);
  if (path === undefined) {
    throw new ApplicationError('INVALID_REQUEST', `La descarga de "${url}" no dejo ningun archivo.`, {
      url,
    });
  }

  const fetched: FetchedAudio = {
    path,
    ...(result.title === undefined ? {} : { title: result.title }),
    ...(result.uploader === undefined ? {} : { uploader: result.uploader }),
    ...(result.duration === undefined ? {} : { duration: result.duration }),
  };
  await cache.write(key, fetched);
  return fetched;
}

// --------------------------------------------------------------- interiores

/** Hash corto y estable de la URL, para que sirva de nombre de carpeta. */
function hashUrl(url: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < url.length; i += 1) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function findDownloaded(directory: string): string | undefined {
  try {
    const file = readdirSync(directory).find((name) => name.startsWith('source.'));
    return file === undefined ? undefined : join(directory, file);
  } catch {
    return undefined;
  }
}
