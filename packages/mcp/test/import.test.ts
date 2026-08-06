import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duration, KeySignature, Score, Tempo, TimeSignature, getInstrument, note } from '@sinfo/core';
import { ScoreService, type ArtifactSink, type RenderedArtifact, type SavedArtifact } from '@sinfo/engine';
import { MidiFileLoader } from '@sinfo/mir';
import { MidiFileRenderer } from '@sinfo/render';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Importacion de punta a punta, con archivos de verdad en disco.
 *
 * Los tests de las piezas sueltas trabajan con bytes en memoria. Este monta el
 * servicio como lo monta el servidor —con el cargador enchufado en su puerto—
 * y lee un archivo real, que es donde aparecen los fallos de rutas,
 * extensiones y permisos que ningun test de unidad ve.
 */

/** Sumidero que no toca el disco: aqui no se exporta nada, solo se importa. */
const nullSink: ArtifactSink = {
  save: async (artifact: RenderedArtifact): Promise<SavedArtifact> => ({
    path: `memoria://${artifact.filename}`,
    bytes: artifact.data.byteLength,
  }),
};

let directory: string;
let midiPath: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sinfo-import-'));
  midiPath = join(directory, 'referencia.mid');

  const score = new Score('origen', { title: 'Origen' });
  const movement = score.first;
  const start = movement.timeline.timeSignatureChanges[0]?.at ?? Duration.ZERO;
  movement.timeline.setTimeSignature(start, TimeSignature.of(3, 4));
  movement.timeline.setTempo(start, Tempo.of(96));
  movement.timeline.setKey(start, KeySignature.parse('G major'));

  const violin = getInstrument('violin');
  if (!violin) throw new Error('El catalogo deberia tener violin');
  const voice = movement.addPart('violin', violin).voice('v1');
  // Un vals sencillo en sol mayor, con su fa sostenido.
  for (const [pitch, duration] of [
    ['G4', Duration.QUARTER],
    ['B4', Duration.QUARTER],
    ['D5', Duration.QUARTER],
    ['G5', Duration.HALF],
    ['F#5', Duration.QUARTER],
    ['E5', Duration.QUARTER],
    ['D5', Duration.QUARTER],
    ['B4', Duration.QUARTER],
    ['A4', Duration.HALF],
    ['G4', Duration.QUARTER],
  ] as [string, Duration][]) {
    voice.append(note(pitch, duration));
  }

  await writeFile(midiPath, new MidiFileRenderer().render(score).data);
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

const makeService = () =>
  new ScoreService({ midi: new MidiFileRenderer(), sink: nullSink, loader: new MidiFileLoader() });

describe('import_midi de punta a punta', () => {
  it('lee un archivo del disco y abre una sesion utilizable', async () => {
    const result = await makeService().importFile(midiPath);

    expect(result.scoreId).toBeTruthy();
    expect(result.notes).toBe(10);
    expect(result.timeSignature).toBe('3/4');
    expect(result.tempo).toBeCloseTo(96, 0);
    expect(result.key).toBe('G major');
    expect(result.parts).toHaveLength(1);
  });

  it('reconoce el violin por su programa General MIDI', async () => {
    // El catalogo solo tiene la direccion instrumento -> programa; el indice
    // inverso se construye al vuelo y esto comprueba que acierta.
    const result = await makeService().importFile(midiPath);
    expect(result.parts[0]?.instrument).toBe('violin');
  });

  it('la partitura importada sirve para las demas herramientas', async () => {
    // El sentido de todo esto: lo transcrito entra en el motor de composicion.
    const service = makeService();
    const { scoreId } = await service.importFile(midiPath);

    const ranges = service.checkRanges(scoreId, undefined);
    expect(ranges).toBeDefined();

    const exported = await service.export(scoreId, { format: 'midi' });
    expect(exported).toBeDefined();
  });

  it('recuantiza sin volver a tocar el disco y deja las dos versiones', async () => {
    const service = makeService();
    const first = await service.importFile(midiPath);
    const second = service.requantize(first.scoreId, { quantize: { gapPolicy: 'legato' } });

    expect(second.scoreId).not.toBe(first.scoreId);
    expect(second.from).toBe(first.scoreId);
    // La original sigue viva: se pueden comparar.
    expect(service.describe(first.scoreId, undefined)).toBeDefined();
  });

  it('rechaza recuantizar una partitura que no vino de una transcripcion', async () => {
    const service = makeService();
    const { scoreId } = service.create({ title: 'Escrita a mano' });
    expect(() => service.requantize(scoreId)).toThrow(/no vino de una transcripcion/);
  });

  it('explica que pasa con un formato que no sabe leer', async () => {
    const service = makeService();
    const wav = join(directory, 'cancion.wav');
    await writeFile(wav, new Uint8Array([0, 1, 2]));
    await expect(service.importFile(wav)).rejects.toThrow(/Solo se leen archivos MIDI/);
  });

  it('avisa con claridad si el archivo no existe', async () => {
    const service = makeService();
    await expect(service.importFile(join(directory, 'fantasma.mid'))).rejects.toThrow(
      /No se pudo leer/,
    );
  });
});
