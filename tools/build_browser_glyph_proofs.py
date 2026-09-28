import argparse
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import sys

import fitz
from fontTools.ttLib import TTFont


def font_entries(data: bytes, pairs: set[tuple[int, int]], formulas: dict[int, str]) -> dict:
    font = TTFont(BytesIO(data))
    locations = font["loca"].locations
    glyphs = font.getTableData("glyf")
    entries = []
    for codepoint, number in sorted(pairs):
        if codepoint not in formulas or number >= len(locations) - 1:
            continue
        name = font.getGlyphName(number)
        raw = glyphs[locations[number]:locations[number + 1]]
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
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--proofs", type=Path,
                        default=Path(__file__).with_name("embedded-font-proofs.json"))
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).resolve().parents[1] / "data/editable/glyph-proofs.json")
    parser.add_argument("--pdf-root", type=Path)
    parser.add_argument("--exampool-root", type=Path)
    args = parser.parse_args()
    audited = json.loads(args.proofs.read_text(encoding="utf-8"))["fonts"]
    with fitz.open(args.pdf) as document:
        embedded = {}
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

        formulas = {codepoint: mapping.formula for codepoint, mapping in
                    {**GLYPH_MAPPINGS, **STRUCTURAL_GLYPH_PROOFS}.items()}
        signatures = {(entry["codepoint"], entry["glyfSha256"],
                       tuple(entry["metrics"])) for font in result for entry in font["glyphs"]}
        source_fonts = {}
        for path in sorted(args.pdf_root.glob("*.pdf")):
            with fitz.open(path) as document:
                pairs = set()
                fonts = {}
                for page in document:
                    for span in page.get_texttrace():
                        if span["font"].split("+")[-1] == "HyhwpEQ":
                            pairs.update((char[0], char[1]) for char in span["chars"]
                                         if char[0] in formulas)
                    for reference, _, _, name, *_ in page.get_fonts(full=True):
                        if name.split("+")[-1] != "HyhwpEQ":
                            continue
                        data = bytes(document.extract_font(reference)[3])
                        digest = sha256(data).hexdigest()
                        fonts[digest] = data
                for digest, data in fonts.items():
                    if digest not in source_fonts:
                        source_fonts[digest] = (data, set())
                    source_fonts[digest][1].update(pairs)
        for data, pairs in source_fonts.values():
            entry = font_entries(data, pairs, formulas)
            unique = []
            for glyph in entry["glyphs"]:
                signature = (glyph["codepoint"], glyph["glyfSha256"],
                             tuple(glyph["metrics"]))
                if signature not in signatures:
                    signatures.add(signature)
                    unique.append(glyph)
            if unique:
                entry["glyphs"] = unique
                result.append(entry)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"schema": "exam-glyph-proofs-v1", "fonts": result},
                                      ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
