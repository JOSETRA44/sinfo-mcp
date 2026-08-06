import type { Score } from '@sinfo/core';
import type { Performance } from '@sinfo/perform';

/**
 * Puertos de entrada y de salida.
 *
 * Los define la capa de aplicacion y los implementan @sinfo/render (salida) y
 * @sinfo/mir (entrada). La flecha de dependencia va de los adaptadores hacia
 * engine, nunca al reves: el motor no sabe que existe midi-file, ni verovio,
 * ni ningun sintetizador. Cambiar de libreria es cambiar un adaptador, no
 * tocar la logica.
 */

export type ExportFormat =
  | 'midi'
  | 'musicxml'
  | 'abc'
  | 'lilypond'
  | 'wav'
  | 'mp3'
  | 'svg'
  | 'json';

export interface RenderedArtifact {
  readonly format: ExportFormat;
  /** Binario para midi/wav/mp3; texto codificado en UTF-8 para el resto. */
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly filename: string;
  /** Datos sueltos que el adaptador quiera reportar (duracion, compases...). */
  readonly meta?: Readonly<Record<string, unknown>>;
}

/**
 * Interpretacion: groove y humanizacion.
 *
 * Van en las opciones de RENDER y no en la partitura porque son decisiones de
 * interpretacion, no de notacion: un pasaje con swing se escribe con corcheas
 * rectas. Las comparten el MIDI y el audio.
 */
export interface PerformanceOptions {
  /** Id de groove: straight, swing, shuffle, laid_back, driving, funk, waltz. */
  readonly groove?: string | undefined;
  /** Cuanto se desordena el resultado, de 0 a 1. */
  readonly humanize?: number | undefined;
  readonly performanceSeed?: string | undefined;
}

export interface MidiRenderOptions extends PerformanceOptions {
  /** Pulsos por negra. 480 cubre tresillos y quintillos de forma exacta. */
  readonly ppq?: number;
  /** Movimiento concreto; por defecto, todos concatenados. */
  readonly movementId?: string;
}

/** Convierte una partitura en un archivo MIDI estandar. */
export interface MidiRenderer {
  render(score: Score, options?: MidiRenderOptions): RenderedArtifact;
}

export interface ScoreRenderOptions {
  readonly movementId?: string;
  readonly format?: 'svg' | 'musicxml' | 'lilypond' | 'abc';
}

/**
 * Convierte una partitura en notacion legible o grabada.
 *
 * `formats` no es decorativo: varios formatos de partitura comparten puerto, y
 * sin declararlo un adaptador de MusicXML atenderia una peticion de LilyPond
 * devolviendo MusicXML sin avisar. Es mejor decir "ese formato no esta" que
 * entregar un archivo que no es el que se pidio.
 */
export interface ScoreRenderer {
  readonly formats: readonly ExportFormat[];
  render(score: Score, options?: ScoreRenderOptions): Promise<RenderedArtifact>;
}

export interface AudioRenderOptions extends PerformanceOptions {
  readonly movementId?: string;
  readonly format?: 'wav' | 'mp3';
  readonly sampleRate?: number;
  /** Ruta al SoundFont. Si falta, el adaptador usa el configurado por defecto. */
  readonly soundfontPath?: string;
}

/** Sintetiza la partitura a audio para que el agente pueda escucharla. */
export interface AudioRenderer {
  readonly formats: readonly ExportFormat[];
  render(score: Score, options?: AudioRenderOptions): Promise<RenderedArtifact>;
}

export interface SavedArtifact {
  readonly path: string;
  readonly bytes: number;
}

/**
 * Destino donde se guardan los archivos generados.
 *
 * El motor no escribe en disco: solo produce bytes y pide que se guarden. Asi
 * el mismo codigo sirve para un servidor stdio que escribe en una carpeta
 * local, para uno HTTP que sube a almacenamiento remoto, y para los tests,
 * que se quedan en memoria y no ensucian nada.
 */
export interface ArtifactSink {
  save(artifact: RenderedArtifact, scoreId: string): Promise<SavedArtifact>;
}

/**
 * Conjunto de adaptadores que la aplicacion recibe inyectados.
 *
 * Todos opcionales salvo MIDI: el servidor debe poder arrancar aunque no haya
 * SoundFont instalado, ofreciendo lo que si puede hacer en vez de fallar
 * entero.
 */
export interface EnginePorts {
  readonly midi: MidiRenderer;
  readonly sink: ArtifactSink;
  readonly score?: ScoreRenderer;
  readonly audio?: AudioRenderer;
  readonly loader?: PerformanceLoader;
}

// -------------------------------------------------------- puertos de ENTRADA

/** Que sabe leer un cargador. Se declara igual que `formats` en los de salida. */
export type PerformanceCapability = 'midi' | 'audio';

export interface LoadPerformanceOptions {
  /** Nombre para la procedencia; por defecto, el del archivo. */
  readonly name?: string | undefined;
  /**
   * Tempo declarado, en negras por minuto.
   *
   * Un archivo MIDI trae su propio mapa de tempo y no lo necesita. El audio
   * si: sin seguidor de pulso no hay contra que medir, y el cuantizador
   * tendria que suponer un tempo. Declararlo es la diferencia entre un ritmo
   * correcto y uno inventado, asi que se pide en vez de adivinarlo.
   */
  readonly bpm?: number | undefined;
  /**
   * Instrumento que suena, por id del catalogo.
   *
   * Es la misma decision que toman los transcriptores comerciales: en vez de
   * adivinar el timbre —problema abierto y donde mas se falla— se pregunta.
   * Aqui ademas sirve para acotar el rango de busqueda del detector, que evita
   * de raiz los errores de octava.
   */
  readonly instrumentId?: string | undefined;
}

/**
 * Trae material de fuera y lo entrega como interpretacion cruda.
 *
 * Devuelve `Performance` y no `Score` a proposito, y esa es la decision de
 * diseno de toda la fase. Lo que sale de un archivo MIDI o de un modelo de
 * audio son notas medidas en segundos: todavia no es musica escrita. Convertir
 * eso en notacion —cuantizar, elegir grafias, separar voces— es un trabajo
 * distinto, deterministico y probado aparte, que ocurre despues.
 *
 * Gracias a esa separacion, anadir transcripcion de audio no toca nada de lo
 * que hay aqui: es otro cargador que produce el mismo tipo.
 */
export interface PerformanceLoader {
  readonly capabilities: readonly PerformanceCapability[];
  /**
   * Si este cargador se hace cargo de esa ruta.
   *
   * Permite despachar entre varios sin tenerlos que probar a ver cual falla,
   * y sobre todo permite dar un error util —"conozco .mid y .wav"— en vez del
   * error del ultimo que lo intento.
   */
  accepts(path: string): boolean;
  load(path: string, options?: LoadPerformanceOptions): Promise<Performance>;
}

