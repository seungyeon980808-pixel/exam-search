export function mountLandingStory(root, { onTry, isVisible }) {
  const slides = [...root.querySelectorAll('.story-slide')];
  const steps = [...root.querySelectorAll('[data-story-step]')];
  const play = root.querySelector('[data-story-play]');
  const counter = root.querySelector('[data-story-count]');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0, playing = !reducedMotion.matches, hovered = false, timer;
  function schedule() {
    clearTimeout(timer);
    if (playing && !hovered && !root.contains(document.activeElement) && !document.hidden && isVisible()) {
      timer = setTimeout(() => show((index + 1) % slides.length), 5500);
    }
  }
  function show(next) {
    index = next;
    slides.forEach((slide, n) => { slide.hidden = n !== index; });
    steps.forEach((step, n) => { step.setAttribute('aria-current', n === index ? 'step' : 'false'); });
    counter.textContent = `${index + 1} / ${slides.length}`;
    play.textContent = playing ? '일시 정지' : '자동 재생';
    play.setAttribute('aria-label', playing ? '기능 소개 자동 재생 일시 정지' : '기능 소개 자동 재생 시작');
    play.setAttribute('aria-pressed', String(playing));
    schedule();
  }
  steps.forEach((step, n) => step.addEventListener('click', () => show(n)));
  play.addEventListener('click', () => { playing = !playing; show(index); });
  root.querySelector('[data-story-try]').addEventListener('click', () => onTry(index));
  root.addEventListener('pointerenter', () => { hovered = true; schedule(); });
  root.addEventListener('pointerleave', () => { hovered = false; schedule(); });
  root.addEventListener('focusin', schedule);
  root.addEventListener('focusout', () => queueMicrotask(schedule));
  document.addEventListener('visibilitychange', schedule);
  reducedMotion.addEventListener('change', () => { playing = !reducedMotion.matches; show(index); });
  show(0);
  return { refresh: schedule };
}
