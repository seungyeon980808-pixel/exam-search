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
