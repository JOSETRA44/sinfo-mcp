/**
 * Quita comentarios de una linea de notacion.
 *
 * El signo `#` tiene dos usos que chocan: marca comentario y marca sostenido.
 * `C#4/s` no puede truncarse a `C`, y `Do sostenido` es de las notas mas
 * frecuentes que existen, asi que cambiar el simbolo de sostenido no era
 * opcion.
 *
 * La regla que los separa: solo abre comentario un `#` que este al principio
 * de la linea o precedido de un espacio. Dentro de un token, como en `C#4`,
 * es una alteracion. Las dos notaciones conviven sin ambiguedad y sin que el
 * modelo tenga que aprender ninguna excepcion rara.
 */
export function stripComment(line: string): string {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '#') continue;
    const previous = i === 0 ? undefined : line[i - 1];
    if (previous === undefined || /\s/.test(previous)) return line.slice(0, i);
  }
  return line;
}

/** Aplica `stripComment` a cada linea del texto. */
export function stripComments(source: string): string[] {
  return source.split('\n').map(stripComment);
}
