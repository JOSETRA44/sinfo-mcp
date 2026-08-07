"""Interfaz de linea de ordenes del sidecar.

Un proceso por etapa, sin estado, y toda la comunicacion en JSON por la salida
estandar. Se eligio asi frente a un servidor vivo por tres razones concretas:
un fallo de un modelo no arrastra al servidor MCP, no hay procesos zombis que
limpiar en Windows, y cada etapa se puede lanzar a mano desde una terminal para
ver que devuelve, que es la diferencia entre poder depurar esto y no poder.

El coste es cargar el modelo en cada llamada. Lo compensa la cache del lado
TypeScript: la separacion de una cancion se hace una vez y se reaprovecha.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path
from typing import Any, Callable

from .capabilities import VERSION, available, describe


class SidecarError(Exception):
    """Fallo con codigo estable, para que el lado TypeScript no lea mensajes."""

    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


def _emit(payload: dict[str, Any]) -> None:
    """Todo lo que se comunica va por stdout como una sola linea de JSON."""
    json.dump(payload, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.stdout.flush()


def _require(stage: str) -> None:
    """Falla con instrucciones si a la etapa le faltan sus dependencias."""
    capability = available(stage)
    if capability is None or not capability.available:
        raise SidecarError(
            "CAPABILITY_MISSING",
            f"La etapa '{stage}' no esta disponible: {capability.reason if capability else 'desconocida'}",
            stage=stage,
            install=capability.install if capability else None,
        )


def _input_path(value: str) -> Path:
    path = Path(value)
    if not path.is_file():
        raise SidecarError("INPUT_NOT_FOUND", f"No existe el archivo de entrada: {value}", path=value)
    return path


def _write_result(destination: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    """Escribe el resultado y devuelve un resumen para stdout.

    El resultado gordo va a un archivo y por stdout solo viaja un resumen: una
    transcripcion de cinco minutos son decenas de miles de notas, y meterlas
    por una tuberia es lento y fragil.
    """
    if destination is None:
        return payload
    out = Path(destination)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return {"out": str(out), "summary": payload.get("summary", {})}


# --------------------------------------------------------------- subcomandos


def _cmd_describe(_: argparse.Namespace) -> dict[str, Any]:
    return describe()


def _cmd_decode(args: argparse.Namespace) -> dict[str, Any]:
    _require("decode")
    from .decode import decode_audio

    path = _input_path(args.input)
    return decode_audio(path, Path(args.out), args.sample_rate)


def _cmd_fetch(args: argparse.Namespace) -> dict[str, Any]:
    _require("fetch")
    from .fetch import fetch_audio

    return fetch_audio(args.url, Path(args.out))


def _cmd_beats(args: argparse.Namespace) -> dict[str, Any]:
    _require("beats")
    from .beats import track_beats

    path = _input_path(args.input)
    result = track_beats(path)
    return _write_result(args.out, result)


def _cmd_separate(args: argparse.Namespace) -> dict[str, Any]:
    _require("separate")
    from .separate import separate_stems

    path = _input_path(args.input)
    result = separate_stems(path, Path(args.out), model=args.model)
    return result


def _cmd_notes(args: argparse.Namespace) -> dict[str, Any]:
    _require("notes")
    from .notes import transcribe

    path = _input_path(args.input)
    result = transcribe(
        path,
        instrument=args.instrument,
        minimum_frequency=args.min_freq,
        maximum_frequency=args.max_freq,
    )
    return _write_result(args.out, result)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sinfo-mir",
        description="Sidecar de analisis musical para sinfo-mcp.",
    )
    parser.add_argument("--version", action="version", version=VERSION)
    subcommands = parser.add_subparsers(dest="command", required=True)

    described = subcommands.add_parser(
        "describe", help="Que modelos hay instalados y que falta. Nunca falla."
    )
    described.set_defaults(handler=_cmd_describe)

    fetch = subcommands.add_parser("fetch", help="Descarga el audio de una URL.")
    fetch.add_argument("--url", required=True)
    fetch.add_argument("--out", required=True, help="Carpeta de destino.")
    fetch.set_defaults(handler=_cmd_fetch)

    decode = subcommands.add_parser(
        "decode", help="Convierte cualquier formato de audio en un WAV mono."
    )
    decode.add_argument("--input", required=True)
    decode.add_argument("--out", required=True)
    decode.add_argument("--sample-rate", type=int, default=None, dest="sample_rate")
    decode.set_defaults(handler=_cmd_decode)

    beats = subcommands.add_parser("beats", help="Pulso, tiempos fuertes y tempo.")
    beats.add_argument("--input", required=True)
    beats.add_argument("--out", default=None)
    beats.set_defaults(handler=_cmd_beats)

    separate = subcommands.add_parser("separate", help="Separacion en pistas.")
    separate.add_argument("--input", required=True)
    separate.add_argument("--out", required=True, help="Carpeta de destino.")
    separate.add_argument("--model", default="htdemucs")
    separate.set_defaults(handler=_cmd_separate)

    notes = subcommands.add_parser("notes", help="Transcripcion a notas.")
    notes.add_argument("--input", required=True)
    notes.add_argument("--out", default=None)
    notes.add_argument(
        "--instrument",
        default=None,
        help="Instrumento declarado. Acota el registro y evita errores de octava.",
    )
    # Acotar el rango de busqueda DENTRO del modelo es mucho mejor que corregir
    # despues: una octava mal detectada que cae dentro del rango fisico del
    # instrumento ya no se puede distinguir de una nota buena a posteriori.
    notes.add_argument("--min-freq", type=float, default=None, dest="min_freq")
    notes.add_argument("--max-freq", type=float, default=None, dest="max_freq")
    notes.set_defaults(handler=_cmd_notes)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    handler: Callable[[argparse.Namespace], dict[str, Any]] = args.handler

    try:
        _emit({"ok": True, "result": handler(args)})
        return 0
    except SidecarError as error:
        _emit({"ok": False, "error": {"code": error.code, "message": error.message, **error.details}})
        return 2
    except Exception as error:  # noqa: BLE001
        # Cualquier fallo inesperado sale igualmente como JSON. Si se dejara
        # escapar la traza por stderr sin mas, el lado TypeScript solo veria un
        # codigo de salida y no podria explicar nada al usuario.
        _emit(
            {
                "ok": False,
                "error": {
                    "code": "INTERNAL",
                    "message": str(error) or error.__class__.__name__,
                    "type": error.__class__.__name__,
                },
            }
        )
        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
