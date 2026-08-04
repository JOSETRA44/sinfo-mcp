import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { ArtifactSink, RenderedArtifact, SavedArtifact } from '@sinfo/engine';

/**
 * Guarda los archivos generados en una carpeta local.
 *
 * Por que a disco y no devolver los bytes por el protocolo: un MIDI ya son
 * kilobytes y un WAV son megabytes, y meterlos en base64 dentro de la
 * respuesta llena el contexto del modelo sin aportarle nada, porque no puede
 * interpretar esos bytes. Lo util es la RUTA, que el agente le puede pasar al
 * usuario o abrir con otra herramienta.
 */
export class FileArtifactSink implements ArtifactSink {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    const configured = baseDir ?? process.env['SINFO_OUT_DIR'] ?? 'sinfo-out';
    this.baseDir = isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
  }

  async save(artifact: RenderedArtifact, scoreId: string): Promise<SavedArtifact> {
    const directory = join(this.baseDir, sanitize(scoreId));
    await mkdir(directory, { recursive: true });

    const path = join(directory, sanitize(artifact.filename));
    await writeFile(path, artifact.data);

    return { path, bytes: artifact.data.length };
  }

  get directory(): string {
    return this.baseDir;
  }
}

/**
 * Recorta el nombre a caracteres seguros.
 *
 * El titulo de la obra lo escribe el agente y acaba siendo un nombre de
 * archivo: sin limpiarlo, un titulo con "../" escribiria fuera de la carpeta
 * de salida.
 */
function sanitize(name: string): string {
  const cleaned = name.replace(/[^\w.\-]+/g, '-').replace(/^[.\-]+/, '');
  return cleaned === '' ? 'archivo' : cleaned.slice(0, 120);
}

/** Sumidero que no toca el disco. Para tests y para inspeccionar sin ensuciar. */
export class MemoryArtifactSink implements ArtifactSink {
  readonly saved: { scoreId: string; artifact: RenderedArtifact }[] = [];

  async save(artifact: RenderedArtifact, scoreId: string): Promise<SavedArtifact> {
    this.saved.push({ scoreId, artifact });
    return { path: `memory://${scoreId}/${artifact.filename}`, bytes: artifact.data.length };
  }
}
