#!/usr/bin/env python3
"""Build question text, explicit continuation regions and previews from KICE originals."""
import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, as_completed
import hashlib
import io
import json
from pathlib import Path
import re
import unicodedata
import pymupdf as fitz
from PIL import Image, ImageDraw

MARKER = re.compile(r'^\s*(\d(?:\s*\d)?)\s*[.．](?!\d)')
TOPICS = {
    '개념 변화': r'개념변화|인지갈등|오개념|선개념',
    '과학의 본성': r'과학의본성|과학지식의본성|과학적지식의본성|과학철학|반증주의|귀납주의|쿤|포퍼|라카토슈|패러다임',
    '수업 모형': r'수업모형|학습모형|순환학습|발견학습|탐구학습|탐구수업|POE|5E|STS|인지가속|협동학습|개념도|브루너|오수벨|가네|로슨',
    '과학 탐구': r'탐구기능|기초탐구|통합탐구|변인통제|통제변인|조작적정의|가설연역|가설검증|탐구능력|탐구과정요소',
    '과학과 교육과정': r'과학과교육과정|개정교육과정|성취기준|핵심역량|교육과정총론',
    '교수·학습': r'교수학습|교수전략|교수방법|수업전략|수업목표|학습목표|유의미학습|구성주의|비고츠키|피아제|근접발달|스캐폴딩|교과교육|교수내용지식|PCK',
    '평가': r'형성평가|총괄평가|진단평가|수행평가|평가도구|평가문항|문항타당도|문항변별|문항난이도|내용타당도|구인타당도|평가기준|채점기준|평가의타당도|루브릭|평가요소',
}


def text_lines(page):
    return [{'text': ''.join(span['text'] for span in line['spans']), 'box': list(line['bbox'])}
            for block in page.get_text('dict')['blocks'] for line in block.get('lines', [])]


def markers(document, lines):
    candidates = []
    for page, rows in enumerate(lines):
        width = document[page].rect.width
        for line in rows:
            match = MARKER.match(line['text'])
            if match and 0 < int(re.sub(r'\s', '', match[1])) <= 60:
                x, y, _, _ = line['box']
                if .025 * width < x < .67 * width and .025 * document[page].rect.height < y < .95 * document[page].rect.height:
                    candidates.append({'no': int(re.sub(r'\s', '', match[1])), 'page': page, 'x': x, 'y': y, 'ratio': x / width})
    if not candidates:
        raise ValueError('문항 번호를 읽을 수 없습니다')
    centers = []
    for low, high in [(0.025, .26), (.45, .67)]:
        values = [c['ratio'] for c in candidates if low <= c['ratio'] < high]
        if values:
            counts = Counter(round(x * 200) for x in values)
            recurring = [key for key, count in counts.items() if count >= 2]
            center = (min(recurring) if recurring else min(counts)) / 200
            nearby = [x for x in values if abs(x - center) < .007]
            centers.append(sum(nearby) / len(nearby))
    selected = []
    for c in candidates:
        col = min(range(len(centers)), key=lambda i: abs(c['ratio'] - centers[i]))
        if abs(c['ratio'] - centers[col]) < (.012 if col == 0 else .02):
            selected.append({**c, 'col': col, 'slot': c['page'] * len(centers) + col})
    selected.sort(key=lambda c: (c['slot'], c['y']))
    # The printed top-level sequence distinguishes question numbers from numbered material.
    chain, section_no, last = [], 1, 0
    for c in selected:
        if c['no'] == last + 1:
            chain.append({**c, 'sectionNo': section_no}); last = c['no']
        elif c['no'] == 1 and chain and c['slot'] > chain[-1]['slot']:
            section_no += 1; last = 1
            chain.append({**c, 'sectionNo': section_no})
    expected_match = re.search(r'(\d{1,2})\s*문항', document[0].get_text())
    expected = int(expected_match[1]) if expected_match else max(c['no'] for c in selected)
    if len(chain) != expected:
        raise ValueError(f'문항 번호 불일치: {len(chain)}/{expected}; 찾은 번호 {[c["no"] for c in selected]}')
    return chain, centers


def classify(text):
    compact = re.sub(r'\s+', '', text)
    topics = [name for name, pattern in TOPICS.items() if re.search(pattern, compact, re.I)]
    if not topics and re.search(r'교사|선생|수업|교육과정|야외학습|과학적소양|학습이론|실험활동지', compact[:350]):
        topics = ['교수·학습']
    return ('pedagogy' if topics else 'content'), topics


