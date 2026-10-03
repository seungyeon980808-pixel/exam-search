import argparse
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import sys
from typing import TypedDict

import fitz
from fontTools.ttLib import TTFont


class BrowserGlyph(TypedDict):
    codepoint: int
    glyphId: int
    formula: str
    glyfSha256: str
    metrics: list[int]


class BrowserFont(TypedDict):
    fontName: str
    unitsPerEm: int
    glyphs: list[BrowserGlyph]


def font_entries(data: bytes, pairs: set[tuple[int, int]], formulas: dict[int, str]) -> BrowserFont:
    font = TTFont(BytesIO(data))
    locations = font["loca"].locations
    glyphs = font.getTableData("glyf")
    entries = []
    for codepoint, number in sorted(pairs):
        if codepoint not in formulas or not 0 <= number < len(locations) - 1:
            continue
        name = font.getGlyphName(number)
        raw = glyphs[locations[number]:locations[number + 1]]
        if not raw:
            continue
        entries.append({
            "codepoint": codepoint, "glyphId": number,
            "formula": formulas[codepoint],
            "glyfSha256": sha256(raw).hexdigest(),
            "metrics": list(font["hmtx"].metrics[name]),
        })
    return {"fontName": "HyhwpEQ", "unitsPerEm": font["head"].unitsPerEm,
            "glyphs": entries}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path)
    parser.add_argument("--audited-font", type=Path)
    parser.add_argument("--math-pdf", type=Path)
    parser.add_argument("--reference", type=Path,
                        default=Path(__file__).resolve().parents[1] / "data/editable/glyph-proofs.json")
    parser.add_argument("--proofs", type=Path,
                        default=Path(__file__).with_name("embedded-font-proofs.json"))
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).resolve().parents[1] / "data/editable/glyph-proofs.json")
    parser.add_argument("--pdf-root", type=Path)
    parser.add_argument("--exampool-root", type=Path)
    args = parser.parse_args()
    reference_catalog = json.loads(args.reference.read_text(encoding="utf-8"))["fonts"] if args.reference.exists() else []
    audited = json.loads(args.proofs.read_text(encoding="utf-8"))["fonts"]
    embedded = {}
    if args.audited_font:
        data = args.audited_font.read_bytes()
        embedded[sha256(data).hexdigest()] = data
    if args.pdf:
      with fitz.open(args.pdf) as document:
        for page in document:
            for reference, _, _, name, *_ in page.get_fonts(full=True):
                if not any(font["font_name"] == name.rsplit("+", 1)[-1] for font in audited):
                    continue
                data = bytes(document.extract_font(reference)[3])
                embedded[sha256(data).hexdigest()] = data
    result = []
    for proof in audited:
        data = embedded.get(proof["sha256"])
        if data is None:
            raise ValueError(f"Audited font was not found in the PDF: {proof['font_name']}")
        font = TTFont(BytesIO(data))
        glyphs = font.getTableData("glyf")
        locations = font["loca"].locations
        entries = []
        for glyph in proof["glyphs"]:
            number = glyph["glyph_id"]
            raw = glyphs[locations[number]:locations[number + 1]]
            entries.append({
                "codepoint": glyph["codepoint"], "glyphId": number,
                "formula": glyph["formula"],
                "glyfSha256": sha256(raw).hexdigest(), "metrics": glyph["metrics"],
            })
        result.append({"fontName": proof["font_name"],
                       "unitsPerEm": proof["units_per_em"], "glyphs": entries})
    if args.pdf_root:
        if not args.exampool_root:
            parser.error("--pdf-root requires --exampool-root")
        sys.path.insert(0, str(args.exampool_root))
        from app.pdf_hwp_equation_glyphs import GLYPH_MAPPINGS, STRUCTURAL_GLYPH_PROOFS
        from app.pdf_hwp_font_trace import trace_font_glyphs

        formulas = {codepoint: mapping.formula for codepoint, mapping in
                    {**GLYPH_MAPPINGS, **STRUCTURAL_GLYPH_PROOFS}.items()}
        signatures = {(entry["codepoint"], entry["glyfSha256"],
                       tuple(entry["metrics"])) for font in result for entry in font["glyphs"]}
        source_fonts = {}
        for path in sorted(args.pdf_root.glob("*.pdf")):
            with fitz.open(path) as document:
                for page in document:
                    fonts = {}
                    for reference, _, _, name, *_ in page.get_fonts(full=True):
                        if name.split("+")[-1].split("-Identity-")[0] != "HyhwpEQ":
                            continue
                        data = bytes(document.extract_font(reference)[3])
                        digest = sha256(data).hexdigest()
                        fonts[digest] = data
                    if not fonts:
                        continue
                    if len(fonts) == 1:
                        digest = next(iter(fonts))
                        occurrences = [(digest, char[0], char[1])
                                       for span in page.get_texttrace()
                                       if span["font"].split("+")[-1].split("-Identity-")[0] == "HyhwpEQ"
                                       for char in span["chars"]]
                    else:
                        occurrences = [(glyph.font_sha256, glyph.codepoint, glyph.glyph_id)
                                       for glyph in trace_font_glyphs(page) or ()]
                    for digest, codepoint, glyph_id in occurrences:
                        if digest not in fonts or codepoint not in formulas:
                            continue
                        if digest not in source_fonts:
                            source_fonts[digest] = (fonts[digest], set())
                        source_fonts[digest][1].add((codepoint, glyph_id))
        for data, pairs in source_fonts.values():
            entry = font_entries(data, pairs, formulas)
            unique = []
            for glyph in entry["glyphs"]:
                signature = (glyph["codepoint"], glyph["glyfSha256"],
                             tuple(glyph["metrics"]))
                # A trace codepoint is only an observation, not semantic proof.
                # Additional subsets must reproduce an already audited outline.
                known = any(
                    proof["formula"] == glyph["formula"]
                    and proof["glyfSha256"] == glyph["glyfSha256"]
                    and proof["metrics"] == glyph["metrics"]
                    and font["unitsPerEm"] == entry["unitsPerEm"]
                    for font in [*result, *reference_catalog] for proof in font["glyphs"]
                )
                if known and signature not in signatures:
                    signatures.add(signature)
                    unique.append(glyph)
            if unique:
                entry["glyphs"] = unique
                result.append(entry)
    if args.math_pdf:
        if not args.exampool_root:
            parser.error("--math-pdf requires --exampool-root")
        sys.path.insert(0, str(args.exampool_root))
        from app.pdf_hwp_equation_glyphs import GLYPH_MAPPINGS, STRUCTURAL_GLYPH_PROOFS
        # All nonempty mappings below were checked against the rendered 2026
        # math font specimen. The digest pins the glyph numbering to that font.
        formulas = {cp: mapping.formula for cp, mapping in
                    {**GLYPH_MAPPINGS, **STRUCTURAL_GLYPH_PROOFS}.items()}
        formulas.update({0xE002: "C", 0xE017: "X", 0xE04B: r"\{",
                         0xE04C: r"\}", 0xE05B: r"\int", 0xE067: r"\sum",
                         0xE078: r"\braceTop", 0xE079: r"\braceMiddle",
                         0xE07A: r"\braceBottom", 0xE07B: r"\braceExtender"})
        audited_sha = "946993bda48a3dcf67efededdfd76f6c4fd9891523b419f4be734caa7fa17189"
        observed = {0xE000, 0xE001, 0xE002, 0xE005, 0xE012, 0xE013, 0xE017, 0xE019,
                    *range(0xE034, 0xE03E), *range(0xE044, 0xE049), 0xE04B, 0xE04C,
                    0xE04F, 0xE052, 0xE053, 0xE055, 0xE056, 0xE05B, 0xE05C, 0xE067,
                    0xE06D, 0xE06E, *range(0xE078, 0xE07C), 0xE0A4, 0xE0AC, *range(0xE0E5, 0xE0EE),
                    *range(0xE0EF, 0xE0F3), 0xE0F4, 0xE0F5, 0xE0F7, 0xE0F8,
                    0xE0FA, 0xE0FC, 0xE0FD, 0xE0FE, 0xE101}
        with fitz.open(args.math_pdf) as document:
            found = False
            for page in document:
                for reference, *_ in page.get_fonts(full=True):
                    data = bytes(document.extract_font(reference)[3])
                    if sha256(data).hexdigest() != audited_sha or found:
                        continue
                    result.append(font_entries(data, {(cp, cp - 57095) for cp in observed}, formulas))
                    found = True
            if not found:
                parser.error("The visually audited 2026 math font is absent")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"schema": "exam-glyph-proofs-v1", "fonts": result},
                                      ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
