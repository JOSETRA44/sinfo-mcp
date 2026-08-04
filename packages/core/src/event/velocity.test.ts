import { describe, expect, it } from 'vitest';
import { Duration } from '../time/duration.js';
import { note } from './event.js';
import {
  calibratedCurve,
  exponentialCurve,
  linearCurve,
  MAX_VELOCITY,
  MIN_VELOCITY,
  resolveVelocity,
  type VelocityCurve,
} from './velocity.js';

const Q = Duration.QUARTER;

describe('resolveVelocity', () => {
  it('la velocity explicita manda sobre todo lo demas', () => {
    const event = note('C4', Q, { velocity: 42, dynamic: 'fff', articulations: ['marcato'] });
    expect(resolveVelocity(event)).toBe(42);
  });

  it('usa mezzoforte cuando no hay ninguna marca', () => {
    const plain = resolveVelocity(note('C4', Q));
    const explicit = resolveVelocity(note('C4', Q, { dynamic: 'mf' }));
    expect(plain).toBe(explicit);
  });

  it('la dinamica vigente cubre a los eventos sin marca', () => {
    const event = note('C4', Q);
    expect(resolveVelocity(event, { prevailingDynamic: 'pp' })).toBeLessThan(
      resolveVelocity(event, { prevailingDynamic: 'ff' }),
    );
  });

  it('la marca del evento gana a la vigente', () => {
    const event = note('C4', Q, { dynamic: 'ff' });
    expect(resolveVelocity(event, { prevailingDynamic: 'pp' })).toBe(resolveVelocity(event));
  });

  it('las articulaciones de enfasis suben la intensidad', () => {
    const plain = resolveVelocity(note('C4', Q, { dynamic: 'mf' }));
    const accented = resolveVelocity(note('C4', Q, { dynamic: 'mf', articulations: ['accent'] }));
    const marcato = resolveVelocity(note('C4', Q, { dynamic: 'mf', articulations: ['marcato'] }));

    expect(accented).toBeGreaterThan(plain);
    expect(marcato).toBeGreaterThan(accented);
  });

  it('el staccato no cambia la intensidad, solo la duracion', () => {
    const plain = resolveVelocity(note('C4', Q, { dynamic: 'mf' }));
    const staccato = resolveVelocity(note('C4', Q, { dynamic: 'mf', articulations: ['staccato'] }));
    expect(staccato).toBe(plain);
  });

  it('el ajuste por instrumento desplaza el resultado', () => {
    const event = note('C4', Q, { dynamic: 'mf' });
    expect(resolveVelocity(event, { instrumentOffset: 10 })).toBe(
      resolveVelocity(event) + 10,
    );
  });

  it('nunca sale del rango MIDI valido', () => {
    const loud = note('C4', Q, { dynamic: 'fff', articulations: ['marcato'] });
    const soft = note('C4', Q, { dynamic: 'ppp' });

    expect(resolveVelocity(loud, { instrumentOffset: 100 })).toBe(MAX_VELOCITY);
    expect(resolveVelocity(soft, { instrumentOffset: -100 })).toBe(MIN_VELOCITY);
  });

  it('acepta una curva propia sin tocar el dominio', () => {
    const alwaysSixty: VelocityCurve = () => 60;
    expect(resolveVelocity(note('C4', Q, { dynamic: 'ppp' }), { curve: alwaysSixty })).toBe(60);
  });
});

describe('curvas', () => {
  const curves = { calibrada: calibratedCurve, exponencial: exponentialCurve, lineal: linearCurve };

  it.each(Object.entries(curves))('%s crece de forma monotona', (_name, curve) => {
    const values = (['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'] as const).map((d) =>
      curve(d, 0, 0),
    );
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!);
    }
  });

  it.each(Object.entries(curves))('%s se mantiene en el rango MIDI', (_name, curve) => {
    for (const dynamic of ['ppp', 'mf', 'fff'] as const) {
      for (const emphasis of [0, 1, 2, 5]) {
        const value = curve(dynamic, emphasis, 0);
        expect(value).toBeGreaterThanOrEqual(MIN_VELOCITY);
        expect(value).toBeLessThanOrEqual(MAX_VELOCITY);
      }
    }
  });

  it('la exponencial da mas resolucion en los matices suaves que la lineal', () => {
    // Distancia entre ppp y pp frente a la distancia entre ff y fff.
    const expSoft = exponentialCurve('pp', 0, 0) - exponentialCurve('ppp', 0, 0);
    const expLoud = exponentialCurve('fff', 0, 0) - exponentialCurve('ff', 0, 0);
    expect(expLoud).toBeGreaterThan(expSoft);

    const linSoft = linearCurve('pp', 0, 0) - linearCurve('ppp', 0, 0);
    const linLoud = linearCurve('fff', 0, 0) - linearCurve('ff', 0, 0);
    expect(linLoud).toBe(linSoft);
  });

  it('el enfasis no puede pasarse del ultimo escalon', () => {
    expect(calibratedCurve('fff', 5, 0)).toBe(calibratedCurve('fff', 0, 0));
  });
});
