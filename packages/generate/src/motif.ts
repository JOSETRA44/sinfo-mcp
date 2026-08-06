import {
  Duration,
  Interval,
  isRest,
  parseVoice,
  Pitch,
  serializeVoice,
  sumDurations,
  transposeEvent,
  type MusicalEvent,
} from '@sinfo/core';
import { Scale } from '@sinfo/theory';

/**
 * Motivo: la celula tematica de la que crece una obra.
 *
 * Un motivo no es "unas notas cualesquiera": es material que se va a
 * TRANSFORMAR. Por eso es un objeto con operaciones y no un array suelto. Las
 * cuatro sinfonias de Brahms y casi todo el repertorio clasico salen de aplicar
 * estas mismas transformaciones a celulas de tres o cuatro notas.
 *
 * Toda transformacion devuelve un motivo NUEVO. El original nunca cambia, asi
 * que el agente puede derivar cinco variantes del mismo tema sin que la tercera
 * dependa de lo que hizo la segunda.
 */
export class Motif {
  readonly events: readonly MusicalEvent[];
  /** Genealogia: de que motivo sale y por que transformacion. */
  readonly derivation: readonly string[];

  private constructor(events: readonly MusicalEvent[], derivation: readonly string[]) {
    this.events = Object.freeze([...events]);
    this.derivation = Object.freeze([...derivation]);
    Object.freeze(this);
  }

  static of(events: readonly MusicalEvent[], derivation: readonly string[] = []): Motif {
    return new Motif(events, derivation);
  }

  /** Construye desde SinfoScript: `Motif.parse('c4/q e4/q g4/h')`. */
  static parse(notation: string): Motif {
    return new Motif(parseVoice(notation).events, ['origen']);
  }

  // ------------------------------------------------------------ propiedades

  get length(): number {
    return this.events.length;
  }

  get duration(): Duration {
    return sumDurations(this.events.map((event) => event.duration));
  }

  /** Alturas que suenan, sin silencios ni repartir acordes. */
  get pitches(): Pitch[] {
    return this.events.flatMap((event) => [...event.pitches]);
  }

  /** Ambito del motivo en semitonos, o 0 si no tiene alturas. */
  get range(): number {
    const midis = this.pitches.map((pitch) => pitch.midi);
    return midis.length === 0 ? 0 : Math.max(...midis) - Math.min(...midis);
  }

  get notation(): string {
    return serializeVoice(this.events);
  }

  // --------------------------------------------------------- transformaciones

  /** Traslada el motivo conservando su escritura. */
  transposed(interval: Interval): Motif {
    return new Motif(
      this.events.map((event) => transposeEvent(event, interval)),
      [...this.derivation, `transposicion ${interval.name}`],
    );
  }

  /**
   * Inversion CROMATICA: da la vuelta a cada intervalo exactamente.
   *
   * Una tercera mayor arriba se convierte en tercera mayor abajo. Conserva el
   * perfil interválico intacto, a costa de salirse de la tonalidad.
   */
  inverted(axis?: Pitch): Motif {
    const pivot = axis ?? this.firstPitch();
    if (!pivot) return this;

    return new Motif(
      this.events.map((event) =>
        isRest(event)
          ? event
          : {
              ...event,
              pitches: Object.freeze(
                event.pitches.map((pitch) => pivot.transpose(pitch.intervalTo(pivot))),
              ),
            },
      ),
      [...this.derivation, `inversion cromatica sobre ${pivot.name}`],
    );
  }

  /**
   * Inversion TONAL: da la vuelta contando GRADOS de la escala, no semitonos.
   *
   * Es la que se usa casi siempre en musica tonal, porque el resultado sigue
   * perteneciendo a la tonalidad. La cromatica conserva los intervalos exactos
   * pero suele sacar la melodia de la escala, y entonces el motivo invertido
   * suena ajeno en vez de emparentado.
   */
  invertedInScale(scale: Scale, axis?: Pitch): Motif {
    const pivot = axis ?? this.firstPitch();
    if (!pivot) return this;

    const pivotDegree = degreeIndexIn(scale, pivot);
    if (pivotDegree === null) return this.inverted(pivot);

    return new Motif(
      this.events.map((event) =>
        isRest(event)
          ? event
          : {
              ...event,
              pitches: Object.freeze(
                event.pitches.map((pitch) => {
                  const degree = degreeIndexIn(scale, pitch);
                  if (degree === null) return pivot.transpose(pitch.intervalTo(pivot));
                  return pitchAtDegreeIndex(scale, 2 * pivotDegree - degree);
                }),
              ),
            },
      ),
      [...this.derivation, `inversion tonal sobre ${pivot.name}`],
    );
  }

