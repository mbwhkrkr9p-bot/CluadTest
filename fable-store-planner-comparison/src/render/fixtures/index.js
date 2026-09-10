// Dispatcher for procedural fixture builders.
import { getDef } from '../../core/catalog.js';
import { buildStoreFixture, STORE_BUILDERS } from './store.js';
import { buildWallFixture, buildDoor, buildWindow, WALL_BUILDERS } from './wall.js';
import { buildWarehouseFixture, WAREHOUSE_BUILDERS } from './warehouse.js';
import { disposeGroup, FIXTURE_COLORS } from './common.js';

export { buildDoor, buildWindow, FIXTURE_COLORS };

/**
 * Build the THREE.Group for an entity. Origin conventions:
 *  - floor entity: bottom centre of footprint, base at y=0, front = +Z
 *  - wall entity: bottom centre of wall contact, +X along the wall, +Z into the room, back flush at z=0
 */
export function buildFixture(entity, def = getDef(entity.type)) {
  const id = def.id;
  if (id === 'door') return buildDoor(entity, def);
  if (id === 'window') return buildWindow(entity, def);
  if (STORE_BUILDERS[id]) return buildStoreFixture(entity, def);
  if (WALL_BUILDERS[id]) return buildWallFixture(entity, def);
  if (WAREHOUSE_BUILDERS[id]) return buildWarehouseFixture(entity, def);
  throw new Error(`No builder for fixture type ${id}`);
}

export function disposeFixture(group) {
  disposeGroup(group);
}
