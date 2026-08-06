"""Transcripcion polifonica con Basic Pitch (Spotify, Apache-2.0).

Es lo que aporta el sidecar frente al detector YIN que ya lleva el servidor en
TypeScript: aquel da una altura por instante y este da varias a la vez, que es
lo que hace falta para un piano o una guitarra.

El instrumento declarado se usa para acotar el registro. No es cosmetico: los
errores de octava son el fallo mas comun de cualquier transcriptor, y saber que
un contrabajo no llega a do7 los elimina de raiz. Es informacion musical que el
modelo no tiene y el catalogo si.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

# Margen sobre el registro declarado, en semitonos. Un interprete pasa el rango
# comodo de vez en cuando sin que eso sea un error de deteccion.
RANGE_MARGIN = 2


def transcribe(
    path: Path,
    instrument: str | None = None,
    minimum_frequency: float | None = None,
    maximum_frequency: float | None = None,
) -> dict[str, Any]:
    """Devuelve las notas detectadas, en segundos y numero MIDI."""
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict

    _, _, note_events = predict(
        str(path),
        ICASSP_2022_MODEL_PATH,
        minimum_frequency=minimum_frequency,
        maximum_frequency=maximum_frequency,
    )

    notes = [
        {
            "onset": float(start),
            "offset": float(end),
            "midi": int(pitch),
            # Basic Pitch da amplitud 0..1; la convencion MIDI es 1..127.
            "velocity": max(1, min(127, int(round(amplitude * 127)))),
            "confidence": float(min(1.0, max(0.0, amplitude))),
        }
        for start, end, pitch, amplitude, *_ in note_events
        if end > start
    ]
    notes.sort(key=lambda note: (note["onset"], note["midi"]))

    return {
        "notes": notes,
        "model": "basic_pitch:icassp2022",
        **({"instrument": instrument} if instrument else {}),
        "summary": {
            "notes": len(notes),
            "duration": round(max((note["offset"] for note in notes), default=0.0), 3),
        },
    }
