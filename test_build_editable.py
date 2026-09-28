# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest>=9"]
# ///
# ─── How to run ───
# uv run test_build_editable.py

from __future__ import annotations

from hashlib import sha256
from pathlib import Path

import pytest

from tools.build_editable import (
    check_equation_font, classify_layout_failure, content_runs, merge_manifest,
    select_question_ids,
)


def test_batch_updates_keep_existing_prepared_questions() -> None:
    existing = {
        "p1_2027_06_06": {
            "status": "needs_review",
            "file": "./data/editable/p1_2027_06_06.hwpx",
        },
    }
    updates = {"p2_2018_06_15": {"status": "unavailable", "reason": "문항 경계 없음"}}

    result = merge_manifest(existing, updates)

    assert set(result) == {"p1_2027_06_06", "p2_2018_06_15"}
    assert result["p1_2027_06_06"] == existing["p1_2027_06_06"]
    assert existing == {"p1_2027_06_06": {
        "status": "needs_review", "file": "./data/editable/p1_2027_06_06.hwpx",
    }}


def test_all_mode_selects_every_indexed_question_without_duplicate_ids() -> None:
    question_ids = ["first", "second"]

    assert select_question_ids(question_ids, [], all_questions=True) == ["first", "second"]
    assert select_question_ids(question_ids, ["second", "second"], all_questions=False) == ["second"]


def test_batch_failure_does_not_replace_an_existing_editable_document() -> None:
    existing = {"p1_2027_06_06": {
        "status": "needs_review", "source": "./data/editable/prepared/p1_2027_06_06.json",
    }}
    updates = {"p1_2027_06_06": {
        "status": "unavailable", "reason": "이 Mac에 수식 검증 글꼴이 없음",
    }}

    assert merge_manifest(existing, updates)["p1_2027_06_06"] == existing["p1_2027_06_06"]


def test_equation_font_override_requires_the_exact_verified_digest(tmp_path: Path) -> None:
    font = tmp_path / "HYHWPEQ.TTF"
    font.write_bytes(b"test font")

    with pytest.raises(ValueError, match="SHA-256"):
        check_equation_font(font, "0" * 64)
    assert check_equation_font(font, sha256(b"test font").hexdigest()) == font.resolve()


@pytest.mark.parametrize("source", [
    "① 정답 (cid:42) 입니다.",
    "② \\page-2-item-6-choice-2\\",
    "③ 온도는 \ue034이다.",
])
def test_unresolved_pdf_content_cannot_become_editable_text(source: str) -> None:
    with pytest.raises(ValueError, match="복원되지 않은"):
        content_runs(source, lambda _: [])


def test_missing_equation_font_is_not_reported_as_a_question_boundary_failure() -> None:
    category, reason = classify_layout_failure(
        "unverified equation glyphs require manual review: U+E034",
    )

    assert category == "equation_font"
    assert "수식 글꼴" in reason
    assert "문항 경계" not in reason
