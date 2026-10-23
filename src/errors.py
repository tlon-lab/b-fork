"""Excepciones del dominio de b-fork."""
from __future__ import annotations


class DomainError(Exception):
    """Base para errores del dominio."""


class SourceFailure(DomainError):
    """Se lanza cuando una fuente no pudo recolectarse."""


class FetchError(DomainError):
    """Se lanza cuando la descarga termina con un error HTTP."""

    def __init__(self, status: int) -> None:
        super().__init__(f"HTTP {status}")
        self.status = status
