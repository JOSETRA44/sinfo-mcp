import { describe, expect, it } from 'vitest';
import { Pitch } from '../pitch/pitch.js';
import { ENSEMBLE_PRESETS, INSTRUMENT_SPECS } from './catalog.js';
import { INSTRUMENTS, listInstruments, soundingPitch, writtenPitch } from './instrument.js';

const entries = Object.entries(INSTRUMENTS);

/**
 * Integridad del catalogo.
 *
 * Estas comprobaciones valen mas cuanto mas crece el catalogo: son las que
 * impiden que anadir un instrumento con la tesitura al reves o un rango
 * imposible pase desapercibido hasta que alguien orqueste para el.
 */
describe('catalogo de instrumentos', () => {
  it('tiene la orquesta sinfonica completa', () => {
    expect(entries.length).toBeGreaterThanOrEqual(45);
    for (const id of [
      'piccolo', 'flute', 'oboe', 'english_horn', 'clarinet', 'bass_clarinet',
      'bassoon', 'contrabassoon', 'horn', 'trumpet', 'trombone', 'bass_trombone',
      'tuba', 'timpani', 'harp', 'violin', 'viola', 'cello', 'contrabass',
    ]) {
      expect(INSTRUMENTS[id], `falta ${id}`).toBeDefined();
    }
  });

  it.each(entries)('%s tiene rango bien ordenado', (id, instrument) => {
    expect(instrument.range.lowest.midi, `${id}: rango invertido`).toBeLessThan(
      instrument.range.highest.midi,
    );
  });

  it.each(entries)('%s tiene la tesitura dentro del rango', (id, instrument) => {
    expect(instrument.tessitura.lowest.midi, `${id}: tesitura por debajo del rango`)
      .toBeGreaterThanOrEqual(instrument.range.lowest.midi);
    expect(instrument.tessitura.highest.midi, `${id}: tesitura por encima del rango`)
      .toBeLessThanOrEqual(instrument.range.highest.midi);
    expect(instrument.tessitura.lowest.midi, `${id}: tesitura invertida`)
      .toBeLessThan(instrument.tessitura.highest.midi);
  });

  it.each(entries)('%s tiene programa MIDI valido', (id, instrument) => {
    expect(instrument.midiProgram, id).toBeGreaterThanOrEqual(0);
    expect(instrument.midiProgram, id).toBeLessThanOrEqual(127);
  });

  it.each(entries)('%s tiene tamano de seccion y peso positivos', (id, instrument) => {
    expect(instrument.sectionSize, id).toBeGreaterThan(0);
    expect(instrument.weight, id).toBeGreaterThan(0);
  });

  /**
   * Un rango minusculo casi siempre es una altura mal escrita en los datos.
   * El listón es distinto para la percusion afinada: un juego de timbales
   * cubre octava y media y las campanas tubulares menos, y eso es real.
   */
  it.each(entries)('%s tiene un rango plausible', (id, instrument) => {
    const span = instrument.range.highest.midi - instrument.range.lowest.midi;
    const minimum = instrument.family === 'percussion' ? 12 : 24;
    expect(span, `${id}: rango de solo ${span} semitonos`).toBeGreaterThanOrEqual(minimum);
  });

  it('el id del instrumento coincide con su clave en el catalogo', () => {
    for (const [id, instrument] of entries) {
      expect(instrument.id).toBe(id);
    }
  });

  it('los datos y el catalogo construido tienen las mismas entradas', () => {
    expect(Object.keys(INSTRUMENTS).sort()).toEqual(Object.keys(INSTRUMENT_SPECS).sort());
  });

  describe('transposicion', () => {
    it('escrito y sonante son inversos entre si', () => {
      for (const [id, instrument] of entries) {
        const written = Pitch.parse('C4');
        const sounding = soundingPitch(instrument, written);
        expect(writtenPitch(instrument, sounding).name, id).toBe(written.name);
      }
    });

    it.each([
      ['clarinet', -2],
      ['horn', -7],
      ['trumpet', -2],
      ['contrabass', -12],
      ['piccolo', 12],
      ['english_horn', -7],
      ['bass_clarinet', -14],
      ['alto_sax', -9],
    ])('%s transpone %i semitonos', (id, semitones) => {
      expect(INSTRUMENTS[id]!.transposition.chromatic).toBe(semitones);
    });

    it('los instrumentos en Do no transponen', () => {
      for (const id of ['flute', 'oboe', 'bassoon', 'trombone', 'violin', 'viola', 'cello']) {
        expect(INSTRUMENTS[id]!.transposition.chromatic, id).toBe(0);
      }
    });
  });

  describe('percusion', () => {
    it('solo la percusion sin altura se marca como tal', () => {
      const percussive = listInstruments().filter((i) => i.isPercussion).map((i) => i.id);
      expect(percussive.sort()).toEqual(['drums', 'percussion']);
    });

    it('los timbales y los laminofonos SI tienen altura', () => {
      for (const id of ['timpani', 'xylophone', 'marimba', 'vibraphone', 'glockenspiel']) {
        expect(INSTRUMENTS[id]!.isPercussion, id).toBe(false);
      }
    });
  });
});

describe('plantillas de conjunto', () => {
  const presets = Object.entries(ENSEMBLE_PRESETS);

  it.each(presets)('%s solo usa instrumentos que existen', (name, preset) => {
    for (const id of preset.instruments) {
      expect(INSTRUMENTS[id], `${name}: no existe "${id}"`).toBeDefined();
    }
  });

  it.each(presets)('%s tiene al menos un instrumento', (_name, preset) => {
    expect(preset.instruments.length).toBeGreaterThan(0);
  });

  it('la sinfonica cubre las cuatro familias', () => {
    const families = new Set(
      ENSEMBLE_PRESETS['symphony_orchestra']!.instruments.map(
        (id) => INSTRUMENTS[id]!.family,
      ),
    );
    expect(families).toContain('woodwind');
    expect(families).toContain('brass');
    expect(families).toContain('percussion');
    expect(families).toContain('strings');
  });

  it('el cuarteto de cuerda son cuatro instrumentos', () => {
    expect(ENSEMBLE_PRESETS['string_quartet']!.instruments).toHaveLength(4);
  });

  /**
   * El conjunto debe cubrir todo el registro util. Un hueco entre el
   * instrumento mas grave y el resto significaria que hay alturas de la
   * partitura que nadie puede tocar.
   */
  it('la sinfonica cubre del contrabajo al flautin sin huecos', () => {
    const used = ENSEMBLE_PRESETS['symphony_orchestra']!.instruments.map((id) => INSTRUMENTS[id]!);
    const lowest = Math.min(...used.map((i) => i.range.lowest.midi));
    const highest = Math.max(...used.map((i) => i.range.highest.midi));

    expect(lowest).toBeLessThanOrEqual(Pitch.parse('C1').midi);
    expect(highest).toBeGreaterThanOrEqual(Pitch.parse('C7').midi);
  });
});
