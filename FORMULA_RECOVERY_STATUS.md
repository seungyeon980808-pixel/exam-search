# Editable equation recovery — 2026-09-29

Implementation on `codex/expanded-search-public-release`. Public deployment was authorized after local validation; the release includes original-image/rhwp split comparison and equation recovery together. Public post-deployment checks use `EXAM_PUBLIC_QA=1 EXAM_SEARCH_URL=https://seungyeon980808-pixel.github.io/exam-search/ node qa_formula_visual.mjs` without local PDF or manifest interception.

## Changes

- Reused ExamPool glyph semantics and reconstruction concepts; ported recovery into the existing browser/PDF.js/rhwp pipeline. Conversion makes no AI service calls.
- Read math characters at their PDF drawing positions rather than proportionally splitting merged text extraction spans.
- Recover fractions, radicals, subscripts/superscripts, negative fractional powers, sums, integral limits, vectors, overbars and assembled piecewise braces.
- Preserve source lines as editable paragraphs; write native HWPX `eqed` controls, not images of equations. Explicit short-answer items no longer require five fabricated choices.
- Bind font evidence to the actual font subset and normalize Identity suffixes; reject missing/conflicting glyph evidence and unresolved structural tokens.
- Retain visible sequence braces and add paragraph space around tall equations.

## Observed checks

- `npm test`: 89 tests passed, including the geometry runner's 34 scenarios and 7 original-PDF coordinate fixtures. `git diff --check` passed.
- `EXAM_CORPUS_EVIDENCE=/tmp/exam-formula-corpus/verified-all node qa_formula_corpus.mjs`: 133/133 native HWPX reloads, 122/122 equation edit/export/reload checks, 11 documents without math controls, zero page errors. Corpus: 92 mathematics items from the 2026 integrated paper, all 20 Physics I June 2027 items, and 21 cross-science samples.
- Original-PDF comparisons caught and fixed detached sum limits and incorrectly nested integral-bound fractions. Exact expected expressions are asserted in `test_live_pdf_fixtures.mjs`.
- `qa_formula_visual.mjs`: fresh PDF conversion (prepared entries disabled), embedded rhwp display, original-image display and HWPX download observed for fractional powers, radicals, limits, piecewise functions, sums, integral bounds and a physics fraction example.
- `npm run qa:editable` and `npm run qa:batch` passed with `EXAM_SEARCH_URL=http://127.0.0.1:8813/` and `EXAM_PDF_DIR=/Users/parkseungyeon/Documents/Codex/2026-09-06/x20/exam-search-public/pdfs`; mobile/desktop, editing, download, cancellation, retries and error handling remained functional.

## Reproduction and evidence

Start a static server in this checkout on port 8813. `qa_formula_corpus.mjs` defaults to that URL, snapshots converter sources, routes PDF requests to local original files, and blocks unrelated external network requests. Set `EXAM_CORPUS_EVIDENCE` to a new directory per run; existing evidence is not overwritten. `EXAM_CORPUS_IDS` accepts comma-separated question IDs.

Evidence: `/tmp/exam-formula-corpus/verified-all/{manifest,results,summary}.json`, source snapshots and generated HWPX files. Screenshots/downloads: `/tmp/exam-formula-visual-verified/`. Earlier baseline: 77 returned structures / 56 failures out of the same 133 items; a returned structure alone was not an equation-correctness assertion.

`tools/build_formula_fixtures.mjs` builds clipped-coordinate regression inputs from captured raw JSON. Its generated fixture maps test geometry only; production glyph identity is independently covered by `test_live_fonts.mjs` and live corpus checks.

## Limits

The 19,760-item library has not been fully converted or semantically checked. Successful export does not prove every symbol in every document is correct. The selected original comparisons and exact expression regressions cover the failure families investigated here. Image-only formulas, unreadable text layers, unsupported fonts and ambiguous structures may still require additional recovery. Figures/tables remain omitted under the existing text-and-editable-equations scope. No PDF sharing permissions were changed.
