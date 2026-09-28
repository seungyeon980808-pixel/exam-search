import json
import os
import sys
from pathlib import Path

import pytest


def test_only_audited_outlines_authorize_pdf_glyphs(tmp_path: Path) -> None:
    root = os.environ.get("EXAMPOOL_ROOT")
    pdf = os.environ.get("EXAM_FONT_TEST_PDF")
    if not root or not pdf:
        pytest.skip("Set EXAMPOOL_ROOT and EXAM_FONT_TEST_PDF for the real-PDF test")
    sys.path.insert(0, root)
    from app.pdf_hwp_equation_glyphs import SCOPED_EMBEDDED_GLYPH_PROOFS
    from tools.embedded_fonts import register_embedded_fonts

    registry = Path(__file__).parent / "tools/embedded-font-proofs.json"
    original = dict(SCOPED_EMBEDDED_GLYPH_PROOFS)
    try:
        SCOPED_EMBEDDED_GLYPH_PROOFS.clear()
        assert register_embedded_fonts(registry, Path(pdf)) > 0
        assert any(proof.formula == "m" for proof in SCOPED_EMBEDDED_GLYPH_PROOFS.values())
        altered = json.loads(registry.read_text())
        for font in altered["fonts"]:
            for glyph in font["glyphs"]:
                glyph["outline_sha256"] = "0" * 64
        invalid = tmp_path / "invalid.json"
        invalid.write_text(json.dumps(altered))
        SCOPED_EMBEDDED_GLYPH_PROOFS.clear()
        assert register_embedded_fonts(invalid, Path(pdf)) == 0
        assert not SCOPED_EMBEDDED_GLYPH_PROOFS
    finally:
        SCOPED_EMBEDDED_GLYPH_PROOFS.clear()
        SCOPED_EMBEDDED_GLYPH_PROOFS.update(original)
        sys.path.remove(root)
