"""Separacion en pistas con Demucs (Meta, MIT).

Separar una cancion tarda minutos incluso en una maquina decente, asi que esta
etapa es la que mas justifica la cache del lado TypeScript: se hace una vez por
archivo y todo lo demas trabaja sobre el resultado.

Nota importante sobre lo que esto NO resuelve. Demucs separa en cuatro o seis
pistas (voz, bateria, bajo, resto, y con el modelo de seis tambien guitarra y
piano). Eso NO es separacion por instrumento: un saxo, una trompeta y unas
cuerdas caen todos en "resto", juntos. Pedirle que aisle el saxo de una big
band es pedirle algo que no hace ningun modelo publico hoy.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


def separate_stems(path: Path, out_dir: Path, model: str = "htdemucs") -> dict[str, Any]:
    """Separa el archivo y devuelve la ruta de cada pista."""
    import soundfile
    import torch
    from demucs.apply import apply_model
    from demucs.audio import convert_audio
    from demucs.pretrained import get_model

    separator = get_model(model)
    separator.eval()

    audio, sample_rate = soundfile.read(str(path), dtype="float32", always_2d=True)
    # Demucs espera (canales, muestras) y su propia frecuencia de muestreo.
    waveform = torch.from_numpy(audio.T)
    waveform = convert_audio(waveform, sample_rate, separator.samplerate, separator.audio_channels)

    with torch.no_grad():
        estimated = apply_model(separator, waveform[None], device="cpu", progress=False)[0]

    out_dir.mkdir(parents=True, exist_ok=True)
    stems: dict[str, str] = {}
    for name, tensor in zip(separator.sources, estimated, strict=True):
        destination = out_dir / f"{name}.wav"
        soundfile.write(str(destination), tensor.T.numpy(), separator.samplerate)
        stems[name] = str(destination)

    return {
        "stems": stems,
        "model": model,
        "sampleRate": separator.samplerate,
        "summary": {"stems": list(stems)},
    }
