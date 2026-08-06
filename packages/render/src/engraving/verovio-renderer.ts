import type { Score } from '@sinfo/core';
import type {
  ExportFormat,
  RenderedArtifact,
  ScoreRenderer,
  ScoreRenderOptions,
} from '@sinfo/engine';
import { MusicXmlRenderer } from '../musicxml/musicxml-renderer.js';

/**
 * Grabado de partitura a SVG con Verovio.
 *
 * Verovio esta escrito en C++ y aqui se usa su compilacion a WebAssembly: se
 * obtiene un grabador de partituras de calidad profesional sin ninguna
 * dependencia nativa, que en Windows habria sido el punto de fallo.
 *
 * A diferencia del audio, esto SI sirve al agente y no solo al usuario: un
 * modelo multimodal puede mirar el SVG y comprobar como quedo la partitura.
 * Es la unica forma de verificar cosas que no se ven en los datos, como si un
 * pasaje quedo ilegible de tan denso.
 *
 * Se apoya en el exportador de MusicXML en vez de generar MEI: la conversion
 * ya esta escrita y probada, y mantener dos caminos hacia la notacion seria
 * duplicar el trabajo delicado de partir compases y ligaduras.
 */
export class VerovioRenderer implements ScoreRenderer {
  readonly formats: readonly ExportFormat[] = ['svg', 'musicxml'];

  private readonly musicxml = new MusicXmlRenderer();
  /** El modulo WASM tarda en arrancar; se carga una vez y se reutiliza. */
  private toolkit: Promise<VerovioToolkitLike> | null = null;

  async render(score: Score, options: ScoreRenderOptions = {}): Promise<RenderedArtifact> {
    const source = await this.musicxml.render(score, options);
    if ((options.format ?? 'svg') === 'musicxml') return source;

    const toolkit = await this.load();
    toolkit.setOptions({
      scale: 40,
      pageWidth: 2100,
      adjustPageHeight: true,
      footer: 'none',
      header: 'auto',
      spacingStaff: 8,
      spacingSystem: 12,
    });

    const xml = new TextDecoder().decode(source.data);
    if (!toolkit.loadData(xml)) {
      throw new Error('Verovio no pudo interpretar el MusicXML generado');
    }

    const pages = toolkit.getPageCount();
    // Se emiten todas las paginas en un solo SVG apilado: una partitura
    // troceada en archivos sueltos no se puede mirar de una vez, que es
    // justamente para lo que sirve esta salida.
    const svg = pages === 1 ? toolkit.renderToSVG(1) : stackPages(toolkit, pages);

    return {
      format: 'svg',
      data: new TextEncoder().encode(svg),
      mimeType: 'image/svg+xml',
      filename: source.filename.replace(/\.musicxml$/, '.svg'),
      meta: { ...source.meta, pages, bytes: svg.length },
    };
  }

  private async load(): Promise<VerovioToolkitLike> {
    this.toolkit ??= (async () => {
      const [{ default: createModule }, { VerovioToolkit }] = await Promise.all([
        import('verovio/wasm'),
        import('verovio/esm'),
      ]);
      return new VerovioToolkit(await createModule()) as VerovioToolkitLike;
    })();
    return this.toolkit;
  }
}

/**
 * Apila las paginas en un SVG unico.
 *
 * Cada pagina viene con su propio elemento raiz; se envuelven en uno comun y
 * se desplazan verticalmente para que se lean en orden.
 */
function stackPages(toolkit: VerovioToolkitLike, pages: number): string {
  const rendered: { svg: string; width: number; height: number }[] = [];

  for (let page = 1; page <= pages; page++) {
    const svg = toolkit.renderToSVG(page);
    rendered.push({
      svg,
      width: dimensionOf(svg, 'width'),
      height: dimensionOf(svg, 'height'),
    });
  }

  const width = Math.max(...rendered.map((page) => page.width));
  const height = rendered.reduce((total, page) => total + page.height, 0);

  let offset = 0;
  const body = rendered
    .map((page) => {
      const group = `<g transform="translate(0,${offset})">${stripRoot(page.svg)}</g>`;
      offset += page.height;
      return group;
    })
    .join('\n');

  return (
    `<svg width="${width}px" height="${height}px" viewBox="0 0 ${width} ${height}" ` +
    `version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">\n` +
    `${body}\n</svg>\n`
  );
}

function dimensionOf(svg: string, attribute: 'width' | 'height'): number {
  const match = new RegExp(`${attribute}="(\\d+(?:\\.\\d+)?)`).exec(svg);
  return match ? Number(match[1]) : 0;
}

/** Quita el `<svg>` exterior dejando solo su contenido. */
function stripRoot(svg: string): string {
  const open = svg.indexOf('>', svg.indexOf('<svg'));
  const close = svg.lastIndexOf('</svg>');
  return open < 0 || close < 0 ? svg : svg.slice(open + 1, close);
}

/**
 * Lo que se usa del toolkit de Verovio.
 *
 * Se declara a mano en vez de depender de sus tipos: el paquete los publica de
 * forma irregular entre versiones, y esta superficie minima es estable.
 */
interface VerovioToolkitLike {
  setOptions(options: Record<string, unknown>): void;
  loadData(data: string): boolean;
  getPageCount(): number;
  renderToSVG(page: number): string;
}
