---
name: sinfo-mcp
description: Compone y transcribe música real con el servidor MCP sinfo — sinfonías, canciones, corales, beats — planeando la forma, escribiendo las voces, verificando armonía y conducción de voces, e importando archivos MIDI existentes como partitura editable. Exporta a MIDI, MusicXML, partitura SVG y audio WAV. Úsala SIEMPRE que aparezcan las herramientas `score_create`, `part_write`, `melody_generate`, `orchestrate`, `harmony_progression` o `import_midi`, y también cuando el usuario pida componer, arreglar, armonizar, orquestar, escribir una melodía, hacer un beat, generar un MIDI o una partitura, o convertir un MIDI en partitura, aunque no mencione "sinfo" ni "MCP". Es imprescindible para no malgastar llamadas: el flujo correcto, la notación SinfoScript y el bucle de verificación no son evidentes desde los esquemas de las herramientas.
---

# Componer con sinfo-mcp

Este servidor te deja componer música de verdad, no fragmentos sueltos. La diferencia clave frente a otras herramientas de MIDI: **la partitura vive en el servidor**. `score_create` devuelve un `scoreId` y todo lo demás muta esa partitura. Nunca reenvías las notas.

Eso es lo que hace posible pasar de ocho compases a una sinfonía sin agotar tu contexto — pero solo si trabajas con el flujo correcto.

## El flujo

Componer de arriba abajo, como un compositor. Saltarse niveles produce música que suena a notas correctas sin dirección.

```
1. score_create        abre la obra: tonalidad, tempo, compás
2. ensemble_add        monta el conjunto de una vez  (o part_add uno a uno)
3. plan_form           reparte la obra en secciones — hazlo si pasa de ~16 compases
4. harmony_progression decide la armonía antes de escribir melodía
5. melody_generate     o part_write, o motif_create + motif_develop
6. orchestrate         reparte el material entre el conjunto
7. VERIFICAR           check_voice_leading + check_ranges + analyze_harmony
8. export              .mid  .musicxml  .svg  .wav
```

**Los pasos 3 y 7 son los que más se olvidan y más valen.** Sin plan formal, a los cuarenta compases no sabes dónde estás. Sin verificación, entregas errores que no puedes ver leyendo tu propia salida.

## Partir de un MIDI que ya existe

`import_midi path:"..."` lee un archivo del disco y devuelve un `scoreId` **normal**. A partir de ahí todo lo demás funciona igual: analizarle la armonía, comprobar rangos, reorquestarlo para otro conjunto, exportarlo. Es la otra forma de empezar una obra.

No es una conversión mecánica. El archivo trae tiempos medidos —y si se grabó tocando, el rubato del intérprete—, así que hay que **decidir** figuras, compás, alteraciones y voces. Esas decisiones vienen en la respuesta:

| Campo | Para qué |
|---|---|
| `warnings` | Lo que se supuso por ti: compás inventado, anacrusa desplazada, tonalidad dudosa |
| `keyMargin` | Margen sobre la segunda tonalidad candidata. **Por debajo de 0,15 no te fíes**: suele ser una mayor confundida con su relativa menor |
| `meanDeviation` | Por pista. Por encima de 0,1 el problema casi siempre está en el pulso, no en las figuras |

**Si algo no cuadra, no vuelvas a importar.** `transcribe_requantize` reaprovecha la lectura y prueba otros parámetros al instante, dejando viva la versión anterior para comparar:

- Salen tresillos donde esperabas semicorcheas → `subdivisions: [1,2,4,8,16]`
- La partitura está plagada de silencios diminutos → `gapPolicy: "legato"`
- Las alteraciones están escritas al revés → impón `key`
- Un 6/8 salió como 3/4 → impón `timeSignature` (miden lo mismo; los tiempos fuertes no los distinguen)

## SinfoScript: la notación

Es el formato de `part_write` y de todo lo que devuelve `part_read`.

```
mf c4/q e4/q g4/h | a4/e. g4/s f4/q+stacc r/q
```

| Sintaxis | Significado |
|---|---|
| `c4/q` | altura + `/` + figura. `c4` es el do central |
| `w h q e s t x` | redonda, blanca, negra, corchea, semicorchea, fusa, semifusa |
| `q.` `q..` | puntillo, doble puntillo |
| `e3` `s5` | tresillo de corchea, quintillo de semicorchea |
| `C#4` `Bb3` `Ebb2` | alteraciones — `#` sostenido, `b` bemol, repetibles |
| `r/h` | silencio |
| `[c4,e4,g4]/h` | acorde |
| `mf` | dinámica suelta; rige hasta la siguiente |
| `c4/q+stacc+accent` | articulaciones |
| `c4/q~ c4/h` | ligadura de unión |
| `\|` | barra de compás |
| `#` tras espacio | comentario |

**Escribe siempre las barras `|`.** El servidor comprueba que cada compás sume los tiempos correctos y rechaza la escritura si no cuadran, diciéndote qué compás falla y por cuánto. Es la red que te evita descubrir el descuadre veinte llamadas después. Si el descuadre es intencionado (una anacrusa), pasa `strictBarlines: false`.

### Percusión y beats: notación de rejilla

```
kick   x...x...x...x...
snare  ....X.......X...
hihat  x.x.x.x.x.x.x.x.
```

Una fila por sonido, una casilla por semicorchea. `x` golpe, `X` acentuado, `o` suave, `.` silencio. Las filas cortas se repiten en bucle contra las largas. El formato se detecta solo: no hace falta declararlo.

## Armonía

Números romanos completos: `I ii V7 vii°7 viiø7 III+ bVII #iv`, inversiones por cifrado de bajo (`I6 I64 V65 V43 V42`) y dominantes secundarias (`V/V`, `V7/IV`).

