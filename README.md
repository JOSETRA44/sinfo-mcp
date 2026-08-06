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
score_create          abre la obra y devuelve un scoreId
part_add              un instrumento por parte  (instruments_list para el catálogo)
motif_create          guarda una célula temática
motif_develop         inversión, retrogradación, aumentación, secuencia…
melody_generate       melodía sobre una progresión, con contorno y semilla
counterpoint_add      una voz contra otra, por búsqueda con retroceso
harmony_progression   convierte I-vi-ii-V7-I en acordes reales
part_write            escribe la música en notación de texto
analyze_harmony       qué función cumple lo escrito, y dónde hay cadencias
check_voice_leading   quintas y octavas paralelas, cruces, saltos
check_ranges          nadie toca notas imposibles
export                saca el .mid o el .musicxml
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
| `@sinfo/theory` | Escalas, acordes, números romanos, cadencias, conducción de voces | core |
| `@sinfo/generate` | Motivos, melodía por restricciones, contrapunto, PRNG determinista | core, theory |
| `@sinfo/engine` | Casos de uso, sesiones y puertos de salida | core, theory, generate |
| `@sinfo/render` | Adaptadores de formato: MIDI y MusicXML | core, engine |
| `sinfo-mcp` | Herramientas MCP y raíz de composición | todos |

`@sinfo/theory` tampoco tiene dependencias externas. El plan preveía apoyarse en `tonal`, pero esa librería trabaja con cadenas de texto (`"C#4"`, `"Cmaj7"`) y aquí todo son objetos que conservan la ortografía: cada conversión de ida y vuelta es un sitio donde Do♯ puede volver como Re♭. Un acorde es una tónica más un patrón de intervalos — sale más corto construirlo que traducirlo.

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

## Armonía

Números romanos completos: `I ii V7 vii°7 viiø7 III+ bVII #iv`, inversiones por cifrado de bajo (`I6 I64 V65 V43 V42`) y dominantes secundarias (`V/V`, `V7/IV`).

El modo menor recibe el trato que exige. Se construye con la escala armónica, así que `V` sale mayor y `vii°` disminuido — sin eso no hay cadencia auténtica. Pero el diatonismo se mide contra la colección completa del modo (natural **más** la sensible), porque el modo menor no tiene siete notas sino ocho: medirlo con una sola escala marcaba el relativo mayor como acorde prestado. Y el séptimo grado distingue `VII` (subtónica, Sol mayor en la menor) de `vii°` (sensible, Sol♯ disminuido), que son acordes distintos con funciones distintas.

`check_voice_leading` separa **errores** de **avisos**: las quintas y octavas paralelas funden dos voces en una y son error; los cruces, solapamientos, quintas directas, espaciados anchos y saltos grandes son avisos. Cada uno dice en qué compás está, entre qué voces y por qué importa.

## Generación

Toda la aleatoriedad pasa por un PRNG **determinista**: la misma semilla con los mismos parámetros da exactamente la misma música, en cualquier máquina. Es lo que permite al agente iterar — «esa melodía me gustaba, dame otra vez esa y cámbiame solo el contorno».

Cada tipo de decisión consume un **sub-flujo propio** (`Random.fork('ritmo')`). Sin eso, tocar el algoritmo de las alturas desplazaría todos los números siguientes y el ritmo cambiaría también, aunque no se hubiera tocado.

La melodía se construye con **restricciones puntuables**, no con una función llena de condicionales: rango, nota del acorde en tiempo fuerte, grado conjunto, resolución de saltos, contorno, cierre estable. Las puntuaciones se multiplican, así que un solo cero veta al candidato — el rango del instrumento no se negocia con el gusto por el grado conjunto. Añadir un criterio es escribir una función y sumarla a una lista.

El contrapunto usa **búsqueda con retroceso**, no elección nota a nota. Las reglas se condicionan entre sí: una elección correcta en el compás 5 puede dejar el 6 sin ninguna salida legal, y un algoritmo voraz se atasca ahí. Si no existe solución estricta cede reglas de estilo por orden — nunca las disonancias — y dice cuáles cedió.

Lo generado se somete al **mismo analizador** que critica lo escrito a mano: el test comprueba que el contrapunto pasa `check_voice_leading` sin una sola paralela.

## Estado

Funciona hoy: estructura de obra y movimientos, escritura en ambas notaciones, validación de compases, armonía funcional y análisis, conducción de voces, material temático y contrapunto reproducibles, comprobación de rangos con transposición, y exportación a **MIDI**, **MusicXML** y JSON.

El MusicXML sale listo para MuseScore, Sibelius, Finale y Dorico: parte notas en las barras con ligaduras, escribe grupos irregulares con su corchete, declara la transposición de los instrumentos transpositores, usa `unpitched` en percusión y alinea todas las partes al mismo número de compases. Verificado abriéndolo en MuseScore.

Previsto: forma y orquestación a escala sinfónica, groove y humanización, y exportación a LilyPond, partitura SVG y audio.

## Licencia

MIT
