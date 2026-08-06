/**
 * Declaraciones para los subpaths ESM de Verovio.
 *
 * El paquete publica los tipos de forma irregular entre versiones y no cubre
 * `verovio/wasm` ni `verovio/esm`. Se declara aqui la superficie minima que se
 * usa: es estable, y asi el compilador sigue vigilando las llamadas en vez de
 * dejarlas en `any`.
 */

declare module 'verovio/wasm' {
  const createVerovioModule: () => Promise<unknown>;
  export default createVerovioModule;
}

declare module 'verovio/esm' {
  export class VerovioToolkit {
    constructor(module: unknown);
    setOptions(options: Record<string, unknown>): void;
    loadData(data: string): boolean;
    getPageCount(): number;
    renderToSVG(page: number): string;
    getVersion(): string;
  }
}
