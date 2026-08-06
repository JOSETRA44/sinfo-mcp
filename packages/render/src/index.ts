/**
 * @sinfo/render — adaptadores de salida.
 *
 * Implementa los puertos que define @sinfo/engine. Aqui, y solo aqui, viven
 * las librerias externas de formato: midi-file hoy, verovio y el sintetizador
 * cuando lleguen. El motor de composicion no sabe que existen.
 */

export { MidiFileRenderer } from './midi/midi-renderer.js';
export { MusicXmlRenderer } from './musicxml/musicxml-renderer.js';
export { VerovioRenderer } from './engraving/verovio-renderer.js';
export { WavRenderer } from './audio/wav-renderer.js';
export { assignChannels, PERCUSSION_CHANNEL, type ChannelAssignment } from './midi/channels.js';
