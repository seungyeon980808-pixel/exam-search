from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory
from typing import TypedDict


class Run(TypedDict):
    kind: str
    value: str
    script: str


class Block(TypedDict):
    role: str
    label: str
    runs: list[Run]


FORMULA_START = "\\수식{"
WHITESPACE = re.compile(r"\s+")
CHOICE_LABELS = "①②③④⑤"


def balanced_group(source: str, start: int) -> tuple[str, int]:
    depth = 0
    for index in range(start, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[start + 1:index], index + 1
    raise ValueError("닫히지 않은 수식 중괄호")


def exam_pool_hwp_equation(source: str) -> str:
    value = source.strip()
    for _ in range(12):
        match = re.search(r"\\?frac\s*\{", value)
        if match is None:
            break
        numerator, after_numerator = balanced_group(value, match.end() - 1)
        denominator_start = after_numerator
        while denominator_start < len(value) and value[denominator_start].isspace():
            denominator_start += 1
        denominator, after_denominator = balanced_group(value, denominator_start)
        replacement = "{" + exam_pool_hwp_equation(numerator) + "} over {" + exam_pool_hwp_equation(denominator) + "}"
        value = value[:match.start()] + replacement + value[after_denominator:]
    value = re.sub(r"\\?sqrt\s*\{", "sqrt {", value)
    value = re.sub(r"\\?vec\s*\{", "vec {", value)
    return re.sub(r"\\([A-Za-z]+)", r"\1", value)


def content_runs(value: str, validate_formula_source) -> list[Run]:
    runs: list[Run] = []
    offset = 0
    value = value.replace("`", "").strip()
    while offset < len(value):
        start = value.find(FORMULA_START, offset)
        if start < 0:
            tail = WHITESPACE.sub(" ", value[offset:])
            if tail:
                runs.append({"kind": "text", "value": tail, "script": ""})
            break
        plain = WHITESPACE.sub(" ", value[offset:start])
        if plain:
            runs.append({"kind": "text", "value": plain, "script": ""})
        source, offset = balanced_group(value, start + len(FORMULA_START) - 1)
        errors = validate_formula_source(source)
        if errors:
            raise ValueError("; ".join(errors))
        runs.append({"kind": "equation", "value": source, "script": exam_pool_hwp_equation(source)})
    return runs


def add_block(blocks: list[Block], role: str, label: str, value: str, validate_formula_source) -> None:
    runs = content_runs(value, validate_formula_source)
    if runs:
        blocks.append({"role": role, "label": label, "runs": runs})


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare editable question content with ExamPool.")
    parser.add_argument("--exampool-root", type=Path, required=True)
    parser.add_argument("--pdf-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("data/editable"))
    parser.add_argument("ids", nargs="+")
    args = parser.parse_args()

    questions_path = Path(__file__).resolve().parents[1] / "data/questions.json"
    questions = {item["id"]: item for item in json.loads(questions_path.read_text(encoding="utf-8"))["items"]}
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="exam-editable-") as temp_name:
        temp = Path(temp_name)
        os.environ["LOCALAPPDATA"] = str(temp)
        sys.path.insert(0, str(args.exampool_root.resolve()))
        from app.formula_markup import validate_formula_source
        from app.pdf_hwp_pipeline import build_editable_draft, detect_items
        from app.pdf_hwp_pipeline_models import ConversionUnit, LayoutStyle, UnsupportedDraftLayoutError
        from app.pdf_hwp_roundtrip_structure import PreparedStructureError, parse_prepared_structure

        detections = {}
        manifest: dict[str, dict[str, str]] = {}
        for question_id in args.ids:
            item = questions.get(question_id)
            if item is None:
                raise ValueError(f"색인에 없는 문항 ID: {question_id}")
            pdf = (args.pdf_root / item["pdfFile"]).resolve()
            if not pdf.is_file():
                manifest[question_id] = {"status": "unavailable", "reason": "원본 PDF가 없습니다."}
                continue
            try:
                if pdf not in detections:
                    detections[pdf] = detect_items(pdf)
                detection = detections[pdf]
                candidate = next((entry for entry in detection.items
                                  if entry.item_number == item["no"] and entry.page_number == item["page"]), None)
                if candidate is None:
                    raise ValueError("원본 PDF에서 문항 경계를 찾지 못했습니다.")
                draft = build_editable_draft(pdf, candidate, temp / question_id)
                unit = ConversionUnit(item_number=item["no"], palette_markdown=draft.palette_markdown)
                structure = parse_prepared_structure(
                    unit, candidate.page_number, candidate.bbox, LayoutStyle.SUNEUNG,
                )
                blocks: list[Block] = []
                add_block(blocks, "stem", "", structure.stem, validate_formula_source)
                for material in structure.materials:
                    if not material.value.startswith("\\page-"):
                        add_block(blocks, "material", "", material.value, validate_formula_source)
                add_block(blocks, "ask", "", structure.ask, validate_formula_source)
                for claim in structure.bogi:
                    add_block(blocks, "bogi", claim.label,
                              claim.text.replace(f"{claim.label}.", "", 1), validate_formula_source)
                for index, choice in enumerate(structure.choices):
                    add_block(blocks, "choice", CHOICE_LABELS[index], choice, validate_formula_source)
                if len([block for block in blocks if block["role"] == "choice"]) != 5:
                    raise ValueError("선지 다섯 개가 텍스트로 복원되지 않았습니다.")
                payload = {
                    "schema": "exam-editable-v1", "questionId": question_id,
                    "title": item["title"], "number": item["no"], "sourcePdf": item["pdfFile"],
                    "sourceSha256": detection.source_hash, "page": item["page"],
                    "status": "needs_review", "blocks": blocks,
                    "notes": [*draft.warnings, "그림·도표 이미지는 이 편집본에서 생략했습니다."],
                }
                prepared_path = output / "prepared" / f"{question_id}.json"
                prepared_path.parent.mkdir(parents=True, exist_ok=True)
                prepared_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                manifest[question_id] = {"status": "needs_review", "file": f"./data/editable/{question_id}.hwpx"}
            except UnsupportedDraftLayoutError as error:
                manifest[question_id] = {
                    "status": "unavailable",
                    "reason": "PDF의 문항 경계를 안정적으로 분리하지 못했습니다. 원본 이미지로 확인해 주세요.",
                }
                print(f"{question_id}: {error}", file=sys.stderr)
            except (PreparedStructureError, ValueError, StopIteration) as error:
                manifest[question_id] = {
                    "status": "unavailable",
                    "reason": "문장·선지·수식을 안전하게 복원하지 못했습니다. 원본 이미지로 확인해 주세요.",
                }
                print(f"{question_id}: {error}", file=sys.stderr)
        index = {"schema": "exam-editable-index-v1", "generator": "ExamPool PDF text and equation pipeline",
                 "items": manifest}
        (output / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({key: value["status"] for key, value in manifest.items()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
