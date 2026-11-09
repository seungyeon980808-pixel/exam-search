#!/usr/bin/env python3
"""Collect only official KICE science recruitment exam papers, with provenance."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
import hashlib
import json
from pathlib import Path
import re
import time
import unicodedata
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE = 'https://www.kice.re.kr'
SUBJECTS = {'물리': 't_physics', '화학': 't_chemistry', '생물': 't_biology', '지구과학': 't_earth'}


class Board(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.cells, self.cell, self.files, self.board_seq = [], None, None, [], ''

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'tr':
            self.cells, self.files, self.board_seq = [], [], ''
        if self.cells is None:
            return
        if tag == 'td':
            self.cell = []
        if tag == 'a':
            click = attrs.get('onclick', '')
            file = re.search(r"fn_fileDown\('([^']+)'", click)
            board = re.search(r"goView\('1500212','([^']+)'", click)
            if file:
                self.files.append({'originalName': unicodedata.normalize('NFC', attrs.get('title', '')),
                                   'fileSeq': file[1]})
            if board:
                self.board_seq = board[1]

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag == 'td' and self.cell is not None:
            self.cells.append(' '.join(''.join(self.cell).split()))
            self.cell = None
        if tag == 'tr' and self.cells is not None:
            if self.files:
                self.rows.append((self.cells, self.files, self.board_seq))
            self.cells = None


def read(url):
    for attempt in range(4):
        try:
            return urlopen(Request(url, headers={'User-Agent': '5E exam library source collector'}), timeout=40).read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)


def collect(subject, cache):
    found, seen = [], set()
    for page in range(1, 16):
        params = {'boardID': 1500212, 'm': '030306', 's': 'kice', 'searchType': 'S',
                  'searchStr': subject, 'page': page}
        url = BASE + '/boardCnts/list.do?' + urlencode(params)
        file = cache / f'{SUBJECTS[subject]}-{page}.html'
        if file.exists() and 'board-text' not in file.read_text():
            file.rename(file.with_suffix('.invalid.html'))
        if not file.exists():
            for attempt in range(4):
                content = read(url)
                if b'board-text' in content:
                    file.write_bytes(content)
                    break
                time.sleep(attempt + 1)
            else:
                raise ValueError('Official board returned an error: ' + url)
        board = Board()
        board.feed(file.read_text())
        new = [row for row in board.rows if row[2] not in seen]
        if not new:
            break
        for cells, files, seq in new:
            seen.add(seq)
            if len(cells) < 4 or cells[2] != '문제' or subject not in cells[3] or '2차' in cells[3]:
                continue
            year = int(cells[1])
            for attachment in files:
                name = attachment['originalName']
                if not name.lower().endswith('.pdf') or any(word in name for word in ['정답', '해설']):
                    continue
                paper = re.search(r'(?:전공\s*)?([AB])(?:[-_. (]|\.pdf$)', name, re.I)
                paper = paper[1].upper() if paper else 'single'
                pdf = f'{SUBJECTS[subject]}_{year}_{paper}.pdf'
                found.append({**attachment, 'subject': SUBJECTS[subject], 'subjectLabel': subject,
                              'year': year, 'paper': paper, 'pdfFile': pdf,
                              'sourceUrl': BASE + '/boardCnts/fileDown.do?' + urlencode({'fileSeq': attachment['fileSeq']}),
                              'sourcePage': BASE + '/boardCnts/view.do?' + urlencode({'boardID': 1500212, 'boardSeq': seq, 'm': '030306', 's': 'kice'}),
                              'publicPath': f'기출문제/임용기출/{subject}/{pdf}'})
        time.sleep(.12)
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--cache-root', type=Path, required=True)
    args = parser.parse_args()
    args.cache_root.mkdir(parents=True, exist_ok=True)
    args.source_root.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=3) as pool:
        entries = sum(pool.map(lambda s: collect(s, args.cache_root), SUBJECTS), [])
    names = [e['pdfFile'] for e in entries]
    if len(set(names)) != len(names):
        raise ValueError('Duplicate official source names require review')
    print('Official papers:', len(entries), flush=True)

    def download(entry):
        target = args.source_root / entry['subjectLabel'] / entry['pdfFile']
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            data = read(entry['sourceUrl'])
            if not data.startswith(b'%PDF-'):
                raise ValueError('Not a PDF: ' + entry['originalName'])
            target.write_bytes(data)
        data = target.read_bytes()
        return {**entry, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}

    complete = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        for index, entry in enumerate(pool.map(download, entries)):
            complete.append(entry)
            if index % 16 == 0:
                print('Downloaded', index + 1, '/', len(entries), flush=True)
    manifest = {'schema': 'imyong-sources-v1', 'publisher': '한국교육과정평가원', 'items': complete}
    (args.source_root / 'sources.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(json.dumps({'pdfs': len(complete), 'years': sorted(set(e['year'] for e in complete)),
                      'MB': round(sum(e['bytes'] for e in complete) / 1e6)}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
