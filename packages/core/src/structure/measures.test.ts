import { describe, expect, it } from 'vitest';
import { note, rest } from '../event/event.js';
import { parseVoice } from '../notation/sinfoscript.js';
import { Duration } from '../time/duration.js';
import { TimeSignature } from '../time/time-signature.js';
import { splitIntoMeasures } from './measures.js';
import { Timeline } from './timeline.js';
import { Voice } from './voice.js';

function voiceOf(source: string): Voice {
  return new Voice('v1').append(...parseVoice(source).events);
}

const fourFour = () => new Timeline(TimeSignature.COMMON);

describe('splitIntoMeasures', () => {
  it('reparte los eventos en sus compases', () => {
    const measures = splitIntoMeasures(voiceOf('c4/q d4/q e4/q f4/q g4/w'), fourFour());

    expect(measures).toHaveLength(2);
    expect(measures[0]!.number).toBe(1);
    expect(measures[0]!.events).toHaveLength(4);
    expect(measures[1]!.events).toHaveLength(1);
  });

  it('una voz vacia no produce compases', () => {
    expect(splitIntoMeasures(new Voice('v1'), fourFour())).toEqual([]);
  });

  // Lo que justifica todo el modulo: la notacion no tiene ningun simbolo que
  // atraviese una barra de compas.
  describe('notas que cruzan la barra', () => {
    it('parte la nota en dos figuras unidas por ligadura', () => {
      // Blanca que empieza en el ultimo tiempo del compas 1.
      const measures = splitIntoMeasures(voiceOf('c4/h. d4/h e4/q'), fourFour());

      expect(measures).toHaveLength(2);

      const crossing = measures[0]!.events[1]!;
      expect(crossing.event.duration.toString()).toBe('1/4');
      expect(crossing.tiedToNext).toBe(true);
      expect(crossing.tiedFromPrevious).toBe(false);

      const continuation = measures[1]!.events[0]!;
      expect(continuation.event.duration.toString()).toBe('1/4');
      expect(continuation.tiedFromPrevious).toBe(true);
      expect(continuation.tiedToNext).toBe(false);
      // Y siguen siendo la misma altura.
      expect(continuation.event.pitches[0]!.name).toBe('D4');
    });

    it('conserva la musica y completa el ultimo compas', () => {
      // 1/4 + 1 + 1 + 1/4 son dos compases y medio: el tercero se completa.
      const measures = splitIntoMeasures(voiceOf('c4/q d4/w e4/w f4/q'), fourFour());
      const total = measures
        .flatMap((m) => m.events)
        .reduce((sum, item) => sum.plus(item.event.duration), Duration.ZERO);

      expect(measures).toHaveLength(3);
      expect(total.equals(Duration.of(3, 1))).toBe(true);
    });

    // Invariante fuerte: si esto se cumple, la partitura no puede salir
    // descuadrada por mucho que se compliquen las ligaduras.
    it.each([
      ['4/4', 'c4/q d4/w e4/w f4/q'],
      ['4/4', 'c4/h. d4/h e4/q'],
      ['3/4', 'c4/q d4/h. e4/q'],
      ['6/8', 'c4/e. d4/q e4/h'],
      ['4/4', 'c4/e3 d4/e3 e4/e3 f4/w'],
      ['5/8', 'c4/q d4/e e4/h'],
    ])('en %s todo compas suma su indicacion (%s)', (signature, source) => {
      const timeline = new Timeline(TimeSignature.parse(signature));
      const expected = TimeSignature.parse(signature).measureDuration;

      for (const measure of splitIntoMeasures(voiceOf(source), timeline)) {
        const sum = measure.events.reduce(
          (total, item) => total.plus(item.event.duration),
          Duration.ZERO,
        );
        expect(sum.equals(expected), `compas ${measure.number}: ${sum.toString()}`).toBe(true);
      }
    });

    it('los silencios se parten pero no se ligan', () => {
      const voice = new Voice('v1').append(note('C4', Duration.HALF), rest(Duration.WHOLE));
      const measures = splitIntoMeasures(voice, fourFour());

      const pieces = measures.flatMap((m) => m.events).filter((e) => e.event.pitches.length === 0);
      expect(pieces.length).toBeGreaterThan(1);
      expect(pieces.every((p) => !p.tiedFromPrevious && !p.tiedToNext)).toBe(true);
    });

    it('respeta la ligadura escrita entre dos eventos distintos', () => {
      const measures = splitIntoMeasures(voiceOf('c4/h~ c4/h'), fourFour());
      const [first, second] = measures[0]!.events;

      expect(first!.tiedToNext).toBe(true);
      expect(second!.tiedFromPrevious).toBe(true);
      expect(second!.tiedToNext).toBe(false);
    });
  });

  describe('figuras que no caben en un simbolo', () => {
    it('parte 5/16 en dos figuras atadas dentro del mismo compas', () => {
      const voice = new Voice('v1').append(note('C4', Duration.of(5, 16)));
      const [measure] = splitIntoMeasures(voice, fourFour());
      // Detras van los silencios que completan el compas; interesan las notas.
      const pitched = measure!.events.filter((e) => e.event.pitches.length > 0);

      expect(pitched).toHaveLength(2);
      expect(pitched.map((e) => e.event.duration.toString())).toEqual(['1/4', '1/16']);
      expect(pitched[0]!.tiedToNext).toBe(true);
      expect(pitched[1]!.tiedFromPrevious).toBe(true);
      // Y la ligadura no se propaga al silencio que viene despues.
      expect(pitched[1]!.tiedToNext).toBe(false);
    });
  });

  describe('analisis de figura', () => {
    it('reconoce puntillos y grupos irregulares', () => {
      const measures = splitIntoMeasures(voiceOf('c4/q. d4/e e4/e3 f4/e3 g4/e3 a4/h'), fourFour());
      const shapes = measures[0]!.events.map((e) => e.shape);

      expect(shapes[0]).toMatchObject({ noteType: 'quarter', dots: 1, tuplet: null });
      expect(shapes[1]).toMatchObject({ noteType: 'eighth', dots: 0, tuplet: null });
      expect(shapes[2]).toMatchObject({ noteType: 'eighth', tuplet: { actual: 3, normal: 2 } });
    });
  });

  describe('metadatos del compas', () => {
    it('marca para reimprimir solo donde cambia algo', () => {
      const timeline = fourFour();
      timeline.setTimeSignature(Duration.of(2, 1), TimeSignature.parse('3/4'));
      const measures = splitIntoMeasures(voiceOf('c4/w d4/w e4/h. f4/h.'), timeline);

      expect(measures[0]!.timeSignatureChanged).toBe(true); // primero: se imprime todo
      expect(measures[1]!.timeSignatureChanged).toBe(false);
      expect(measures[2]!.timeSignatureChanged).toBe(true); // aqui cambia a 3/4
      expect(measures[2]!.timeSignature.toString()).toBe('3/4');
    });

    it('detecta el silencio que ocupa el compas entero', () => {
      const voice = new Voice('v1').append(rest(Duration.WHOLE), note('C4', Duration.WHOLE));
      const measures = splitIntoMeasures(voice, fourFour());

      expect(measures[0]!.events[0]!.isFullMeasureRest).toBe(true);
      expect(measures[1]!.events[0]!.isFullMeasureRest).toBe(false);
    });

    it('en tres por cuatro el compas entero mide 3/4', () => {
      const timeline = new Timeline(TimeSignature.parse('3/4'));
      const voice = new Voice('v1').append(rest(Duration.of(3, 4)));
      const [measure] = splitIntoMeasures(voice, timeline);

      expect(measure!.events[0]!.isFullMeasureRest).toBe(true);
    });
  });

  describe('alineacion entre partes', () => {
    it('rellena con silencios hasta la longitud pedida', () => {
      const short = voiceOf('c4/w');
      const measures = splitIntoMeasures(short, fourFour(), {
        totalDuration: Duration.of(3, 1),
      });

      // Tres compases, aunque la voz solo tenga musica en el primero.
      expect(measures).toHaveLength(3);
      expect(measures[1]!.events[0]!.isFullMeasureRest).toBe(true);
      expect(measures[2]!.events[0]!.isFullMeasureRest).toBe(true);
    });

    it('no recorta una voz mas larga que el total pedido', () => {
      const measures = splitIntoMeasures(voiceOf('c4/w d4/w e4/w'), fourFour(), {
        totalDuration: Duration.WHOLE,
      });
      expect(measures).toHaveLength(3);
    });
  });

  describe('dinamicas', () => {
    it('arrastra la marca vigente a las figuras siguientes', () => {
      const measures = splitIntoMeasures(voiceOf('pp c4/q d4/q ff e4/q f4/q'), fourFour());
      const dynamics = measures[0]!.events.map((e) => e.dynamic);
      expect(dynamics).toEqual(['pp', 'pp', 'ff', 'ff']);
    });
  });
});
