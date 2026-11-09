import {createEmbeddedHost} from './embedded-host.mjs';
let publish = () => {};
// 동적 학습 모듈이 준비되기 전에 부모 화면의 ready 신호를 받는다.
export function initializeStudyHost(view) { publish = createEmbeddedHost(view); }
export function publishStudyAddress() { publish(); }
