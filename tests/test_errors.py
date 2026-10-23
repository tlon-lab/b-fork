"""Tests de la jerarquía de errores del dominio."""
from __future__ import annotations

import unittest

from src.errors import DomainError, FetchError, SourceFailure


class TestErrors(unittest.TestCase):
    def test_source_failure_is_a_domain_error(self):
        self.assertTrue(issubclass(SourceFailure, DomainError))

    def test_fetch_error_is_a_domain_error_and_carries_the_status(self):
        error = FetchError(429)
        self.assertIsInstance(error, DomainError)
        self.assertEqual(error.status, 429)


if __name__ == "__main__":
    unittest.main()
