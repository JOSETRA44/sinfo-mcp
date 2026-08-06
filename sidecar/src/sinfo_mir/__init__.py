"""sinfo-mir: sidecar de analisis musical para sinfo-mcp.

Aqui no se importa nada pesado. Quien necesite un modelo lo carga desde su
propio modulo, cuando de verdad va a usarlo.
"""

from .capabilities import VERSION, describe

__all__ = ["VERSION", "describe"]
