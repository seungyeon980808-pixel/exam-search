import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddedHost } from './embedded-host.mjs';

function fixture() {
  const messages = [];
  const parent = { postMessage: (...args) => messages.push(args) };
  const view = { parent, location: { search: '?group=math&id=question', hash: '#page=1' },
    addEventListener: (_, listener) => { view.receive = listener; } };
  const publish = createEmbeddedHost(view);
  return { view, parent, messages, publish };
}

test('standalone use neither installs a listener nor sends bookmark data', () => {
  const view = { location: {}, addEventListener: () => assert.fail('standalone listener') };
  view.parent = view;
  createEmbeddedHost(view)();
});

test('bookmark state is sent only after a trusted parent handshake', () => {
  const { view, parent, messages, publish } = fixture();
  publish(); assert.equal(messages.length, 0);
  view.receive({ source: parent, origin: 'https://www.5e.ai.kr', data: { type: '5e:examlibrary-ready' } });
  assert.deepEqual(messages[0], [{ type: '5e:examlibrary-location', search: '?group=math&id=question', hash: '#page=1' }, 'https://www.5e.ai.kr']);
  view.location.search = '?q=빛'; publish();
  assert.equal(messages[1][0].search, '?q=빛');
});

test('untrusted origins, sibling frames, and unrelated messages cannot read bookmark state', () => {
  const { view, parent, messages } = fixture();
  for (const event of [
    { source: parent, origin: 'https://www.5e.ai.kr.evil.example', data: { type: '5e:examlibrary-ready' } },
    { source: {}, origin: 'https://www.5e.ai.kr', data: { type: '5e:examlibrary-ready' } },
    { source: parent, origin: 'https://www.5e.ai.kr', data: { type: 'other' } },
  ]) view.receive(event);
  assert.deepEqual(messages, []);
});
