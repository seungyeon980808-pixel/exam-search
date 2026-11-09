import {initializeStudyHost} from './study-host.mjs?v=1.1.1';
const study = new URLSearchParams(location.search).get('view') === 'study';
if (study) {
  initializeStudyHost(window);
  document.documentElement.classList.add('study-mode');
  await import('./study.mjs?v=1.1.1');
} else {
  await import('./app.js?v=imyong-20261109-1');
}
