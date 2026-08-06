import { describe, expect, it } from 'vitest';
import {
  averageTempo,
  beatsPerBar,
  beatToSeconds,
  createGrid,
  gridFromTempo,
  secondsToBeat,
  tempoStability,
} from './grid.js';

/** Rejilla de 120 negras por minuto: un pulso cada medio segundo. */
const steady = (count: number, perBar = 4) =>
  createGrid(
    Array.from({ length: count }, (_, i) => i * 0.5),
    Array.from({ length: Math.ceil(count / perBar) }, (_, i) => i * perBar * 0.5),
  );

describe('createGrid', () => {
  it('rechaza pulsos que no van en orden ascendente', () => {
    expect(() => createGrid([0, 0.5, 0.4])).toThrow(/ascendente/);
  });

  it('rechaza pulsos repetidos', () => {
    expect(() => createGrid([0, 0.5, 0.5])).toThrow(/ascendente/);
  });

  it('rechaza un tiempo fuerte que no cae sobre ningun pulso', () => {
    expect(() => createGrid([0, 0.5, 1], [0.3])).toThrow(/tiempo fuerte/);
  });

  it('ajusta el tiempo fuerte al pulso cuando difieren por redondeo', () => {
    // Los detectores emiten pulsos y fuertes por separado; sin este ajuste
    // el compas quedaria sin detectar por medio milisegundo de diferencia.
    const grid = createGrid([0, 0.5, 1], [0.5004]);
    expect(grid.downbeats).toEqual([0.5]);
  });

  it('exige un valor de confianza por pulso', () => {
    expect(() => createGrid([0, 0.5, 1], [], [0.9, 0.8])).toThrow(/confianza/);
  });
});

describe('secondsToBeat', () => {
  it('devuelve un entero exacto sobre el pulso', () => {
    expect(secondsToBeat(steady(8), 1.5)).toBe(3);
  });

  it('interpola la parte fraccionaria entre dos pulsos', () => {
    // El caso del plan: 1,37 s entre el pulso 3 (1,20 s) y el 4 (1,60 s).
    const grid = createGrid([0, 0.4, 0.8, 1.2, 1.6, 2.0]);
    expect(secondsToBeat(grid, 1.37)).toBeCloseTo(3.425, 10);
  });

  it('da posiciones negativas antes del primer pulso, para la anacrusa', () => {
    // Una anacrusa vive antes del primer tiempo fuerte. Aplastarla contra cero
    // amontonaria todas sus notas en el mismo instante.
    expect(secondsToBeat(steady(8), -0.25)).toBeCloseTo(-0.5, 10);
  });

  it('extrapola despues del ultimo pulso', () => {
    expect(secondsToBeat(steady(5), 2.25)).toBeCloseTo(4.5, 10);
  });

  it('anula el rubato: el punto medio entre dos pulsos siempre es .5', () => {
    // Esta es la propiedad que justifica todo el diseno. La rejilla se
    // acelera pulso a pulso, asi que cualquier reloj de tempo constante
    // devolveria valores cada vez mas desviados. Contra el pulso real, no.
    const drifting = createGrid([0, 0.5, 1.05, 1.65, 2.3]);
    expect(secondsToBeat(drifting, 0.25)).toBeCloseTo(0.5, 10);
    expect(secondsToBeat(drifting, 0.775)).toBeCloseTo(1.5, 10);
    expect(secondsToBeat(drifting, 1.35)).toBeCloseTo(2.5, 10);
    expect(secondsToBeat(drifting, 1.975)).toBeCloseTo(3.5, 10);
  });

  it('necesita al menos dos pulsos para poder interpolar', () => {
    expect(() => secondsToBeat(createGrid([1]), 1)).toThrow(/dos pulsos/);
  });
});

describe('beatToSeconds', () => {
  it('es la inversa de secondsToBeat dentro de la rejilla', () => {
    const drifting = createGrid([0, 0.5, 1.05, 1.65, 2.3]);
    for (const seconds of [0.1, 0.75, 1.2, 1.9, 2.2]) {
      expect(beatToSeconds(drifting, secondsToBeat(drifting, seconds))).toBeCloseTo(seconds, 10);
    }
  });

  it('es la inversa tambien fuera de los extremos', () => {
    const grid = steady(6);
    for (const seconds of [-0.7, 3.4]) {
      expect(beatToSeconds(grid, secondsToBeat(grid, seconds))).toBeCloseTo(seconds, 10);
    }
  });
});

describe('beatsPerBar', () => {
  it('reconoce un compas de cuatro pulsos', () => {
    expect(beatsPerBar(steady(17, 4))).toBe(4);
  });

  it('reconoce un compas de tres pulsos', () => {
    expect(beatsPerBar(steady(13, 3))).toBe(3);
  });

  it('sobrevive a un tiempo fuerte que el detector se salto', () => {
    // Fuertes en 0, 2, (falta el 4), 6, 8: la moda sigue siendo 4 aunque un
    // hueco valga 8. Con la media saldria un numero fraccionario sin sentido.
    const beats = Array.from({ length: 21 }, (_, i) => i * 0.5);
    const grid = createGrid(beats, [0, 2, 6, 8]);
    expect(beatsPerBar(grid)).toBe(4);
  });

  it('devuelve null cuando no hay fuertes suficientes', () => {
    expect(beatsPerBar(createGrid([0, 0.5, 1]))).toBeNull();
  });
});

describe('averageTempo', () => {
  it('mide 120 sobre una rejilla de medio segundo', () => {
    expect(averageTempo(steady(9))).toBeCloseTo(120, 10);
  });

  it('ignora un pulso descolocado en medio', () => {
    // Se mide extremo a extremo: el pulso movido no entra en la cuenta.
    const grid = createGrid([0, 0.5, 1.03, 1.5, 2]);
    expect(averageTempo(grid)).toBeCloseTo(120, 10);
  });
});

describe('tempoStability', () => {
  it('da cero con un tempo perfectamente constante', () => {
    expect(tempoStability(steady(9))).toBeCloseTo(0, 10);
  });

  it('crece cuando el tempo oscila', () => {
    const human = createGrid([0, 0.52, 0.99, 1.55, 2.03]);
    expect(tempoStability(human)).toBeGreaterThan(0.02);
  });
});

describe('gridFromTempo', () => {
  it('coloca los pulsos segun el tempo pedido', () => {
    const grid = gridFromTempo(120, 2);
    expect(grid.beats.slice(0, 5)).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it('marca como fuerte el primer pulso de cada compas', () => {
    const grid = gridFromTempo(120, 4, 3);
    expect(grid.downbeats.slice(0, 3)).toEqual([0, 1.5, 3]);
    expect(beatsPerBar(grid)).toBe(3);
  });

  it('rechaza un tempo no positivo', () => {
    expect(() => gridFromTempo(0, 10)).toThrow(/tempo/);
  });
});
