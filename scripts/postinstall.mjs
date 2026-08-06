/**
 * Aviso tras instalar el paquete.
 *
 * Deliberadamente NO instala la skill por su cuenta. Un `postinstall` que
 * escribe en la configuracion global del usuario hace tres cosas malas:
 * modifica archivos fuera del paquete sin permiso, falla de formas raras en
 * CI y en contenedores, y es exactamente el patron que se vigila en los
 * ataques de cadena de suministro. Que la instalacion de una dependencia
 * cambie el comportamiento del agente del usuario tiene que ser una decision
 * suya, tomada a proposito.
 *
 * Asi que esto solo informa. El comando queda a un copiar y pegar.
 */

// A stderr, no a stdout: si alguien encadena la salida de npm, no la ensucia.
const write = (line) => process.stderr.write(`${line}\n`);

// En CI nadie lee esto y solo anade ruido a los registros.
if (process.env['CI'] === 'true' || process.env['SINFO_QUIET'] === '1') {
  process.exit(0);
}

write('');
write('  sinfo-mcp instalado.');
write('');
write('  1. Registra el servidor en tu agente:');
write('       claude mcp add sinfo -- npx -y sinfo-mcp');
write('');
write('  2. Instala la skill para que el agente sepa usarlo bien:');
write('       npx skills add JOSETRA44/sinfo-mcp@sinfo-mcp');
write('');
write('  3. Opcional, para que el audio suene de verdad, apunta un SoundFont');
write('     General MIDI:');
write('       SINFO_SOUNDFONT=/ruta/a/tu.sf2');
write('');
