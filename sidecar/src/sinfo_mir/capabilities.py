"""Que sabe hacer esta instalacion, y que le falta para lo demas.

La regla que gobierna este modulo: comprobar NUNCA importa el paquete que
comprueba. Se mira si el modulo existe con `find_spec`, que no ejecuta nada.

Importarlos costaria segundos —torch tarda una eternidad en cargar— y, peor,
un paquete a medio instalar reventaria la comprobacion en vez de informar de
que esta a medio instalar. El comando `describe` tiene que responder siempre,
sobre todo cuando algo va mal: es la unica forma de que quien lo llama pueda
explicar al usuario que instalar.
"""

from __future__ import annotations

import importlib.util
import platform
import sys
from dataclasses import dataclass, asdict
from typing import Any

VERSION = "0.1.0"


@dataclass(frozen=True)
class Capability:
    """Una etapa del analisis y su estado."""

    name: str
    available: bool
    backend: str | None = None
    reason: str | None = None
    install: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {key: value for key, value in asdict(self).items() if value is not None}


def _has(module: str) -> bool:
    """Si el modulo se puede importar, sin llegar a importarlo."""
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        # Un paquete roto o a medio desinstalar puede hacer fallar la propia
        # busqueda. Eso es exactamente "no disponible", no un motivo para caer.
        return False


def _capability(name: str, modules: dict[str, str], extra: str) -> Capability:
    """Comprueba varios modulos y explica cual falta."""
    missing = [module for module in modules if not _has(module)]
    if not missing:
        backend = next(iter(modules.values()))
        return Capability(name=name, available=True, backend=backend)

    return Capability(
        name=name,
        available=False,
        reason=f"faltan los paquetes: {', '.join(missing)}",
        install=f"uv pip install 'sinfo-mir[{extra}]'",
    )


def describe() -> dict[str, Any]:
    """Informe completo. Esta funcion no debe poder lanzar excepciones."""
    return {
        "name": "sinfo-mir",
        "version": VERSION,
        "python": platform.python_version(),
        "platform": sys.platform,
        "capabilities": [
            _capability(
                "beats",
                {"beat_this": "beat_this", "torch": "torch", "soundfile": "soundfile"},
                "beats",
            ).to_dict(),
            _capability(
                "separate",
                {"demucs": "demucs", "torch": "torch", "soundfile": "soundfile"},
                "separate",
            ).to_dict(),
            _capability(
                "notes",
                {"basic_pitch": "basic-pitch", "soundfile": "soundfile"},
                "notes",
            ).to_dict(),
        ],
    }


def available(name: str) -> Capability | None:
    """Busca una capacidad concreta en el informe."""
    for entry in describe()["capabilities"]:
        if entry["name"] == name:
            return Capability(**entry)
    return None
