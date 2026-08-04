/**
 * Constructor de XML minimo.
 *
 * No se usa una libreria porque MusicXML se genera, no se manipula: hace falta
 * escapar texto y anidar elementos, y nada mas. Una dependencia entera para
 * eso solo anade superficie de fallo.
 */

export type XmlAttributes = Readonly<Record<string, string | number | undefined>>;

export class XmlWriter {
  private readonly lines: string[] = [];
  private depth = 0;

  /** Elemento con hijos: abre, ejecuta el cuerpo y cierra. */
  element(name: string, attributes: XmlAttributes, body: () => void): this;
  element(name: string, body: () => void): this;
  element(
    name: string,
    attributesOrBody: XmlAttributes | (() => void),
    maybeBody?: () => void,
  ): this {
    const isBodyFirst = typeof attributesOrBody === 'function';
    const attributes = isBodyFirst ? {} : attributesOrBody;
    const body = isBodyFirst ? attributesOrBody : maybeBody;

    this.lines.push(`${this.indent}<${name}${formatAttributes(attributes)}>`);
    this.depth++;
    body?.();
    this.depth--;
    this.lines.push(`${this.indent}</${name}>`);
    return this;
  }

  /** Elemento con texto: `<step>C</step>`. */
  text(name: string, value: string | number, attributes: XmlAttributes = {}): this {
    this.lines.push(
      `${this.indent}<${name}${formatAttributes(attributes)}>${escapeText(String(value))}</${name}>`,
    );
    return this;
  }

  /** Elemento vacio: `<chord/>`, `<dot/>`. */
  empty(name: string, attributes: XmlAttributes = {}): this {
    this.lines.push(`${this.indent}<${name}${formatAttributes(attributes)}/>`);
    return this;
  }

  /** Linea cruda, para la declaracion XML y el DOCTYPE. */
  raw(line: string): this {
    this.lines.push(line);
    return this;
  }

  toString(): string {
    return `${this.lines.join('\n')}\n`;
  }

  private get indent(): string {
    return '  '.repeat(this.depth);
  }
}

function formatAttributes(attributes: XmlAttributes): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    parts.push(` ${name}="${escapeAttribute(String(value))}"`);
  }
  return parts.join('');
}

/**
 * El titulo y el nombre del compositor los escribe el agente, asi que pueden
 * traer `&` o `<`. Sin escapar, un titulo como "Preludio & Fuga" produce un
 * archivo que ningun editor abre.
 */
function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}
