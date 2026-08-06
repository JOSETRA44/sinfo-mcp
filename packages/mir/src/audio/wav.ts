import { type AudioClip, audioClip } from '@sinfo/perform';

/**
 * Decodificador WAV en TypeScript puro.
 *
 * Se escribe a mano en vez de tirar de una libreria por lo mismo que se
 * eligio TypeScript en su dia: cualquier decodificador serio de audio acaba
 * siendo un binario nativo, y eso rompe la instalacion en Windows. WAV es un
 * formato sencillo y cabe en un archivo; formatos comprimidos como MP3 u OGG
 * necesitan otra cosa y por eso este cargador dice claramente que no los sabe
 * leer en vez de intentarlo.
 */

/** Formatos de muestra del campo `audioFormat` de la cabecera. */
const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

export class WavDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WavDecodeError';
  }
}

interface WavFormat {
  readonly audioFormat: number;
  readonly channels: number;
  readonly sampleRate: number;
  readonly bitsPerSample: number;
}

/**
 * Decodifica un WAV y devuelve un clip mono.
 *
 * La remezcla a mono se hace aqui, promediando los canales: es donde menos
 * cuesta y evita que cada analizador tenga que decidirlo por su cuenta.
 */
export function decodeWav(data: Uint8Array, name?: string): AudioClip {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  if (data.byteLength < 12) throw new WavDecodeError('El archivo es demasiado corto para ser WAV.');
  if (readTag(view, 0) !== 'RIFF' || readTag(view, 8) !== 'WAVE') {
    throw new WavDecodeError(
      'No es un archivo WAV: falta la cabecera RIFF/WAVE. Si es MP3, OGG o FLAC, ' +
        'conviertelo antes a WAV.',
    );
  }

  let format: WavFormat | undefined;
  let samples: Float32Array | undefined;

  // Recorrido por trozos: los WAV reales traen metadatos (LIST, fact, bext)
  // entre el formato y los datos, asi que no vale suponer posiciones fijas.
  let offset = 12;
  while (offset + 8 <= data.byteLength) {
    const id = readTag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === 'fmt ') format = readFormat(view, body, size);
    else if (id === 'data') {
      if (format === undefined) {
        throw new WavDecodeError('El trozo de datos aparece antes que el de formato.');
      }
      const available = Math.min(size, data.byteLength - body);
      samples = readSamples(view, body, available, format);
    }

    // Los trozos se alinean a numero par de octetos.
    offset = body + size + (size % 2);
  }

  if (format === undefined) throw new WavDecodeError('El archivo no declara formato (trozo fmt).');
  if (samples === undefined) throw new WavDecodeError('El archivo no contiene datos de audio.');

  return audioClip(samples, format.sampleRate, name);
}

// --------------------------------------------------------------- interiores

function readTag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function readFormat(view: DataView, offset: number, size: number): WavFormat {
  if (size < 16) throw new WavDecodeError('El trozo de formato esta incompleto.');

  let audioFormat = view.getUint16(offset, true);
  const channels = view.getUint16(offset + 2, true);
  const sampleRate = view.getUint32(offset + 4, true);
  const bitsPerSample = view.getUint16(offset + 14, true);

  // En WAVE_FORMAT_EXTENSIBLE el formato real esta en el GUID ampliado; sus
  // dos primeros octetos repiten el codigo clasico.
  if (audioFormat === FORMAT_EXTENSIBLE && size >= 40) {
    audioFormat = view.getUint16(offset + 24, true);
  }

  if (audioFormat !== FORMAT_PCM && audioFormat !== FORMAT_FLOAT) {
    throw new WavDecodeError(
      `WAV con compresion (codigo de formato ${audioFormat}). Solo se leen PCM y coma flotante ` +
        'sin comprimir.',
    );
  }
  if (channels < 1) throw new WavDecodeError('El archivo declara cero canales.');

  return { audioFormat, channels, sampleRate, bitsPerSample };
}

/**
 * Lee las muestras y las promedia a un solo canal.
 *
 * Cada profundidad se normaliza a -1..1 por su propio maximo. El caso de 8
 * bits es la excepcion historica del formato: va sin signo, con el silencio en
 * 128 en vez de en cero.
 */
function readSamples(
  view: DataView,
  offset: number,
  byteLength: number,
  format: WavFormat,
): Float32Array {
  const { channels, bitsPerSample, audioFormat } = format;
  const bytesPerSample = bitsPerSample / 8;
  if (!Number.isInteger(bytesPerSample) || bytesPerSample < 1) {
    throw new WavDecodeError(`Profundidad de bits no soportada: ${bitsPerSample}.`);
  }

  const frameBytes = bytesPerSample * channels;
  const frames = Math.floor(byteLength / frameBytes);
  const mono = new Float32Array(frames);

  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const at = offset + frame * frameBytes + channel * bytesPerSample;
      sum += readOne(view, at, bitsPerSample, audioFormat);
    }
    mono[frame] = sum / channels;
  }
  return mono;
}

function readOne(view: DataView, at: number, bits: number, audioFormat: number): number {
  if (audioFormat === FORMAT_FLOAT) {
    if (bits === 32) return view.getFloat32(at, true);
    if (bits === 64) return view.getFloat64(at, true);
    throw new WavDecodeError(`Coma flotante de ${bits} bits no soportada.`);
  }

  switch (bits) {
    case 8:
      // Sin signo por herencia del formato: el silencio esta en 128.
      return (view.getUint8(at) - 128) / 128;
    case 16:
      return view.getInt16(at, true) / 32768;
    case 24: {
      const value = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);
      // Extension de signo del bit 23.
      return (value & 0x800000 ? value - 0x1000000 : value) / 8388608;
    }
    case 32:
      return view.getInt32(at, true) / 2147483648;
    default:
      throw new WavDecodeError(`Profundidad de ${bits} bits no soportada.`);
  }
}
