import { rest, type MusicalEvent } from '../event/event.js';
import { splitIntoWritable } from '../notation/duration-token.js';
import { Duration } from '../time/duration.js';
import type { Timeline } from './timeline.js';

/**
 * Silencios para cubrir un hueco, partidos por compas.
 *
 * Un solo silencio gigante seria mas corto de escribir pero esta mal en dos
 * sentidos: no existe la figura que valga ocho redondas, y una partitura
 * muestra la espera compas a compas, no como un simbolo unico. Esto genera lo
 * que un copista escribiria: un silencio por compas, y dentro de cada uno las
 * figuras que hagan falta.
 *
 * Es lo que permite que una trompa entre en el compas 9 sin descuadrarse del
 * resto de la orquesta.
 */
export function restsBetween(
  timeline: Timeline,
  from: Duration,
  to: Duration,
): MusicalEvent[] {
  if (!to.greaterThan(from)) return [];

  const events: MusicalEvent[] = [];
  let position = from;

  // Cota de seguridad: rellenar mas de 100000 compases es un error de
  // llamada, no una obra larga.
  for (let guard = 0; guard < 100_000 && position.lessThan(to); guard++) {
    const measureDuration = timeline.timeSignatureAt(position).measureDuration;
    const measureNumber = timeline.measureNumberAt(position);
    const measureEnd = timeline.measureStart(measureNumber + 1);

    // Se corta en el final del compas o en el destino, lo que llegue antes:
    // asi el primer y el ultimo tramo pueden ser compases incompletos.
    const chunkEnd = measureEnd.lessThan(to) ? measureEnd : to;
    const chunk = chunkEnd.minus(position);

    if (chunk.isZero || chunk.isNegative) {
      // No deberia pasar, pero si el compas midiera cero se colgaria el bucle.
      position = position.plus(measureDuration);
      continue;
    }

    for (const piece of splitIntoWritable(chunk)) {
      events.push(rest(piece));
    }
    position = chunkEnd;
  }

  return events;
}
