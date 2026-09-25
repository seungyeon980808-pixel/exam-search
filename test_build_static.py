from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from build_static import build_file


class BuildFileTest(TestCase):
    def test_zero_page_pdf_is_reported_without_crashing(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "p2_2017_09.pdf"
            source.write_bytes(
                b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
                b"2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\n"
                b"trailer<</Root 1 0 R>>\n%%EOF"
            )
            for folder in ("pdfs", "cards", "thumbnails"):
                (root / folder).mkdir()
            name, pages, questions = build_file(source, [], root)
            self.assertEqual((name, pages, questions), (source.name, 0, []))
            self.assertFalse((root / "pdfs" / source.name).exists())
