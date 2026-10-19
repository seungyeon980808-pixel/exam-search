# Third-party data

## KTUG Hanyang PUA mapping table

`data/editable/hanyang-pua-data.mjs` is generated from the Korean TeX Users Group
Hanyang PUA Table Project's `hypua2jamocomposed.txt`, mirrored by mete0r/hypua2jamo:

https://github.com/mete0r/hypua2jamo/blob/cf030e6997529a49d67234e2f611f5b9a0af2b34/data/hypua2jamocomposed.txt

Pinned commit: `cf030e6997529a49d67234e2f611f5b9a0af2b34`.
The table's header explicitly places it in the **Public Domain**:
“We do not believe that simple factual data can be copyrighted.
This file is in Public Domain.”

This incorporates only the table, not the separately LGPL-licensed hypua2jamo
library code. The 5,660 mappings use Unicode conjoining jamo (or a precomposed
syllable where one exists) in an indexed pipe-separated table, including empty
slots for unmapped code points.

## rhwp 0.8.7 (exampool/)

`exampool/rhwp/rhwp.js`, `exampool/studio/`, `exampool/editor/` are the rhwp 0.8.7 engine, studio and
editor SDK (https://github.com/edwardkim/rhwp, MIT; see `exampool/studio/LICENSE`, `exampool/studio/LICENSE-FONTS`).
They are used only for documents made with the 5E question frame.

## pdf.js image decoders (vendor/pdfjs/wasm/)

JBIG2, OpenJPEG and QCMS decoders shipped with pdf.js 6.3.289; licenses are in the same folder.

## JSZip, SheetJS (exampool/vendor/)

JSZip (MIT or GPLv3) and SheetJS Community Edition (Apache-2.0), used to read and write HWPX/CFB containers.