  /** Del final al principio. Las duraciones acompañan a su nota. */
  retrograded(): Motif {
    return new Motif([...this.events].reverse(), [...this.derivation, 'retrogradacion']);
  }

  /** Alarga todas las duraciones por el mismo factor. */
  augmented(factor = 2): Motif {
    return this.scaled(factor, 1, `aumentacion x${factor}`);
  }

  /** Acorta todas las duraciones por el mismo factor. */
  diminished(factor = 2): Motif {
    return this.scaled(1, factor, `disminucion /${factor}`);
  }

  private scaled(numerator: number, denominator: number, label: string): Motif {
    return new Motif(
      this.events.map((event) => ({
        ...event,
        duration: event.duration.times(numerator, denominator),
      })),
      [...this.derivation, label],
    );
  }

  /**
   * Secuencia: repite el motivo desplazado, `steps` veces.
   *
   * Con una escala, el desplazamiento es por GRADOS y la secuencia se queda en
   * la tonalidad, que es como se hace en la practica. Sin escala, se desplaza
   * por el intervalo exacto.
   */
  sequence(steps: number, interval: Interval, scale?: Scale): Motif {
    const events: MusicalEvent[] = [...this.events];
    let current: Motif = this;

    for (let step = 0; step < steps; step++) {
      current = scale
        ? current.transposedInScale(scale, interval.diatonic)
        : current.transposed(interval);
      events.push(...current.events);
    }

    return new Motif(events, [
      ...this.derivation,
      `secuencia de ${steps} pasos por ${interval.name}`,
    ]);
  }

  /** Traslada por grados de la escala, sin salirse de ella. */
  transposedInScale(scale: Scale, degrees: number): Motif {
    return new Motif(
      this.events.map((event) =>
        isRest(event)
          ? event
          : {
              ...event,
              pitches: Object.freeze(
                event.pitches.map((pitch) => {
                  const degree = degreeIndexIn(scale, pitch);
                  return degree === null ? pitch : pitchAtDegreeIndex(scale, degree + degrees);
                }),
              ),
            },
      ),
      [...this.derivation, `secuencia diatonica ${degrees > 0 ? '+' : ''}${degrees} grados`],
    );
  }

  /**
   * Fragmentacion: se queda con un trozo.
   *
   * Es la transformacion que sostiene los desarrollos: se toma la cabeza del
   * tema y se repite hasta agotarla, en vez de exponer el tema entero cada vez.
   */
  fragment(from: number, count: number): Motif {
    const start = Math.max(0, Math.min(from, this.events.length));
    const slice = this.events.slice(start, start + Math.max(0, count));
    return new Motif(slice, [...this.derivation, `fragmento ${start}..${start + slice.length - 1}`]);
  }

  /** Encadena otro motivo detras. */
  concat(other: Motif): Motif {
    return new Motif([...this.events, ...other.events], [...this.derivation, 'concatenacion']);
  }

  /** Repite el motivo tal cual. */
  repeated(times: number): Motif {
    const events: MusicalEvent[] = [];
    for (let time = 0; time < Math.max(1, times); time++) events.push(...this.events);
    return new Motif(events, [...this.derivation, `repeticion x${times}`]);
  }

  toJSON(): { notation: string; length: number; duration: string; derivation: readonly string[] } {
    return {
      notation: this.notation,
      length: this.length,
      duration: this.duration.toString(),
      derivation: this.derivation,
    };
  }

  private firstPitch(): Pitch | null {
    for (const event of this.events) {
      if (event.pitches.length > 0) return event.pitches[0]!;
    }
    return null;
  }
}

/**
 * Posicion absoluta de una altura en la escala, contando octavas.
 * Devuelve null si la nota no pertenece a la escala.
 */
function degreeIndexIn(scale: Scale, pitch: Pitch): number | null {
  const degree = scale.degreeOf(pitch);
  if (degree === null) return null;

  const reference = scale.pitches[degree - 1]!;
  const octaveOffset = Math.round((pitch.midi - reference.midi) / 12);
  return degree - 1 + octaveOffset * scale.size;
}

/** Inversa de `degreeIndexIn`: la altura que ocupa esa posicion. */
function pitchAtDegreeIndex(scale: Scale, index: number): Pitch {
  const size = scale.size;
  const octave = Math.floor(index / size);
  const degree = ((index % size) + size) % size;
  const pitch = scale.pitches[degree]!;
  return pitch.withOctave(pitch.octave + octave);
}
