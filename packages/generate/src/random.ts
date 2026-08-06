/**
 * Aleatoriedad reproducible.
 *
 * Todo lo que se genera sale de aqui, y nada usa `Math.random`. La razon es
 * practica: un agente compone por iteracion, y necesita poder decir "esa
 * melodia me gustaba, dame otra vez esa y cambiame solo el ritmo". Sin semilla
 * eso es imposible; cada llamada daria algo distinto y no habria forma de
 * volver atras.
 */

/**
 * Generador determinista.
 *
 * Se usa mulberry32: 32 bits de estado, calidad estadistica suficiente para
 * decisiones musicales y, sobre todo, resultados IDENTICOS en cualquier
 * maquina y version de Node. Un generador criptografico o el del motor de JS
 * no darian esa garantia, y sin ella la semilla no sirve de nada.
 */
export class Random {
  private state: number;
  readonly seed: string;

  constructor(seed: string | number = 'sinfo') {
    this.seed = String(seed);
    this.state = hashSeed(this.seed);
  }

  /** Numero en [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entero en [min, max], ambos incluidos. */
  int(min: number, max: number): number {
    if (max < min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** true con probabilidad `probability`. */
  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  /** Un elemento al azar. Lanza si la lista esta vacia. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('No se puede elegir de una lista vacia');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /**
   * Elige segun pesos. Los pesos no negativos no necesitan sumar 1.
   * Los de peso cero nunca salen, que es como se prohibe un candidato.
   */
  weighted<T>(items: readonly { value: T; weight: number }[]): T {
    const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
    if (total <= 0) throw new Error('Ningun candidato tiene peso positivo');

    let target = this.next() * total;
    for (const item of items) {
      target -= Math.max(0, item.weight);
      if (target < 0) return item.value;
    }
    return items[items.length - 1]!.value;
  }

  /** Copia barajada, sin tocar el original (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [result[i], result[j]] = [result[j]!, result[i]!];
    }
    return result;
  }

  /**
   * Sub-flujo independiente, derivado de esta semilla y una etiqueta.
   *
   * Es lo que evita el efecto domino: si melodia y ritmo compartieran flujo,
   * tocar el algoritmo de la melodia desplazaria todos los numeros siguientes
   * y el ritmo cambiaria tambien, aunque no se hubiera tocado. Con un flujo
   * por etiqueta, cada decision es estable frente a cambios en las demas.
   */
  fork(label: string): Random {
    return new Random(`${this.seed}::${label}`);
  }
}

/**
 * Semilla de 32 bits a partir de un texto (cyrb53 recortado).
 *
 * Interesa que semillas parecidas den estados MUY distintos: si "tema-1" y
 * "tema-2" arrancaran cerca, las dos melodias se pareceran, que es justo lo
 * contrario de lo que se busca al cambiar de semilla.
 */
function hashSeed(seed: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;

  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/** Semilla legible al azar, para cuando el agente no aporta ninguna. */
export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}
