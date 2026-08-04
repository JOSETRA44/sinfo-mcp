# sinfo-mcp

Servidor MCP que permite a un agente de IA **componer música de verdad**: planear la forma, escribir las voces, verificar el resultado y exportarlo.

A diferencia de los servidores MCP de MIDI existentes, que operan sobre fragmentos sueltos y a ciegas, aquí la partitura **vive en el servidor** entre llamadas y el agente puede **releer y verificar** lo que escribió. Eso es lo que hace posible pasar de ocho compases a una sinfonía.

## Instalación

```bash
npm install
npm run build
```

Registro en Claude Code:

```bash
claude mcp add sinfo -- node /ruta/a/sinfo-mcp/packages/mcp/dist/index.js
```

Los archivos exportados van a `./sinfo-out/<scoreId>/`. Se cambia con la variable `SINFO_OUT_DIR`.

## Flujo típico

```
score_create      abre la obra y devuelve un scoreId
part_add          un instrumento por parte  (instruments_list para ver el catálogo)
part_write        escribe la música en notación de texto
check_ranges      verifica que nadie toca notas imposibles
export            saca el .mid
```

La partitura no se reenvía nunca: se referencia por `scoreId`. `score_describe` da el resumen y `part_read` devuelve fragmentos acotados por compases.

## Notación

### SinfoScript — instrumentos afinados

```
mf c4/q e4/q g4/h | a4/e. g4/s f4/q+stacc r/q
```

| | |
|---|---|
| `c4/q` | altura + `/` + figura; `c4` es el do central |
| `w h q e s t x` | redonda, blanca, negra, corchea, semicorchea, fusa, semifusa |
| `q.` `q..` | puntillo y doble puntillo |
| `e3` `s5` | tresillo de corchea, quintillo de semicorchea |
| `C#4` `Bb3` `Ebb2` | alteraciones (`#` sostenido, `b` bemol, repetibles) |
| `r/h` | silencio |
| `[c4,e4,g4]/h` | acorde |
| `mf` | dinámica suelta; rige hasta la siguiente |
| `c4/q+stacc+accent` | articulaciones |
| `c4/q~ c4/h` | ligadura de unión |
| `\|` | barra de compás — **se valida** que los tiempos cuadren |
| `#` tras espacio | comentario |

### Rejilla — percusión y ritmos programados

```
kick   x...x...x...x...
snare  ....X.......X...
hihat  x.x.x.x.x.x.x.x.
```

`x` golpe, `X` acentuado, `o` suave, `.` silencio. Las filas cortas se repiten en bucle contra las largas.

## Arquitectura

Hexagonal, con la dirección de dependencias **verificada mecánicamente** en cada build (`npm run arch`).

```
mcp  →  render  →  engine  →  core
 └────────┴──────────┘
```

| Paquete | Responsabilidad | Dependencias |
|---|---|---|
| `@sinfo/core` | Dominio: altura, duración, evento, voz, parte, movimiento, partitura, notación, división en compases | **ninguna** |
| `@sinfo/engine` | Casos de uso, sesiones y puertos de salida | core |
| `@sinfo/render` | Adaptadores de formato: MIDI y MusicXML | core, engine |
| `sinfo-mcp` | Herramientas MCP y raíz de composición | todos |

Tres decisiones que sostienen el resto:

**Tiempo racional exacto.** `Duration` es una fracción, no un flotante. Tres tresillos de corchea suman exactamente una negra; en coma flotante no. En 200 compases de tresillos la última nota cae en su tick exacto, sin un solo pulso de desfase acumulado.

**Alturas con ortografía.** `Pitch` guarda letra, alteración y octava, no un número MIDI. Do♯ y Re♭ suenan igual pero no son la misma nota: transponer Fa♯ mayor por quinta justa da Do♯ mayor, no Re♭. El número MIDI es una proyección con pérdida.

**La partitura vive en el servidor.** Un agente no puede mandar una sinfonía como argumento. `score_create` devuelve un identificador y las demás herramientas mutan esa partitura, devolviendo resúmenes compactos.

**Las voces no guardan compases.** El dominio almacena cada voz como un flujo continuo de eventos; las barras se *derivan* al exportar. Guardarlas dentro obligaría a partir notas y crear ligaduras en cada inserción, y a rehacerlo todo si cambia un compás a mitad de obra. `splitIntoMeasures` hace ese reparto una sola vez, cortando en las barras y encadenando las ligaduras, y lo comparten todos los exportadores de notación.

## Verificación

```bash
npm run verify     # typecheck + tests + reglas de arquitectura
```

Las reglas de `.dependency-cruiser.cjs` **fallan el build** si alguien invierte una dependencia o si `@sinfo/core` gana una dependencia externa. Están probadas inyectando violaciones deliberadas: una regla que nunca dispara no protege de nada.

## Estado

Funciona hoy: estructura de obra y movimientos, escritura en ambas notaciones, validación de compases, comprobación de rangos con transposición, y exportación a **MIDI**, **MusicXML** y JSON.

El MusicXML sale listo para MuseScore, Sibelius, Finale y Dorico: parte notas en las barras con ligaduras, escribe grupos irregulares con su corchete, declara la transposición de los instrumentos transpositores, usa `unpitched` en percusión y alinea todas las partes al mismo número de compases.

Previsto: armonía y análisis funcional, generación de material temático, contrapunto, orquestación, y exportación a LilyPond, partitura SVG y audio.

## Licencia

MIT
