"""Register visually audited embedded-font identities in ExamPool's verifier."""
from pathlib import Path

import fitz
from pydantic import BaseModel, ConfigDict, Field


class GlyphProof(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    codepoint: int = Field(ge=0xE000, le=0xF8FF)
    glyph_id: int = Field(ge=0)
    formula: str = Field(min_length=1)
    outline_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    metrics: tuple[int, int]


class FontProof(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    font_name: str = Field(min_length=1)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    units_per_em: int = Field(gt=0)
    source: str = Field(min_length=1)
    glyphs: tuple[GlyphProof, ...]


class FontProofs(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    fonts: tuple[FontProof, ...]


def register_embedded_fonts(path: Path, source_pdf: Path) -> int:
    """Match audited outlines and metrics, then bind authorization to each PDF font/glyph."""
    from app.pdf_hwp_equation_glyphs import (
        GlyphMapping, SCOPED_EMBEDDED_GLYPH_PROOFS,
    )
    from app.pdf_hwp_font_trace import trace_font_glyphs
    from app.pdf_hwp_font_view import font_view

    proofs = FontProofs.model_validate_json(path.read_bytes())
    signatures = {
        (font.font_name, glyph.outline_sha256, glyph.metrics, font.units_per_em): GlyphMapping(
            glyph.codepoint, glyph.formula, "audited-embedded-font", (font.source,),
        )
        for font in proofs.fonts
        for glyph in font.glyphs
    }
    entries = {}
    with fitz.open(source_pdf) as document:
        for page in document:
            views = {}
            for font in page.get_fonts(full=True):
                if font[3].rsplit("+", 1)[-1].split("-Identity-", 1)[0] != "HyhwpEQ":
                    continue
                data = bytes(document.extract_font(font[0])[3])
                if data:
                    view = font_view(data)
                    views[view.sha256] = view
            for glyph in trace_font_glyphs(page) or ():
                view = views.get(glyph.font_sha256)
                if view is None or not 0xE000 <= glyph.codepoint <= 0xF8FF:
                    continue
                signature = (glyph.font_name, view.digest(glyph.glyph_id),
                             view.metric(glyph.glyph_id), view.font["head"].unitsPerEm)
                proof = signatures.get(signature)
                if proof is not None:
                    entries[(glyph.codepoint, glyph.font_name, glyph.font_sha256, glyph.glyph_id)] = GlyphMapping(
                        glyph.codepoint, proof.formula, proof.mapping_source, proof.proof,
                    )
    SCOPED_EMBEDDED_GLYPH_PROOFS.update(entries)
    return len(entries)
