// In-memory clipboard for one entity. Pure module.
import { CATALOG_BY_ID, isArchitecture } from './catalog.js';
import { addEntity, getWall, newId } from './state.js';

const PASTE_OFFSET = 1; // feet per paste

/**
 * `copy(entity)` stores a snapshot; `paste(ws)` adds a copy with a fresh id to the workspace and
 * returns it (null when nothing is copied or the entity cannot live in this workspace).
 * Each paste shifts one more foot so repeated pastes fan out; the caller validates placement.
 */
export function createClipboard() {
  let content = null;
  let pasteCount = 0;

  const copy = (entity) => {
    if (!entity || typeof entity !== 'object') throw new Error('copy() needs an entity');
    content = clone(entity);
    pasteCount = 0;
    return true;
  };

  const paste = (ws) => {
    if (!content || !fitsWorkspace(ws, content)) return null;
    const entity = clone(content);
    entity.id = newId('e');
    pasteCount += 1;
    const shift = PASTE_OFFSET * pasteCount;
    if (entity.anchor === 'floor') {
      entity.position.x += shift;
      entity.position.z += shift;
    } else {
      entity.position.u += shift;
    }
    return addEntity(ws, entity);
  };

  return {
    copy,
    paste,
    hasContent: () => content !== null,
    peek: () => (content ? clone(content) : null),
  };
}

/** The copied type must belong to this workspace type (or be architecture) and its wall must exist. */
function fitsWorkspace(ws, entity) {
  const def = CATALOG_BY_ID[entity.type];
  if (!def) return false;
  if (!isArchitecture(def.id) && !def.workspace.includes(ws.type)) return false;
  return def.anchor === 'floor' || Boolean(getWall(ws, entity.parent));
}

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
