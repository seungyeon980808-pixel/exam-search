import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Reads the saved section XML so equations inside <보기> table cells are counted too.
export function sectionXml(bytes) {
  const path = join(mkdtempSync(join(tmpdir(), 'hwpx-')), 'doc.hwpx');
  writeFileSync(path, bytes);
  return execFileSync('unzip', ['-p', path, 'Contents/section0.xml'], { encoding: 'utf8', maxBuffer: 1e8 });
}

const unescape = (value) => value.replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&');

export function documentScripts(bytes) {
  return [...sectionXml(bytes).matchAll(/<hp:script>([\s\S]*?)<\/hp:script>/gu)].map((match) => unescape(match[1]));
}

export function documentText(bytes) {
  return [...sectionXml(bytes).matchAll(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>/gu)].map((match) => unescape(match[1])).join(' ');
}

export function inlineContent(bytes) {
  return [...sectionXml(bytes).matchAll(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>|<hp:script>([\s\S]*?)<\/hp:script>/gu)]
    .map((match) => match[2] === undefined ? unescape(match[1]) : '[' + unescape(match[2]) + ']').join('');
}