**No repitas la tonalidad en cada llamada.** Si omites `key`, se toma la de la partitura. Declararla a mano acaba produciendo una melodía en una tonalidad y una armonía en otra sin que nadie lo note.

En modo menor, `V` y `vii°` salen con la sensible alterada automáticamente (en la menor: Mi-Sol♯-Si). No intentes escribir la alteración a mano.

## El bucle de verificación

Esto es lo que separa componer de generar notas. Las tres herramientas detectan errores que **no puedes ver releyendo tu propia salida**, porque no están en ninguna nota sino en la relación entre dos.

- **`check_voice_leading`** — quintas y octavas paralelas (error: funden dos voces en una), más cruces, solapamientos y saltos (avisos). Detecta doblajes en octava y no los cuenta como error, así que sirve igual en un coral a cuatro voces que en una orquesta de treinta.
- **`check_ranges`** — notas fuera del rango del instrumento, **con la transposición aplicada**. Distingue lo imposible (`below-range`, `above-range`) de lo incómodo (`low-strain`, `high-strain`).
- **`analyze_harmony`** — qué función cumple lo que escribiste y dónde hay cadencias. Úsala para comprobar que la progresión que tenías en mente es la que de verdad escribiste.

Llámalas **después de cada sección**, no al final de la obra. Corregir ocho compases es fácil; corregir ciento sesenta, no.

## Reproducibilidad: las semillas

`melody_generate`, `counterpoint_add` y `orchestrate` aceptan `seed`. La misma semilla con los mismos parámetros da **exactamente** el mismo resultado.

Esto cambia cómo debes trabajar: **apunta la semilla que devuelve cada llamada**. Si una melodía te gusta pero quieres otro contorno, repite la llamada con la misma `seed` cambiando solo `contour` — el ritmo se mantiene y solo cambia lo que pediste. Sin eso, cada intento es una tirada nueva y pierdes lo que ya funcionaba.

## Cosas que ahorran llamadas

- **`ensemble_add`** monta una orquesta sinfónica de 30 partes en una llamada. Los ids repetidos se numeran solos (`violin`, `violin2`, `horn4`) — no lleves tú la cuenta.
- **Pasa `partId` a `melody_generate`** y el rango sale de la tesitura del instrumento. No calcules qué notas puede tocar una flauta.
- **`atMeasure`** rellena con silencios hasta ese compás. Una trompa que entra en el 9 se alinea sola con el resto.
- **`motif_create` + `motif_develop`** guardan el material en el servidor con su genealogía. Nueve transformaciones: inversión (tonal y cromática), retrogradación, aumentación, disminución, secuencia, fragmentación, repetición, transposición. Casi todo el repertorio clásico crece así, de células de tres o cuatro notas.
- **`section_list`** te dice en qué compás va cada sección y cuánto queda por componer.

## Verificación visual

`export format:"svg"` graba la partitura como imagen. **Es la única salida que puedes revisar tú directamente** — mírala para comprobar que la notación quedó legible, algo que no se ve en los datos.

`export format:"wav"` sintetiza el audio, pero **tú no puedes oírlo**: es para la persona. Necesita un SoundFont General MIDI configurado en la variable `SINFO_SOUNDFONT`; sin él usa un banco de un solo sonido y el resultado no representa la obra. El propio `export` avisa si sale mudo.

## Groove: interpretación, no notación

`export groove:"swing" humanize:0.3` cambia cómo suena el MIDI y el audio, **no lo que aparece en la partitura**. Es la distinción correcta: un pasaje con swing se escribe con corcheas rectas y el intérprete lo balancea.

Siete grooves: `straight`, `swing`, `shuffle`, `laid_back`, `driving`, `funk`, `waltz`. `humanize` de 0 a 1 — entre 0.2 y 0.4 suena natural; por encima de 0.7 suena a intérprete inseguro.

## Errores frecuentes

**Escribir sin plan formal.** En obras de más de dieciséis compases, `plan_form` primero. Las proporciones y el plan tonal salen solos: el segundo tema de una sonata va a la dominante si la obra está en mayor y al relativo mayor si está en menor.

**Verificar solo al final.** Los errores de conducción de voces se acumulan y corregirlos al final obliga a reescribir secciones enteras.

**Perder las semillas.** Sin apuntarlas no puedes volver a un resultado que te gustó.

**Escribir notas sonantes en instrumentos transpositores.** Las partes llevan alturas **escritas**. Para que un clarinete en Si♭ suene Do4 hay que escribirle Re4. Si usas `melody_generate` con `partId` o `orchestrate`, esto se hace solo; si escribes a mano con `part_write`, tenlo presente y comprueba con `check_ranges`.

**Tratar `orchestrate` como el paso final.** Reparte el material, pero afinar la conducción sigue siendo trabajo de composición: orquesta, verifica, corrige.

## Ejemplo completo

Un vals de 24 compases para cuarteto, compuesto y verificado:

```
score_create      title:"Vals", key:"G major", timeSignature:"3/4", tempo:160
ensemble_add      ensemble:"string_quartet"
plan_form         form:"ternary", totalMeasures:24
harmony_progression  progression:["I","V7","I","IV","I","V7","I"]
melody_generate   partId:"violin", measures:8, progression:["I","V7","I","IV"],
                  contour:"arch", seed:"vals-tema"
orchestrate       sourcePartId:"violin", progression:["I","V7","I","IV"], style:"camara"
check_voice_leading
check_ranges
export            format:"svg"                      → mírala
export            format:"midi", groove:"waltz", humanize:0.25
```

Si `check_voice_leading` devuelve errores, corrige con `part_write mode:"replace"` sobre la parte concreta y vuelve a verificar. Ese ciclo —componer, verificar, corregir— es el que produce música que se sostiene.
