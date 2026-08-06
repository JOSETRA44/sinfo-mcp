"""Decodificacion de audio a WAV mono.

Existe para que el lado TypeScript no tenga que saber leer formatos
comprimidos. Escribir un decodificador de MP3 en JavaScript puro es
desproporcionado, y tirar de una libreria nativa rompia la promesa de
instalacion sin compilar que gobierna todo el proyecto.

La solucion es que lo haga quien ya tiene las herramientas: si el sidecar esta,
sabe leer todo lo que sepa leer libsndfile. Si no esta, el servidor sigue
funcionando solo con WAV y lo dice claramente.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


def decode_audio(path: Path, out: Path, sample_rate: int | None = None) -> dict[str, Any]:
    """Convierte cualquier formato legible en un WAV mono de 16 bits.

    Se remezcla a mono aqui porque la estereofonia es informacion de mezcla, no
    de altura: ningun analisis posterior la usa, y arrastrarla duplicaria el
    tamano del archivo intermedio sin aportar nada.
    """
    import numpy as np
    import soundfile as sf

    data, rate = sf.read(str(path), dtype="float32", always_2d=True)
    mono = data.mean(axis=1)

    if sample_rate is not None and sample_rate != rate:
        import librosa

        mono = librosa.resample(mono, orig_sr=rate, target_sr=sample_rate)
        rate = sample_rate

    out.parent.mkdir(parents=True, exist_ok=True)
    # PCM de 16 bits: lo lee el decodificador propio del lado TypeScript y
    # pesa la mitad que coma flotante, que aqui no aporta precision util.
    sf.write(str(out), mono, rate, subtype="PCM_16")

    peak = float(np.max(np.abs(mono))) if mono.size else 0.0
    return {
        "out": str(out),
        "sampleRate": int(rate),
        "samples": int(mono.size),
        "summary": {
            "duration": round(mono.size / rate, 3) if rate else 0.0,
            "peak": round(peak, 4),
            "sourceFormat": path.suffix.lstrip(".").lower(),
        },
    }
