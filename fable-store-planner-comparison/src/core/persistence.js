// Local persistence: save/load the workspace through any Storage-like object
// (getItem/setItem/removeItem) plus a debounced autosaver. Pure module.
import { serialize, deserialize } from './state.js';

export const STORAGE_KEY = 'fable-store-studio:workspace:v1';

/** Never throws: quota errors and missing storage come back as `{ ok: false, error }`. */
export function saveWorkspace(ws, storage = globalThis.localStorage) {
  if (!isStorage(storage)) return { ok: false, error: new Error('No storage available') };
  try {
    storage.setItem(STORAGE_KEY, serialize(ws));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Repaired workspace, or null when nothing is stored or the payload is unreadable. */
export function loadWorkspace(storage = globalThis.localStorage) {
  if (!isStorage(storage)) return null;
  try {
    const json = storage.getItem(STORAGE_KEY);
    return typeof json === 'string' && json ? deserialize(json) : null;
  } catch {
    return null;
  }
}

export function clearWorkspace(storage = globalThis.localStorage) {
  if (!isStorage(storage)) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up when the storage refuses; the next save overwrites anyway.
  }
}

/**
 * Debounced saver. `schedule(ws)` reports 'saving' at once and runs `save(ws)` after `delay` ms
 * of quiet, reporting 'saved' or 'error'. `flush()` runs a pending save now; `cancel()` drops it.
 */
export function createAutosaver({ save, delay = 400, onStatus } = {}) {
  if (typeof save !== 'function') throw new Error('createAutosaver needs a save(ws) function');
  const report = typeof onStatus === 'function' ? onStatus : () => {};
  let timer = null;
  let pending = null;

  const run = () => {
    timer = null;
    const ws = pending;
    pending = null;
    let result;
    try {
      result = save(ws);
    } catch (error) {
      result = { ok: false, error };
    }
    // `save` may return { ok, error } (saveWorkspace), a boolean, or nothing on success.
    const failed = result === false || (result !== null && typeof result === 'object' && result.ok === false);
    report(failed ? 'error' : 'saved');
    return failed ? { ok: false, error: result?.error ?? new Error('Save failed') } : { ok: true };
  };

  const schedule = (ws) => {
    pending = ws;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(run, delay);
    report('saving');
  };

  const flush = () => {
    if (timer === null) return null;
    clearTimeout(timer);
    return run();
  };

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  return { schedule, flush, cancel };
}

function isStorage(storage) {
  return Boolean(storage) && typeof storage.getItem === 'function' && typeof storage.setItem === 'function';
}
