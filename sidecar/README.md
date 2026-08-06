# sinfo-mir

Sidecar de análisis musical para [sinfo-mcp](../). Aporta lo que no se puede hacer sin modelos entrenados: **transcripción polifónica**, **seguimiento de pulso** y **separación en pistas**.

Es **opcional**. Sin él, el servidor sigue importando MIDI y transcribiendo audio monofónico —una voz, un saxo, una flauta— con su propio detector en TypeScript. Lo que el sidecar añade es la polifonía y el tempo automático.

## Por qué un proceso aparte

Los modelos de audio son Python y pesan gigabytes. Meterlos dentro del servidor MCP habría convertido una herramienta que se instala con `npx` en una que necesita un entorno de Python funcionando. La frontera es estrecha a propósito: argumentos de línea de órdenes hacia allá, una línea de JSON hacia acá.

Un proceso por etapa, sin estado. Un modelo que se cae no arrastra al servidor, no quedan procesos zombis, y cada etapa se puede lanzar a mano desde una terminal para ver qué devuelve.

## Instalación

```bash
uv tool install 'sinfo-mir[all]'
```

O solo lo que necesites, que es bastante más ligero:

```bash
uv tool install 'sinfo-mir[notes]'      # transcripción polifónica
uv tool install 'sinfo-mir[beats]'      # pulso y compás
uv tool install 'sinfo-mir[separate]'   # separación en pistas
```

El servidor lo busca en el `PATH` como `sinfo-mir`, o donde apunte la variable `SINFO_MIR`.

**No se descarga solo.** El servidor nunca invoca `uvx` ni trae nada de PyPI por su cuenta: que una herramienta ejecute código que no le pediste tiene que ser una decisión tuya.

## Uso

```bash
sinfo-mir describe                                     # qué hay instalado
sinfo-mir beats    --input a.wav --out beats.json
sinfo-mir notes    --input a.wav --out notes.json --instrument alto_sax
sinfo-mir separate --input a.wav --out stems/
```

`describe` **nunca falla**: sin ningún modelo instalado responde igual, diciendo qué falta y cómo instalarlo. Es lo que permite al servidor explicar sus límites en vez de descubrirlos estrellándose.

Todo sale por la salida estándar como JSON, con `ok: true` y el resultado, o `ok: false` y un error con código estable.

## Modelos y licencias

| Etapa | Modelo | Licencia |
|---|---|---|
| `beats` | [Beat This!](https://github.com/CPJKU/beat_this) (ISMIR 2024) | MIT, código **y** pesos |
| `separate` | [Demucs](https://github.com/facebookresearch/demucs) (Meta) | MIT |
| `notes` | [Basic Pitch](https://github.com/spotify/basic-pitch) (Spotify) | Apache-2.0 |

> **Sobre madmom.** Es la librería que todo el mundo usa por inercia para seguir el pulso, y sería un error. Su código es BSD pero **sus pesos preentrenados son CC BY-NC-SA: uso no comercial**. Quien construyera algo encima se lo encontraría demasiado tarde. Beat This! es MIT en ambos y además rinde mejor.

## Lo que esto no resuelve

Demucs separa en cuatro o seis pistas (voz, batería, bajo, resto; con el modelo de seis también guitarra y piano). **Eso no es separación por instrumento**: un saxo, una trompeta y unas cuerdas caen todos juntos en «resto». Aislar el saxo de una big band no lo hace ningún modelo público hoy.

Distinguir timbres parecidos en polifonía sigue siendo un problema abierto, señalado por su nombre en los resultados del AMT Challenge 2025. Por eso el diseño pregunta el instrumento en vez de adivinarlo: es lo mismo que hacen los transcriptores comerciales.
