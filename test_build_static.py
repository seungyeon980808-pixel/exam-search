from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

import pymupdf

from build_static import MissingPublicPathError, build, build_file


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

    def test_pdf_is_processed_without_copying_original(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "p2_2018_06.pdf"
            with pymupdf.open() as pdf:
                pdf.new_page()
                pdf.save(source)
            for folder in ("pdfs", "cards", "thumbnails"):
                (root / folder).mkdir()

            name, pages, questions = build_file(source, [], root)

            self.assertEqual((name, pages, questions), (source.name, 1, []))
            self.assertFalse((root / "pdfs" / source.name).exists())

    def test_build_maps_public_path_without_private_drive_id(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source_dir = root / "sources"
            source_dir.mkdir()
            source = source_dir / "p1_2019_09.pdf"
            with pymupdf.open() as pdf:
                _ = pdf.new_page()
                pdf.save(source)
            index = root / "index.json"
            index.write_text(json.dumps({"items": [], "incomplete": []}), encoding="utf-8")
            synonyms = root / "synonyms.json"
            synonyms.write_text('{"map":{}}', encoding="utf-8")
            public_pack = root / "pack.json"
            public_pack.write_text(json.dumps({"paths": {"documents": ["기출문제/물리1/p1_2019_09.pdf"]}}), encoding="utf-8")

            build(source_dir, index, root / "out", synonyms, public_pack)

            files = json.loads((root / "out" / "data" / "files.json").read_text(encoding="utf-8"))
            self.assertEqual(files, [{"pdfFile": source.name, "pageCount": 1, "publicPath": "기출문제/물리1/p1_2019_09.pdf"}])
            self.assertFalse((root / "out" / "pdfs" / source.name).exists())

            public_pack.write_text('{"paths":{"documents":[]}}', encoding="utf-8")
            with self.assertRaises(MissingPublicPathError):
                build(source_dir, index, root / "missing", synonyms, public_pack)
