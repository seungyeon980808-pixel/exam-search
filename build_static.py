#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["pymupdf>=1.24,<2", "numpy>=2,<3", "pillow>=11,<13", "typer>=0.12,<1"]
# ///
"""Turn the local exam index and source PDFs into a static site bundle."""

from __future__ import annotations

import json
import re
import shutil
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Annotated, NotRequired, TypedDict

import numpy as np
import pymupdf
import typer
from PIL import Image

PDF_NAME = re.compile(r"^[pbce][12]_\d{4}_(?:06|09|11)\.pdf$")
SCRIPT_DIR = Path(__file__).resolve().parent


class Question(TypedDict):
    id: str
    pdfFile: str
    page: int
    box: list[float]
    displayBox: NotRequired[list[float]]


def content_bottom(page: pymupdf.Page, box: list[float]) -> float:
    """Mirror the local preview's 72-dpi ink threshold and five-point pad."""
    clip = pymupdf.Rect(*box)
    pix = page.get_pixmap(
        matrix=pymupdf.Matrix(1, 1), clip=clip, colorspace=pymupdf.csGRAY, alpha=False
    )
    pixels = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    edge = max(1, int(np.ceil(pix.width * 0.05)))
    center = pixels[:, edge : pix.width - edge]
    minimum_ink = max(3, int(np.ceil(pix.width * 0.005)))
    ink_rows = np.flatnonzero(np.count_nonzero(center < 245, axis=1) >= minimum_ink)
    if not ink_rows.size:
        return box[3]
    return min(box[3], box[1] + float(ink_rows[-1]) + 5)


def save_webp(pix: pymupdf.Pixmap, target: Path, quality: int) -> None:
    image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    image.save(target, "WEBP", quality=quality, method=4)


def build_file(
    path: Path, items: list[Question], output_dir: Path
) -> tuple[str, int, list[Question]]:
    with pymupdf.open(path) as doc:
        if len(doc) == 0:
            return path.name, 0, items
        thumbnail = output_dir / "thumbnails" / f"{path.stem}.webp"
        if not thumbnail.exists():
            first = doc[0]
            scale = 420 / max(first.rect.width, first.rect.height)
            save_webp(
                first.get_pixmap(
                    matrix=pymupdf.Matrix(scale, scale),
                    colorspace=pymupdf.csRGB,
                    alpha=False,
                ),
                thumbnail,
                75,
            )
        for item in items:
            card = output_dir / "cards" / f"{item['id']}.webp"
            page = doc[item["page"] - 1]
            box = item["box"]
            bottom = content_bottom(page, box)
            display_box = [box[0], box[1], box[2], bottom]
            item["displayBox"] = display_box
            if not card.exists():
                pix = page.get_pixmap(
                    matrix=pymupdf.Matrix(2, 2),
                    clip=pymupdf.Rect(*display_box),
                    colorspace=pymupdf.csRGB,
                    alpha=False,
                )
                save_webp(pix, card, 78)
        page_count = len(doc)
    shutil.copy2(path, output_dir / "pdfs" / path.name)
    return path.name, page_count, items


def build(
    pdf_dir: Path,
    index_path: Path,
    output_dir: Path,
    synonyms_path: Path,
    limit_files: int = 0,
) -> None:
    index = json.loads(index_path.read_text(encoding="utf-8"))
    source_files = sorted(
        path
        for path in pdf_dir.iterdir()
        if path.is_file() and PDF_NAME.fullmatch(path.name)
    )
    if limit_files:
        source_files = source_files[:limit_files]
    allowed = {path.name for path in source_files}
    questions: list[Question] = [
        item for item in index["items"] if item["pdfFile"] in allowed
    ]
    by_file: dict[str, list[Question]] = defaultdict(list)
    for item in questions:
        by_file[item["pdfFile"]].append(item)

    for folder in ("data", "pdfs", "cards", "thumbnails"):
        (output_dir / folder).mkdir(parents=True, exist_ok=True)
    files: list[dict[str, str | int]] = []
    with ProcessPoolExecutor(max_workers=6) as pool:
        futures = [
            pool.submit(build_file, path, by_file[path.name], output_dir)
            for path in source_files
        ]
        for number, future in enumerate(as_completed(futures), 1):
            name, page_count, completed_items = future.result()
            if page_count:
                files.append({"pdfFile": name, "pageCount": page_count})
            else:
                typer.echo(f"Skipped unreadable PDF: {name}", err=True)
            by_file[name] = completed_items
            if number % 20 == 0 or number == len(source_files):
                typer.echo(f"{number}/{len(source_files)} PDFs")

    questions = [item for path in source_files for item in by_file[path.name]]
    files.sort(key=lambda item: str(item["pdfFile"]))

    index["items"] = questions
    index["pdfCount"] = len(files)
    index["questionCount"] = len(questions)
    index["incomplete"] = [
        issue for issue in index["incomplete"] if issue["pdfFile"] in allowed
    ]
    (output_dir / "data" / "questions.json").write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    (output_dir / "data" / "files.json").write_text(
        json.dumps(files, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    shutil.copy2(synonyms_path, output_dir / "data" / "synonyms.json")


def main(
    pdf_dir: Annotated[Path, typer.Option(exists=True, file_okay=False)],
    index: Annotated[Path, typer.Option(exists=True, dir_okay=False)],
    synonyms: Annotated[Path, typer.Option(exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option()] = SCRIPT_DIR,
    limit_files: Annotated[int, typer.Option(min=0)] = 0,
) -> None:
    build(pdf_dir, index, output, synonyms, limit_files)


if __name__ == "__main__":
    typer.run(main)
