// Hue / saturation colour wheel with a brightness slider.
// Plain DOM component (no dependencies). Hue runs around the disc, saturation is radial,
// and the disc is painted at the current brightness (HSV "value"). Pointer Events with
// capture drive scrubbing; arrow keys nudge the focused wheel; setColor() re-syncs from state.
//
//   createColorWheel({ size, color, onInput, onChange, label })
//     -> { element, setColor(hex, silent = true), getColor(), destroy() }
//
// The HSV <-> hex helpers are exported for tests and for naming colours elsewhere.

const HEX_RE = /^#?([0-9a-f]{6})$/i;
const HUE_STEP = 3;
const HUE_STEP_BIG = 15;
const SAT_STEP = 0.02;
const SAT_STEP_BIG = 0.1;
const VALUE_STEP = 0.1;

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const wrapHue = (h) => ((h % 360) + 360) % 360;

/** Parse '#rrggbb' -> { h: 0..360, s: 0..1, v: 0..1 }. Throws on malformed input. */
export function hexToHsv(hex) {
  const m = HEX_RE.exec(String(hex).trim());
  if (!m) throw new Error(`Invalid hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max / 255;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return { h, s, v };
}

/** HSV -> [r, g, b] integers 0..255. */
function hsvToRgb(h, s, v) {
  const hue = wrapHue(h) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = v - c;
  const sector = Math.floor(hue) % 6;
  const table = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
  const [r, g, b] = table[sector];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** hsvToHex(h, s, v) or hsvToHex({ h, s, v }) -> lowercase '#rrggbb'. */
export function hsvToHex(h, s, v) {
  if (typeof h === 'object' && h !== null) ({ h, s, v } = h);
  const [r, g, b] = hsvToRgb(Number(h) || 0, clamp01(Number(s) || 0), clamp01(Number(v) || 0));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [k, val] of Object.entries(attrs)) node.setAttribute(k, val);
  return node;
}

let hintCounter = 0;

export function createColorWheel({ size = 180, color = '#b9613a', onInput, onChange, label = 'Custom color' } = {}) {
  if (typeof document === 'undefined') throw new Error('createColorWheel requires a DOM');
  const state = hexToHsv(color);
  const controller = new AbortController();
  const { signal } = controller;
  const hintId = `color-wheel-hint-${++hintCounter}`;

  // ---------------------------------------------------------------- DOM
  const root = el('div', 'color-wheel');
  root.style.setProperty('--wheel-size', `${size}px`);

  const disc = el('div', 'color-wheel__disc');
  const canvas = el('canvas', 'color-wheel__canvas', {
    tabindex: '0',
    role: 'slider',
    'aria-label': `${label}: hue and saturation`,
    'aria-valuemin': '0',
    'aria-valuemax': '360',
    'aria-describedby': hintId,
  });
  const thumb = el('div', 'color-wheel__thumb', { 'aria-hidden': 'true' });
  disc.append(canvas, thumb);

  const side = el('div', 'color-wheel__side');
  const swatchRow = el('div', 'color-wheel__swatch-row');
  const preview = el('div', 'color-wheel__preview', { 'aria-hidden': 'true' });
  const hexOut = el('output', 'color-wheel__hex', { 'aria-label': `${label} hex value`, 'aria-live': 'off' });
  swatchRow.append(preview, hexOut);

  const field = el('label', 'color-wheel__field');
  const fieldLabel = el('span', 'color-wheel__field-label');
  const fieldName = el('span');
  fieldName.textContent = 'Brightness';
  const valueText = el('span', 'color-wheel__value-text');
  fieldLabel.append(fieldName, valueText);
  const range = el('input', 'color-wheel__value', {
    type: 'range', min: '0', max: '100', step: '1', 'aria-label': `${label} brightness`,
  });
  field.append(fieldLabel, range);

  const hint = el('p', 'sr-only', { id: hintId });
  hint.textContent = 'Left and right arrows change the hue, up and down change the saturation, Page Up and Page Down change the brightness. Hold Shift for larger steps.';

  side.append(swatchRow, field, hint);
  root.append(disc, side);

  // ---------------------------------------------------------------- painting
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const px = Math.max(2, Math.round(size * dpr));
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  let base = null; // RGBA of the disc at full brightness (built once)
  let frame = null; // reusable ImageData for the painted disc
  let paintedValue = -1;

  /** The disc at v = 1: hue by angle, saturation by radius, 1 px anti-aliased rim. */
  function buildBase() {
    const data = new Uint8ClampedArray(px * px * 4);
    const radius = px / 2;
    for (let y = 0; y < px; y++) {
      const dy = y + 0.5 - radius;
      for (let x = 0; x < px; x++) {
        const dx = x + 0.5 - radius;
        const dist = Math.hypot(dx, dy);
        const alpha = clamp01(radius + 0.5 - dist);
        if (alpha <= 0) continue;
        const hue = (Math.atan2(dy, dx) * 180) / Math.PI;
        const [r, g, b] = hsvToRgb(hue, Math.min(dist / radius, 1), 1);
        const i = (y * px + x) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = alpha * 255;
      }
    }
    return data;
  }

  /** Repaint the disc for the current brightness (scales the cached full-brightness disc). */
  function paint() {
    if (!ctx) return;
    if (paintedValue === state.v) return;
    if (!base) base = buildBase();
    if (!frame) frame = ctx.createImageData(px, px);
    const src = base;
    const dst = frame.data;
    const v = state.v;
    for (let i = 0; i < src.length; i += 4) {
      dst[i] = src[i] * v;
      dst[i + 1] = src[i + 1] * v;
      dst[i + 2] = src[i + 2] * v;
      dst[i + 3] = src[i + 3];
    }
    ctx.putImageData(frame, 0, 0);
    paintedValue = v;
  }

  // ---------------------------------------------------------------- sync UI
  function currentHex() { return hsvToHex(state.h, state.s, state.v); }

  function render() {
    paint();
    const hex = currentHex();
    const rad = (state.h * Math.PI) / 180;
    thumb.style.left = `${(0.5 + Math.cos(rad) * state.s * 0.5) * 100}%`;
    thumb.style.top = `${(0.5 + Math.sin(rad) * state.s * 0.5) * 100}%`;
    root.style.setProperty('--wheel-color', hex);
    root.style.setProperty('--wheel-hue', hsvToHex(state.h, state.s, 1));
    root.dataset.color = hex;
    hexOut.value = hex;
    hexOut.textContent = hex;
    const pct = Math.round(state.v * 100);
    if (Number(range.value) !== pct) range.value = String(pct);
    valueText.textContent = `${pct}%`;
    const hueDeg = Math.round(state.h) % 360;
    canvas.setAttribute('aria-valuenow', String(hueDeg));
    canvas.setAttribute('aria-valuetext', `Hue ${hueDeg} degrees, saturation ${Math.round(state.s * 100)} percent, ${hex}`);
  }

  function emitInput() { if (onInput) onInput(currentHex()); }
  function emitChange() { if (onChange) onChange(currentHex()); }

  // ---------------------------------------------------------------- pointer scrubbing
  let activePointer = null;

  /** Map a pointer position to hue/saturation; the hue is kept when the pointer is on the centre. */
  function pick(e) {
    const rect = canvas.getBoundingClientRect();
    const radius = rect.width / 2;
    if (radius <= 0) return;
    const dx = e.clientX - (rect.left + radius);
    const dy = e.clientY - (rect.top + radius);
    const dist = Math.hypot(dx, dy);
    state.s = clamp01(dist / radius);
    if (dist > 1e-3) state.h = wrapHue((Math.atan2(dy, dx) * 180) / Math.PI);
    render();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    activePointer = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* capture is best effort */ }
    canvas.focus({ preventScroll: true });
    pick(e);
    emitInput();
  }, { signal });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointer) return;
    pick(e);
    emitInput();
  }, { signal });

  function endScrub(e) {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (e.type === 'pointerup') pick(e);
    emitChange();
  }
  canvas.addEventListener('pointerup', endScrub, { signal });
  canvas.addEventListener('pointercancel', endScrub, { signal });

  // ---------------------------------------------------------------- keyboard
  canvas.addEventListener('keydown', (e) => {
    const big = e.shiftKey;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': state.h = wrapHue(state.h - (big ? HUE_STEP_BIG : HUE_STEP)); break;
      case 'ArrowRight': state.h = wrapHue(state.h + (big ? HUE_STEP_BIG : HUE_STEP)); break;
      case 'ArrowUp': state.s = clamp01(state.s + (big ? SAT_STEP_BIG : SAT_STEP)); break;
      case 'ArrowDown': state.s = clamp01(state.s - (big ? SAT_STEP_BIG : SAT_STEP)); break;
      case 'PageUp': state.v = clamp01(state.v + VALUE_STEP); break;
      case 'PageDown': state.v = clamp01(state.v - VALUE_STEP); break;
      case 'Home': state.s = 1; break;
      case 'End': state.s = 0; break;
      default: handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    render();
    emitInput();
    emitChange();
  }, { signal });

  // ---------------------------------------------------------------- brightness slider
  function readRange() { state.v = clamp01(Number(range.value) / 100); }
  range.addEventListener('input', () => { readRange(); render(); emitInput(); }, { signal });
  range.addEventListener('change', () => { readRange(); render(); emitChange(); }, { signal });

  // ---------------------------------------------------------------- public API
  function setColor(hex, silent = true) {
    const next = hexToHsv(hex);
    if (next.s === 0) next.h = state.h; // greys keep the last hue so the thumb stays put
    Object.assign(state, next);
    render();
    if (!silent) { emitInput(); emitChange(); }
  }

  function destroy() {
    controller.abort();
    activePointer = null;
    root.remove();
    base = null;
    frame = null;
    canvas.width = 0;
    canvas.height = 0;
  }

  render();
  return { element: root, setColor, getColor: currentHex, destroy };
}
