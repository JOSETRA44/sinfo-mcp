"""Seguimiento de pulso con Beat This! (Foscarin, Schluter y Widmer, ISMIR 2024).

Se importa aqui dentro y no arriba del todo a proposito: `cli.py` solo carga
este modulo cuando de verdad se pide un analisis de pulso. Importar torch tarda
varios segundos, y `describe` tiene que responder al instante.

Sobre la eleccion del modelo: la libreria que todo el mundo usa por costumbre
para esto es madmom, y seria un error. Su codigo es BSD pero sus pesos
preentrenados son CC BY-NC-SA, es decir, de uso no comercial, y quien montara
algo encima se lo encontraria demasiado tarde. Beat This! es MIT en codigo y en
pesos, y ademas rinde mejor.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


def track_beats(path: Path, checkpoint: str = "final0") -> dict[str, Any]:
    """Devuelve pulsos y tiempos fuertes en segundos."""
    from beat_this.inference import File2Beats

    # `dbn=False` usa el postproceso propio del modelo. El articulo muestra que
    # iguala o supera al filtrado dinamico clasico y evita arrastrar madmom,
    # que es de donde venia esa pieza.
    detector = File2Beats(checkpoint_path=checkpoint, dbn=False)
    beats, downbeats = detector(str(path))

    beat_times = [float(value) for value in beats]
    downbeat_times = [float(value) for value in downbeats]

    return {
        "beats": beat_times,
        "downbeats": downbeat_times,
        "model": f"beat_this:{checkpoint}",
        "summary": {
            "beats": len(beat_times),
            "downbeats": len(downbeat_times),
            "tempo": _mean_tempo(beat_times),
        },
    }


def _mean_tempo(beats: list[float]) -> float | None:
    """Tempo medio de extremo a extremo, no promediando intervalos.

    Un pulso mal detectado en medio no altera el resultado: solo cuentan el
    primero y el ultimo.
    """
    if len(beats) < 2:
        return None
    span = beats[-1] - beats[0]
    if span <= 0:
        return None
    return round((len(beats) - 1) / span * 60, 2)
