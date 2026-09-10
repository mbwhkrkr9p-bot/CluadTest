// Landscape-orientation notice for portrait tablets.
export function createPortraitNotice({ notice, continueBtn }) {
  let dismissed = false;
  try { dismissed = sessionStorage.getItem('fable-store-studio:portrait-dismissed') === '1'; } catch { /* ignore */ }

  function shouldShow() {
    if (dismissed) return false;
    const portrait = window.matchMedia('(orientation: portrait)').matches || window.innerHeight > window.innerWidth;
    const touch = (navigator.maxTouchPoints || 0) > 0 || window.matchMedia('(pointer: coarse)').matches;
    const tabletish = Math.min(window.innerWidth, window.innerHeight) <= 1100;
    return portrait && touch && tabletish;
  }

  function update() {
    const show = shouldShow();
    notice.classList.toggle('is-visible', show);
    notice.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  continueBtn.addEventListener('click', () => {
    dismissed = true;
    try { sessionStorage.setItem('fable-store-studio:portrait-dismissed', '1'); } catch { /* ignore */ }
    update();
  });
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  update();
  return { update, shouldShow };
}