def ink_image(page, box, scale=1.8):
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=fitz.Rect(box), alpha=False)
    image = Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGB')
    mask = image.convert('L').point(lambda value: 255 if value < 220 else 0)
    # Printed column rules and the paper's bottom rule are not question content.
    inset = min(12, image.width // 10)
    mask.paste(0, (0, 0, inset, image.height))
    mask.paste(0, (image.width-inset, 0, image.width, image.height))
    density = list(mask.resize((1, mask.height), Image.Resampling.BOX).getdata())
    draw = ImageDraw.Draw(mask)
    for row, value in enumerate(density):
        if value > 200:
            draw.line((0,row,image.width,row),fill=0)
    ink = mask.getbbox()
    if not ink:
        return None, box
    # Keep the column width and six PDF points around the printed content.
    top = max(0, ink[1] - round(4 * scale))
    bottom = min(image.height, ink[3] + round(6 * scale))
    clipped = [box[0], box[1] + top / scale, box[2], min(box[3], box[1] + bottom / scale)]
    return image.crop((0, top, image.width, bottom)), clipped


def build(entry, source, output, ocr_root=None):
    document = fitz.open(source / entry['subjectLabel'] / entry['pdfFile'])
    lines = [text_lines(page) for page in document]
    ocr = ocr_root / f'{entry["pdfFile"]}.json' if ocr_root else None
    ocr_used = bool(ocr and ocr.exists())
    if ocr_used:
        lines = json.loads(ocr.read_text())
    chain, centers = markers(document, lines)
    cols = len(centers)
    # A shared passage belongs to every question in its printed range.
    passages = []
    for p, rows in enumerate(lines):
        for row in rows:
            match = re.match(r'^\s*[\[【<〈]\s*(\d{1,2})\s*[-~～∼－–]\s*(\d{1,2})\s*[\]】>〉]', row['text'])
            if not match:
                continue
            col = min(range(cols), key=lambda c: abs(row['box'][0] / document[p].rect.width - centers[c]))
            slot = p * cols + col
            first = next((c for c in chain if c['no'] == int(match[1]) and c['slot'] >= slot), None)
            if first and (slot, row['box'][1]) < (first['slot'], first['y']):
                passages.append({'first': first, 'last': int(match[2]), 'slot': slot, 'y': row['box'][1]})
    standard_top = min((c['y'] for c in chain if c['page'] > 0), default=document[0].rect.height * .12) - 3
    items = []
    for index, start in enumerate(chain):
        next_start = chain[index + 1] if index + 1 < len(chain) else None
        own_passage = next((p for p in passages if p['first'] is start), None)
        following_passage = next((p for p in passages if p['first'] is next_start), None)
        begin = own_passage or start
        finish = following_passage or next_start
        shared = next((p for p in passages if p['first']['sectionNo'] == start['sectionNo']
                       and p['first']['no'] < start['no'] <= p['last']), None)
        end_slot = finish['slot'] if finish else len(document) * cols - 1
        regions, pictures, texts = [], [], []
        spans = [(begin, finish, end_slot)]
        if shared:
            spans.insert(0, (shared, shared['first'], shared['first']['slot']))
        for begin, finish, end_slot in spans:
          for slot in range(begin['slot'], end_slot + 1):
            page_no, col = divmod(slot, cols)
            page_top = min(c['y'] for c in chain if c['page'] == 0) - 3 if page_no == 0 else standard_top
            if finish and slot == end_slot and finish['y'] <= page_top + 5:
                continue
            page = document[page_no]
            w, h = page.rect.width, page.rect.height
            left = centers[col] * w - 2
            column_width = (centers[1] - centers[0]) * w if cols == 2 else w * (1 - 2 * centers[0])
            right = min(w, centers[col] * w + column_width - (12 if cols == 2 else 0))
            top = begin['y'] - 3 if slot == begin['slot'] else max(0, page_top)
            footer_rows = [r['box'][1] for r in lines[page_no]
                           if r['box'][1] > h * .8 and re.search(r'(면\s*중|쪽\s*중|관리번호|중\s*\d+\s*[면쪽]|물\s*리\s*\(|화\s*학\s*\(|생\s*물\s*\(|지구과학\s*\()', r['text'])]
            paper_end = min(footer_rows, default=h * .94) - 7
            bottom = finish['y'] - 6 if finish and slot == end_slot else paper_end
            if bottom <= top + 3:
                continue
            box = [round(v, 3) for v in [left, top, right, bottom]]
            image, display = ink_image(page, box)
            if image is None:
                continue
            if ocr_used:
                selected = [row for row in lines[page_no] if left <= (row['box'][0] + row['box'][2]) / 2 <= right
                            and top <= (row['box'][1] + row['box'][3]) / 2 <= bottom]
                text = '\n'.join(row['text'] for row in sorted(selected, key=lambda row: (row['box'][1], row['box'][0])))
            else:
                text = page.get_text('text', clip=fitz.Rect(box), sort=True)
            # Exclude empty continuation columns; keep all printed figures even without text.
            if len(re.findall('[가-힣A-Za-z0-9]', text)) < 3 and image.height < 20:
                continue
            regions.append({'page': page_no + 1, 'box': box, 'displayBox': [round(v, 3) for v in display]})
            pictures.append(image)
            texts.append(text)
        if not regions:
            raise ValueError(f'{start["no"]}번 원본 영역이 비었습니다')
        original_text = unicodedata.normalize('NFKC', '\n'.join(texts))
        text = re.sub(r'[\ue000-\uf8ff]', '', original_text)
        text = re.sub(r'[ \t]+', ' ', text).strip()
        domain, topics = classify(text)
        no = start['no']
        id = f'{entry["subject"]}_{entry["year"]}_{entry["paper"]}_{index+1:02}'
        path = f'previews/imyong/{id}.webp'
        width = max(image.width for image in pictures)
        height = sum(image.height for image in pictures) + 12 * (len(pictures) - 1)
        image = Image.new('RGB', (width, height), 'white')
        y = 0
        for part in pictures:
            image.paste(part, (0, y)); y += part.height + 12
        image.save(output / path, 'WEBP', quality=83, method=2)
        paper_label = '전공 ' + entry['paper'] if entry['paper'] != 'single' else '전공'
        exam = f'{entry["year"]}학년도 중등 임용 {paper_label}'
        section = ''
        if any(c['sectionNo'] > 1 for c in chain):
            heading_rows = [(p, row) for p, rows in enumerate(lines) for row in rows
                            if re.search(r'(기입형|서술형|논술형)', row['text'])
                            and (p < start['page'] or p == start['page'] and row['box'][1] < start['y'])]
            if heading_rows:
                section = re.search(r'(기입형|서술형|논술형)', heading_rows[-1][1]['text'])[1]
            else:
                section = f'{start["sectionNo"]}영역'
        item = {**{key: entry[key] for key in ['subject', 'subjectLabel', 'year', 'paper', 'pdfFile', 'sourceUrl', 'sourcePage']},
                'id': id, 'source': 'imyong', 'month': 0, 'no': no, 'exam': exam,
                'title': f'{exam} {entry["subjectLabel"]} {section + " " if section else ""}{no}번',
                'text': text, 'textQuality': 'ocr' if ocr_used else 'readable', 'domain': domain, 'section': section,
                'questionText': original_text,
                'responseType': 'multiple_choice' if 2009 <= entry['year'] <= 2013 else 'short_answer',
                'classificationMethod': 'source-terms-v2', 'order': index + 1,
                'tags': ['과학교육론', *topics] if domain == 'pedagogy' else [], 'parts': [],
                'page': regions[0]['page'], 'box': regions[0]['box'], 'displayBox': regions[0]['displayBox'],
                'regions': regions, 'cardPath': path, 'cardWidth': width, 'cardHeight': height,
                'track': 'all', 'variant': 'single'}
        items.append(item)
    thumbnail = document[0].get_pixmap(matrix=fitz.Matrix(.4, .4), alpha=False)
    thumb_path = f'previews/imyong/{entry["pdfFile"][:-4]}-cover.webp'
    Image.open(io.BytesIO(thumbnail.tobytes('png'))).convert('RGB').save(output / thumb_path, 'WEBP', quality=75)
    file = {**entry, 'source': 'imyong', 'month': 0, 'pageCount': len(document), 'questionCount': len(items),
            'thumbnailPath': thumb_path, 'exam': items[0]['exam']}
    return items, file


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--output-root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--only', default='')
    parser.add_argument('--ocr-root', type=Path)
    parser.add_argument('--jobs', type=int, default=4)
    parser.add_argument('--refresh-text', action='store_true', help='Refresh OCR text and domain labels without rendering source pixels again')
    args = parser.parse_args()
    manifest = json.loads((args.source_root / 'sources.json').read_text())
    (args.output_root / 'previews/imyong').mkdir(parents=True, exist_ok=True)
    data = args.output_root / 'data/imyong'
    data.mkdir(parents=True, exist_ok=True)
    if args.refresh_text:
        items = json.loads((data / 'questions.json').read_text())['items']
        ocr_cache = {}
        for item in items:
            ocr_path = args.ocr_root / (item['pdfFile'] + '.json') if args.ocr_root else None
            if ocr_path and ocr_path.exists():
                if item['pdfFile'] not in ocr_cache:
                    ocr_cache[item['pdfFile']] = json.loads(ocr_path.read_text())
                texts = []
                for region in item['regions']:
                    left, top, right, bottom = region['box']
                    rows = [r for r in ocr_cache[item['pdfFile']][region['page']-1]
                            if left <= (r['box'][0]+r['box'][2])/2 <= right
                            and top <= (r['box'][1]+r['box'][3])/2 <= bottom]
                    texts.append('\n'.join(r['text'] for r in sorted(rows,key=lambda r:(r['box'][1],r['box'][0]))))
                item['questionText'] = unicodedata.normalize('NFKC','\n'.join(texts))
                item['textQuality'] = 'ocr'
            item['text'] = re.sub(r'[ \t]+',' ',re.sub(r'[\ue000-\uf8ff]','',item['questionText'])).strip()
            item['domain'], topics = classify(item['text'])
            item['tags'] = ['과학교육론',*topics] if item['domain'] == 'pedagogy' else []
            item['classificationMethod'] = 'source-terms-v2'
            item['order'] = int(item['id'].rsplit('_',1)[1])
        quality = json.loads((data / 'quality.json').read_text())
        quality['pedagogy'] = sum(q['domain']=='pedagogy' for q in items)
        quality['ocrPapers'] = len(ocr_cache)
        (data / 'questions.json').write_text(json.dumps({'items':items},ensure_ascii=False,separators=(',',':')))
        (data / 'quality.json').write_text(json.dumps(quality,ensure_ascii=False,indent=2))
        print(json.dumps({'questions':len(items),'pedagogy':quality['pedagogy'],'ocrPapers':len(ocr_cache)}))
        return
    items, files, errors = [], [], []
    entries = [e for e in manifest['items'] if not args.only or args.only in e['pdfFile']]
    results = {}
    with ProcessPoolExecutor(max_workers=args.jobs) as pool:
        pending = {pool.submit(build,e,args.source_root,args.output_root,args.ocr_root): e for e in entries}
        for index, future in enumerate(as_completed(pending)):
            entry = pending[future]
            try:
                results[entry['pdfFile']] = future.result()
            except Exception as error:
                errors.append({'pdfFile': entry['pdfFile'], 'reason': str(error), 'found': 0})
                print('REVIEW', entry['pdfFile'], str(error), flush=True)
            if index % 8 == 0:
                print('Indexed', index + 1, '/', len(entries), flush=True)
    for entry in entries:
        if entry['pdfFile'] in results:
            questions, file = results[entry['pdfFile']]
            items.extend(questions); files.append(file)
    (data / 'questions.json').write_text(json.dumps({'items': items}, ensure_ascii=False, separators=(',', ':')))
    (data / 'files.json').write_text(json.dumps(files, ensure_ascii=False, separators=(',', ':')))
    (data / 'quality.json').write_text(json.dumps({'sources': len(manifest['items']), 'indexed': len(files), 'questions': len(items),
             'pedagogy': sum(q['domain'] == 'pedagogy' for q in items), 'incomplete': errors,
             'classification': '원문 용어에 근거한 영역 분류. 경계 문항은 키워드 전체 검색으로도 찾을 수 있습니다.'}, ensure_ascii=False, indent=2))
    print(json.dumps({'pdfs': len(files), 'questions': len(items), 'errors': len(errors)}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
