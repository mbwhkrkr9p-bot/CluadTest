// Toasts, milestone celebrations and the screen-reader announcer.
export function createToasts({ container, announcer, reducedMotion = false }) {
  let hintEl = null;

  let announceTimer = 0;
  function announce(text) {
    if (!announcer) return;
    announcer.textContent = '';
    // Re-set shortly after clearing so identical messages are announced again (not frame-bound,
    // so it stays prompt even while a toast animation is rendering).
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { announcer.textContent = text; }, 40);
  }

  function show(text, { kind = 'info', duration = 3200, milestone = false, glyph = '' } = {}) {
    const el = document.createElement('div');
    el.className = `toast toast--${kind}${milestone ? ' toast--milestone' : ''}`;
    el.setAttribute('role', 'status');
    if (glyph) {
      const g = document.createElement('span');
      g.className = 'toast__glyph';
      g.setAttribute('aria-hidden', 'true');
      g.textContent = glyph;
      el.appendChild(g);
    }
    const body = document.createElement('span');
    body.className = 'toast__text';
    body.textContent = text;
    el.appendChild(body);
    if (milestone && !reducedMotion) {
      const confetti = document.createElement('span');
      confetti.className = 'toast__confetti';
      confetti.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 10; i++) {
        const piece = document.createElement('i');
        piece.style.setProperty('--i', String(i));
        confetti.appendChild(piece);
      }
      el.appendChild(confetti);
    }
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));
    const remove = () => {
      el.classList.remove('is-visible');
      const done = () => el.remove();
      if (reducedMotion) done(); else setTimeout(done, 260);
    };
    const timer = setTimeout(remove, duration);
    el.addEventListener('click', () => { clearTimeout(timer); remove(); });
    announce(text);
    return { el, dismiss: () => { clearTimeout(timer); remove(); } };
  }

  function milestone(title, detail) {
    return show(detail ? `${title} — ${detail}` : title, { kind: 'milestone', milestone: true, duration: 4200, glyph: '★' });
  }

  /** Persistent hint (e.g. during placement). Replaces the previous hint. */
  function hint(text) {
    clearHint();
    if (!text) return;
    hintEl = document.createElement('div');
    hintEl.className = 'toast toast--hint is-visible';
    hintEl.setAttribute('role', 'status');
    hintEl.textContent = text;
    container.appendChild(hintEl);
    announce(text);
  }

  function clearHint() {
    if (hintEl) { hintEl.remove(); hintEl = null; }
  }

  return { show, milestone, hint, clearHint, announce };
}
