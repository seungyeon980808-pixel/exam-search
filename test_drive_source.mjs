import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downloadDriveFile, driveLink } from './drive-source.mjs';

test('공개 시험지 경로는 로그인 없이 기존 5E 게이트웨이에서 PDF로 열린다', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(new Uint8Array([37, 80, 68, 70]));
  };
  try {
    const path = '기출문제/물리2/p2_2018_06.pdf';
    assert.equal(driveLink(path), 'https://5e-google-drive-gateway.5e-desktop.workers.dev/v1/google-drive/folders/1N46Woe4wIXs-PoUpVf0Uu4hPkSIUBqgX/public/%EA%B8%B0%EC%B6%9C%EB%AC%B8%EC%A0%9C/%EB%AC%BC%EB%A6%AC2/p2_2018_06.pdf');
    const bytes = await downloadDriveFile(path);
    assert.deepEqual([...new Uint8Array(bytes)], [37, 80, 68, 70]);
    assert.equal(request.url, driveLink(path));
    assert.equal(request.options?.credentials, 'omit');
    assert.equal(request.options?.headers?.Authorization, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('확장 과목 PDF는 독립 공개 폴더로 라우팅하고 기존 과탐 경로는 유지한다', () => {
  const path = '기출문제/기출확장_국영수사탐/국어/2017_11_국어.pdf';
  assert.equal(driveLink(path), 'https://5e-google-drive-gateway.5e-desktop.workers.dev/v1/google-drive/folders/1ckc6lPTmGobFNf8Zv0zMuwR5Gg3qykGo/public/%EA%B5%AD%EC%96%B4/2017_11_%EA%B5%AD%EC%96%B4.pdf');
  assert.throws(() => driveLink('기출문제/기출확장_국영수사탐'), /경로/);
  assert.throws(() => driveLink('기출문제/기출확장_국영수사탐/../x.pdf'), /경로/);
});
