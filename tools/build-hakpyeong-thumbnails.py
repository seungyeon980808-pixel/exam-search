# /// script
# requires-python = ">=3.12"
# dependencies = ["pymupdf>=1.24,<2", "pillow>=11,<13"]
# ///
"""OmO 작성. 읽기 전용 학평 PDF의 첫 쪽만 기존 420px 썸네일 규격으로 만든다."""
# 실행: uv run tools/build-hakpyeong-thumbnails.py <data-source/index.json> <공유폴더 루트>
import json
import sys
from pathlib import Path

import pymupdf
from PIL import Image

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
source = Path(sys.argv[2])
output = Path(__file__).resolve().parent.parent / "thumbnails"
for index, entry in enumerate(manifest["documents"], 1):
    target = output / (Path(entry["file"]).stem + ".webp")
    with pymupdf.open(source / entry["publicPath"]) as document:
        page = document[0]
        scale = 420 / max(page.rect.width, page.rect.height)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csRGB, alpha=False)
        Image.frombytes("RGB", (pix.width, pix.height), pix.samples).save(target, "WEBP", quality=75, method=4)
    if index % 100 == 0 or index == len(manifest["documents"]):
        print(f"썸네일 {index}/{len(manifest['documents'])}", flush=True)
