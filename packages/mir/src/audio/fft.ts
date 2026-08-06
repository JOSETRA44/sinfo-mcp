/**
 * Transformada rapida de Fourier, radix-2 iterativa y en sitio.
 *
 * Esta aqui por una razon muy concreta de rendimiento. La funcion de
 * diferencia de YIN, calculada como se define, cuesta O(W * tau) por ventana:
 * con ventanas de 2048 muestras y un margen de 700 desplazamientos son un
 * millon y medio de operaciones por ventana, y a ochenta ventanas por segundo
 * de audio eso convierte el analisis de una cancion en minutos.
 *
 * La misma funcion se obtiene de la autocorrelacion, y la autocorrelacion sale
 * de dos transformadas en O(W log W). El coste por ventana baja de un millon y
 * medio a cincuenta mil.
 */

/** Transformada directa en sitio. `re` e `im` deben medir una potencia de dos. */
export function fft(re: Float64Array, im: Float64Array): void {
  transform(re, im, false);
}

/** Transformada inversa en sitio, ya dividida por N. */
export function ifft(re: Float64Array, im: Float64Array): void {
  transform(re, im, true);
  const n = re.length;
  for (let i = 0; i < n; i += 1) {
    re[i] = (re[i] ?? 0) / n;
    im[i] = (im[i] ?? 0) / n;
  }
}

/** Potencia de dos igual o mayor que `value`. */
export function nextPowerOfTwo(value: number): number {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

/**
 * Autocorrelacion lineal de `frame`, para desplazamientos 0..frame.length-1.
 *
 * Se rellena con ceros hasta el doble de longitud antes de transformar. Sin
 * ese relleno la transformada da la autocorrelacion CIRCULAR, que envuelve el
 * final de la ventana sobre el principio e inventa periodicidad donde no la
 * hay: el detector encontraria tonos en el ruido.
 */
export function autocorrelation(frame: Float64Array): Float64Array {
  const window = frame.length;
  const size = nextPowerOfTwo(window * 2);

  const re = new Float64Array(size);
  const im = new Float64Array(size);
  re.set(frame);

  fft(re, im);

  // El espectro de potencia es real: la fase se descarta, que es justo lo que
  // hace que la anti-transformada sea la autocorrelacion.
  for (let i = 0; i < size; i += 1) {
    const real = re[i] ?? 0;
    const imaginary = im[i] ?? 0;
    re[i] = real * real + imaginary * imaginary;
    im[i] = 0;
  }

  ifft(re, im);

  return re.slice(0, window);
}

// --------------------------------------------------------------- interiores

function transform(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) {
    throw new Error(`La FFT necesita una longitud potencia de dos, y recibio ${n}.`);
  }

  // Permutacion por inversion de bits: deja las muestras en el orden que
  // necesitan las mariposas para poder trabajar en sitio.
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      swap(re, i, j);
      swap(im, i, j);
    }
  }

  const sign = inverse ? 1 : -1;
  for (let length = 2; length <= n; length *= 2) {
    const angle = (sign * 2 * Math.PI) / length;
    const stepRe = Math.cos(angle);
    const stepIm = Math.sin(angle);

    for (let start = 0; start < n; start += length) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < length / 2; k += 1) {
        const a = start + k;
        const b = a + length / 2;

        const bRe = re[b] ?? 0;
        const bIm = im[b] ?? 0;
        const tRe = bRe * wRe - bIm * wIm;
        const tIm = bRe * wIm + bIm * wRe;

        const aRe = re[a] ?? 0;
        const aIm = im[a] ?? 0;
        re[b] = aRe - tRe;
        im[b] = aIm - tIm;
        re[a] = aRe + tRe;
        im[a] = aIm + tIm;

        const nextRe = wRe * stepRe - wIm * stepIm;
        wIm = wRe * stepIm + wIm * stepRe;
        wRe = nextRe;
      }
    }
  }
}

function swap(values: Float64Array, i: number, j: number): void {
  const temporary = values[i] ?? 0;
  values[i] = values[j] ?? 0;
  values[j] = temporary;
}
