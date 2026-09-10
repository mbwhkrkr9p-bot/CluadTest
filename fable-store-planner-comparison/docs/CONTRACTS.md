# 3D Store Studio — Module Contracts

This document is the binding interface contract between modules. Every module is a
plain ES module (no bundler, no TypeScript, no external dependencies other than the
vendored `three` build). Anything not listed here is private to its module.

## Global conventions

* **Units:** one world unit = one foot. `+Y` is up. The room floor is at `y = 0`.
* **Coordinates on the floor** are `{ x, z }` (feet). Room-local == world (the room origin is the world origin).
* **Angles** in state are **degrees**. A floor entity's `rotation` is applied as `mesh.rotation.y = THREE.MathUtils.degToRad(rotation)`. Positive rotation therefore turns `+Z` toward `+X` (three.js right-hand rule).
* **Polygon winding:** room polygons are stored *canonically* so that
  `signedArea = 0.5 * Σ (x_i * z_{i+1} − x_{i+1} * z_i) > 0`. For that winding the inward
  normal of edge direction `d = (dx, dz)` is `n = (−dz, dx)` (normalized).
* **three.js import path:** `import * as THREE from '../../vendor/three/three.module.js'` (adjust the relative depth). Never import from a bare specifier or a CDN.
* **No network access at runtime.** No fonts, images, or model files. Everything is generated with code (canvas textures are fine).
* **Colors** in state are lowercase 7-character hex strings, e.g. `'#a3512b'`.
* **Ids** are strings. Entities keep a *stable logical id* (`e_xxxxxxxx`); walls are `w0…wN` (index based, stable per edge slot); the room id is `'room'`.
* Modules must not touch the DOM unless they are in `src/ui/`. Modules in `src/core/` must run in plain Node (no `window`, no `document`, no THREE).
* Every module that creates three.js resources (geometries, materials, textures, render targets) must expose a way to dispose them.
* No `console.error`/`console.warn` during normal use. Throw `Error` for programmer errors.

## Directory layout

```
index.html                 UI shell (static markup with the ids listed in "UI shell")
styles.css                 design system + layout
server.js                  zero-dependency static server (npm run dev)
vendor/three/              vendored three.module.js + three.core.js
src/main.js                bootstrap + app orchestration (integration layer)
src/app/                   integration modules (owned by the integrator)
src/core/                  pure, serializable state + math (Node-testable)
  geometry.js  collisions.js  catalog.js  templates.js  state.js
  history.js   persistence.js clipboard.js  game.js
src/render/                three.js presentation (scene, camera rig, room, fixtures, materials, previews)
  scene.js  cameraRig.js  roomMesh.js  materials.js  previews.js  fixtures/
src/ui/                    DOM components (colorWheel.js, ...)
tests/unit/*.test.mjs      node --test
tests/e2e/run.mjs          Playwright smoke run
```

---

## Serializable workspace model (`src/core/state.js` owns the shape)

```js
Workspace = {
  version: 1,
  id: 'ws_xxxxxxxx',
  type: 'store' | 'warehouse',
  name: 'Lodge Outfitters',
  room: {
    polygon: [{ x, z }, ...],        // canonical winding, >= 3 vertices, simple polygon
    wallIds: ['w0', 'w1', ...],      // exactly polygon.length entries; wallIds[i] is the wall of edge i (P[i] -> P[i+1])
    wallHeight: 9,                   // feet
    wallThickness: 0.5,              // feet, visual only
  },
  finishes: {
    floor: { preset: 'light-oak', color: '#b08a5a' },       // color only used by 'custom-carpet'
    wallDefault: { preset: 'warm-white', color: '#f1ece3' }, // color only used by 'custom'
    wallOverrides: { [wallId]: { preset, color } },          // per wall override, optional
  },
  customColors: ['#hex', ...],       // most recent first, max 8, committed custom wall colors
  entities: [ Entity, ... ],
  game: {
    arranged: false,                  // set when a fixture has been moved/rotated/resized at least once
    reviewed: false,                  // set when a cinematic review has been run
    celebrated: [],                   // step ids whose celebration was already shown
  },
  meta: { createdAt: ISOString, updatedAt: ISOString },
}

Entity = {
  id: 'e_xxxxxxxx',
  type: 'display-table',             // a CatalogDef id (see catalog.js); 'door' and 'window' are catalog defs too
  anchor: 'floor' | 'wall',
  parent: 'room' | 'w2',             // room id for floor entities, wall id for wall entities
  position: { x, z } | { u, v },     // floor: footprint center on the floor. wall: u = center along wall (feet from the
                                     //   wall's start vertex), v = bottom edge height above the floor
  rotation: 0,                       // degrees; floor entities only (wall entities always 0)
  width, height, depth,              // feet. Floor: width = X extent before rotation, depth = Z extent (front/back), height = Y.
                                     //   Wall: width = along u, height = along v, depth = protrusion into the room along the normal.
  meta: { ... },                     // optional semantic metadata, e.g. { levels: 4, spacing: 1.2 }, { style: 'full-glass', role: 'entrance' }
}
```

### Origin conventions

* **Floor entity** mesh origin: bottom center of its footprint, base at `y = 0`. The box
  `[-width/2, width/2] × [0, height] × [-depth/2, depth/2]` in local space is its bounding volume.
  The "front" of a fixture faces local `+Z`.
* **Wall entity** mesh origin: bottom center of its wall contact. Local `+X` runs along the wall
  (direction of increasing `u`), local `+Y` is up, local `+Z` points *into the room* (the inward normal).
  Its bounding volume is `[-width/2, width/2] × [0, height] × [0, depth]`. The back (local `z = 0`) is flush with the wall face.
* A wall entity with `position {u, v}` sits at wall-local `(u, v, 0)` and is a child of that wall's group.

### Doors and windows

They are entities with `anchor: 'wall'`, `type: 'door' | 'window'`, and metadata:

* Door: `meta: { style: DoorStyleId, role: 'entrance' | 'exit' }`. Default entrance door 6 ft × 7 ft, exit 4 ft × 7 ft, depth 0.3.
* Window: `meta: { style: WindowStyleId }`. Depth 0.2. `v` is the sill height.
* Both are **openings**: wall fixtures may not overlap them (hard constraint), while windows overlapping other windows or doors is a soft warning.

---

## `src/core/geometry.js` — pure math (no THREE)

```js
export const EPS = 1e-6;
export function signedArea(poly)                           // poly: [{x,z}]
export function normalizePolygon(poly)                     // -> new array; canonical winding; drops consecutive duplicate points
export function polygonBounds(poly)                        // -> { minX, maxX, minZ, maxZ, width, depth }
export function polygonCentroid(poly)                      // -> { x, z } (area centroid)
export function polygonArea(poly)                          // -> abs area
export function pointInPolygon(pt, poly)                   // -> bool. Boundary points (within 1e-6) count as inside.
export function segmentsIntersect(a, b, c, d)              // proper intersection test for segments ab and cd (touching at endpoints is NOT an intersection)
export function distancePointToSegment(pt, a, b)           // -> number
export function wallFrames(poly)                           // -> WallFrame[] for the canonical polygon (index i is edge P[i]->P[i+1])
export function wallLocalToWorld(frame, u, v, n = 0)       // -> { x, y, z }; n = distance from wall face toward the room interior
export function worldToWallLocal(frame, p)                 // p: {x,y,z} -> { u, v, n }
export function obbCorners(obb)                            // obb: { x, z, width, depth, rotation } -> [{x,z} x4] in order (front-left, front-right, back-right, back-left)
export function obbOverlap(a, b, eps = 1e-3)               // separating axis test on two obbs; touching/edge contact is NOT overlap
export function obbInsidePolygon(obb, poly, eps = 1e-4)    // all corners inside AND no polygon edge crosses any obb edge
export function rectOverlap(a, b, eps = 1e-3)              // a, b: { u0, u1, v0, v1 }; strict overlap
export function clampObbToPolygon(obb, poly, lastValid)    // -> { x, z } | null; sliding clamp (see below)
export function findNearestValidObb(obb, poly, isFree)     // -> { x, z } | null; spiral search (step 0.5 ft, radius <= 12 ft); isFree(x,z) optional extra predicate
export function distancesToBoundary(obb, poly)             // -> { left, right, front, back } distances (feet, >= 0) from the obb's AABB to the polygon boundary along -X, +X, +Z, -Z (Infinity if the ray leaves the polygon without hitting an edge)
export function snap(value, step)                          // nearest multiple of step
export function snapAngle(deg, step = 15)                  // -> [0, 360)
export function normalizeAngle(deg)                        // -> [0, 360)
export function rotatePoint(pt, deg)                       // rotate {x,z} about origin using the same convention as mesh.rotation.y

WallFrame = {
  index, start: {x,z}, end: {x,z}, length, dir: {x,z} (unit, start->end), normal: {x,z} (unit, inward), midpoint: {x,z}
}
```

`clampObbToPolygon(obb, poly, lastValid)` behaviour:

1. If `obbInsidePolygon(obb)` return `{x: obb.x, z: obb.z}`.
2. Fast path: clamp the center so the obb's AABB fits inside `polygonBounds`; if that is inside, return it.
3. If `lastValid` is given, try `(desired.x, lastValid.z)` and `(lastValid.x, desired.z)` (axis slide). Then binary-search the furthest valid point along each of the three directions (desired, x-slide, z-slide) from `lastValid`. Return the candidate closest to the desired point.
4. Otherwise return `findNearestValidObb(...)` or `null`.

This must slide correctly around an L-shaped notch (never allow a corner of the OBB to enter the notch).

`rotatePoint({x,z}, deg)` uses: `x' = x·cos + z·sin`, `z' = −x·sin + z·cos` (matches `Object3D.rotation.y`).

`obbCorners` = center + rotatePoint(local corner) for local corners `(±w/2, ±d/2)`.

---

## `src/core/catalog.js` — fixture definitions (owned by the integrator, already written)

See the file. Summary of the API:

```js
export const CATALOG            // CatalogDef[]
export const CATALOG_BY_ID      // { [id]: CatalogDef }
export const CATEGORIES         // { store: [{id,label}], warehouse: [{id,label}] }
export const DOOR_STYLES        // [{ id, name, description }]
export const WINDOW_STYLES      // [{ id, name, width, height, sill, description }]
export function getDef(typeId)
export function defsForWorkspace(type)       // CatalogDef[] visible in the build kit for that workspace type
export function defaultEntityFor(def, overrides) // fresh Entity (no id yet) with default size & meta

CatalogDef = {
  id, name, description, category,          // category: one of CATEGORIES ids or 'architecture'
  workspace: ['store'] | ['warehouse'] | ['store','warehouse'] | [],   // [] for architecture
  anchor: 'floor' | 'wall',
  size: { width, height, depth },            // defaults in feet
  resizable: { width: [min, max], height: [min, max], depth: [min, max] } | {},   // present keys are user editable
  params: { levels: { default, min, max, step }, spacing: {...}, ... } | {},       // meta fields the UI exposes
  collision: 'solid' | 'flat',               // flat objects only collide with other flat objects
  countsAsEquipment: true | false,           // forklift = false
  tags: [ ... ],
  defaultV: 0,                               // wall entities: default bottom height
}
```

---

## `src/core/collisions.js`

```js
export function floorObb(entity)                     // -> { x, z, width, depth, rotation } (entity.position.x/z)
export function wallRect(entity)                     // -> { u0, u1, v0, v1 }
export function isOpening(entity)                    // door or window
export function computeCollisions(ws)                // -> CollisionReport
export function isFloorPlacementValid(ws, entity, ignoreId) // inside polygon (does not consider overlaps)
export function clampWallEntity(ws, entity, desired)  // desired: {u, v} -> { u, v } clamped to wall bounds and pushed out of openings
                                                     //   (openings are hard for fixtures; a window/door itself is only clamped to wall bounds)
export function collidingWith(ws, entity)            // -> string[] of other entity ids overlapping it

CollisionReport = {
  colliding: Set<string>,          // entity ids involved in any soft overlap
  outOfBounds: Set<string>,        // floor entities not fully inside the polygon, wall entities outside their wall
  pairs: [[idA, idB], ...],
  count: number,                   // pairs.length + outOfBounds.size
}
```

Rules: floor entities overlap when `obbOverlap` and both `collision === 'solid'` or both `'flat'`.
Wall entities overlap when on the same wall and `rectOverlap`. A fixture overlapping an opening
counts as colliding as well (in case one was placed before the opening existed). Openings vs
openings overlap is soft (counted).

---

## `src/core/templates.js`

```js
export function defaultStore()          // -> Workspace (40 × 28, 9 ft walls, entrance 6 ft on the front wall, exit 4 ft on the right wall)
export function defaultWarehouse()      // -> Workspace (80 × 50, 24 ft walls, entrance 4 ft, exit 6 ft)
export function rectanglePolygon(width, depth)     // centered at origin, canonical winding: (-w/2,-d/2) (w/2,-d/2) (w/2,d/2) (-w/2,d/2)
export function lShapePolygon(width, depth, notchWidth, notchDepth, corner) // corner: 'front-right' | 'front-left' | 'back-right' | 'back-left'
```

For the rectangle above wall indices are: `w0` back (z = −d/2, faces +Z), `w1` right (x = +w/2), `w2` front (z = +d/2, u increases toward −X), `w3` left (x = −w/2).
The default camera sits at +Z, so the *front* wall (`w2`) is the one nearest the viewer.

---

## `src/core/state.js`

```js
export const SCHEMA_VERSION = 1;
export function newId(prefix = 'e')                          // 'e_' + 8 base36 chars (crypto if available, else Math.random)
export function createWorkspace(type, name)                  // uses templates
export function cloneWorkspace(ws)                           // deep copy (structuredClone or JSON)
export function serialize(ws)  / export function deserialize(json)  // JSON string <-> workspace (validates + migrates; throws on garbage)
export function validateWorkspace(obj)                       // -> repaired workspace or throws
export function getWallFrames(ws)                            // -> WallFrame[] with `.id` added; memoized per polygon (cache keyed by JSON of polygon)
export function getWall(ws, wallId)                          // -> WallFrame | undefined
export function getEntity(ws, id)
export function addEntity(ws, entity)                        // assigns id if missing, validates, pushes; returns the entity
export function removeEntity(ws, id)
export function updateEntity(ws, id, patch)                  // shallow merge; `position`/`meta` patches are merged one level deep
export function duplicateEntity(ws, id, offset = { x: 1, z: 1 } | { u: 1 }) // -> new entity with a fresh id, shifted (still must be validated by the caller)
export function setRoom(ws, { polygon, wallHeight, wallIds })   // replaces the room; keeps wall entities whose wallId still exists (clamps u/v),
                                                                 // drops wall entities whose wall vanished, leaves floor entities in place
export function touch(ws)                                    // updates meta.updatedAt
export function entityWorldTransform(ws, entity)             // -> { position: {x,y,z}, rotationY: radians } for floor and wall entities (wall: world position of the bottom-center contact point, rotationY = Math.atan2(frame.normal.x, frame.normal.z), which maps local +X onto frame.dir and local +Z onto the inward normal under the three.js rotation convention)
```

---

## `src/core/history.js`

```js
export function createHistory({ limit = 100 } = {})
// -> {
//   push({ label, before, after })   // before/after are serialized workspace strings; drops redo stack
//   undo() -> entry | null           // returns the entry (caller restores entry.before)
//   redo() -> entry | null           // caller restores entry.after
//   canUndo(), canRedo(), clear(), peekUndoLabel(), peekRedoLabel(), size()
// }
```

## `src/core/persistence.js`

```js
export const STORAGE_KEY = 'fable-store-studio:workspace:v1';
export function saveWorkspace(ws, storage = globalThis.localStorage)   // -> { ok: true } | { ok: false, error }
export function loadWorkspace(storage = globalThis.localStorage)      // -> Workspace | null (null when missing or unreadable)
export function clearWorkspace(storage)
export function createAutosaver({ save, delay = 400, onStatus })       // -> { schedule(ws), flush(), cancel() }
//   onStatus receives 'saving' | 'saved' | 'error'
```

## `src/core/clipboard.js`

```js
export function createClipboard()
// -> { copy(entity), paste(ws) -> Entity | null (fresh id, offset +1 ft x/z or +1 ft u, position validated by the caller), hasContent(), peek() }
```

## `src/core/game.js`

```js
export const STEPS = { store: [Step x5], warehouse: [Step x5] }   // Step = { id, title, objective, hint }
export function evaluateGame(ws, collisionReport)
// -> {
//   steps: [{ id, title, objective, hint, done }],
//   currentStep: Step | null,        // first not-done step (null when all done)
//   objectiveText: string,           // "Clear the overlap" when collisionReport.count > 0, otherwise currentStep.objective or "Layout complete"
//   percent: 0..100,                 // done steps / 5
//   fixtureCount: number,            // entities that are not architecture and countsAsEquipment
//   collisionCount: number,
//   coreComplete: bool,              // steps 1..4 done (Review available)
//   complete: bool,
// }
export function newlyCompleted(ws, evaluation)  // -> step ids that are done but not yet in ws.game.celebrated
```

Store steps: `place` (≥1 fixture), `arrange` (`ws.game.arranged`), `mix` (≥2 distinct fixture types),
`zone` (≥2 freestanding-anchored fixtures and ≥1 wall-anchored fixture; doors/windows do not count),
`review` (`ws.game.reviewed`).
Warehouse steps: `first` (≥1 equipment, forklift excluded), `adjust` (arranged), `locate` (≥1 `pallet-marker`),
`flow` (≥2 distinct equipment types excluding forklift and pallet-marker), `review`.

---

## `src/render/materials.js` — procedural finishes

```js
export const FLOOR_PRESETS = [
  { id: 'polished-concrete', name: 'Polished concrete' },
  { id: 'light-oak', name: 'Light oak' },
  { id: 'dark-walnut', name: 'Dark walnut' },
  { id: 'sand-carpet', name: 'Sand carpet' },
  { id: 'charcoal-carpet', name: 'Charcoal carpet' },
  { id: 'slate-tile', name: 'Slate tile' },
  { id: 'custom-carpet', name: 'Custom carpet', custom: true },
]
export const WALL_PRESETS = [
  { id: 'warm-white', name: 'Warm white' },
  { id: 'lodge-sage', name: 'Lodge sage' },
  { id: 'terracotta', name: 'Terracotta' },
  { id: 'midnight-blue', name: 'Midnight blue' },
  { id: 'linen', name: 'Linen' },
  { id: 'alpine', name: 'Alpine geometric' },
  { id: 'white-brick', name: 'White brick' },
  { id: 'custom', name: 'Custom color', custom: true },
]
export function createFloorMaterial(presetId, customColor)   // -> { material: MeshStandardMaterial, tileFeet, dispose() }
//   material.map is a CanvasTexture representing `tileFeet` × `tileFeet` feet, RepeatWrapping, repeat set to (1/tileFeet, 1/tileFeet)
//   so that geometry with UVs in feet (ShapeGeometry) tiles correctly. Colour space SRGB. Anisotropy 4.
export function createWallMaterial(presetId, customColor, lengthFeet, heightFeet) // -> { material, dispose() }
//   material.map repeats to cover lengthFeet × heightFeet with a `tileFeet` tile (UVs 0..1 across the wall plane).
export function drawFloorSwatch(canvas, presetId, customColor)    // paints a preview into a small canvas (any size)
export function drawWallSwatch(canvas, presetId, customColor)
export function paintFloorTile(ctx, size, presetId, customColor)  // low-level painters (size = px per tile)
export function paintWallTile(ctx, size, presetId, customColor)
export const PALETTE = { charcoal: '#2f2b28', brown: '#6b4a2f', terracotta: '#b9613a', sage: '#7f9270', amber: '#e0a33b', blue: '#3f6d9c', offwhite: '#f4efe7' }
```

## `src/render/fixtures/index.js` — procedural fixture builders

```js
export function buildFixture(entity, def)  // -> THREE.Group
//   - obeys the origin conventions above; group.userData = { entityId: entity.id, type: entity.type }
//   - every Mesh: castShadow = true, receiveShadow = true, userData.pickable = true (the integrator raycasts children)
//   - geometry reflects entity.width/height/depth and entity.meta (levels, spacing, style, ...)
//   - do NOT set group.position/rotation; the integrator does
//   - materials are fresh per fixture (never shared between fixtures) and MeshStandardMaterial / MeshPhysicalMaterial,
//     so the integrator can tint `material.emissive`
export function disposeFixture(group)      // disposes all geometries & materials in the group
export function buildDoor(entity, def)     // wall entity, style from meta.style — shallow overlay, frame + panels/glass, back at z=0
export function buildWindow(entity, def)   // wall entity, style from meta.style
export const FIXTURE_COLORS = { wood: '#a57c52', darkWood: '#5a3e2b', metal: '#9aa0a6', darkMetal: '#3a3d40', white: '#f2efe9', glass: '#bfe0f2', fabric: '#c9b79c', steel: '#556270', safetyYellow: '#e8b62c', safetyBlack: '#2b2b2b', concrete: '#c8c4bb' }
```

The forklift builder draws the striped 6 × 13 ft reserved zone (flat, y ≈ 0.02) *and* the forklift body inside it; `entity.width = 6`, `entity.depth = 13`.
The pallet location marker is flat (y ≈ 0.02): painted outline square with corner marks and a small label block.

## `src/render/previews.js` — 2D card icons

```js
export function drawPreview(ctx, defId, w, h, opts = {})   // draws a schematic, readable icon for the catalog card; opts.entity may carry sizes
export function drawDoorPreview(ctx, styleId, w, h)
export function drawWindowPreview(ctx, styleId, w, h)
export function drawGhostIcon(ctx, defId, size)            // used for the floating drag miniature
```

## `src/render/scene.js`

```js
export function createScene(canvas)  // -> SceneContext
SceneContext = {
  THREE, renderer, scene, camera (PerspectiveCamera, fov 45), sun (DirectionalLight), hemi, ambient,
  environment (PMREM texture from a procedural env scene),
  setSize(w, h), render(), requestRender(), dispose(),
  fitShadowsTo(bounds)   // adjust the sun shadow camera to the room bounds
}
```
Renderer: antialias, `toneMapping = ACESFilmicToneMapping`, `toneMappingExposure ≈ 1.05`, `outputColorSpace = SRGBColorSpace`, `shadowMap.enabled = true`, `shadowMap.type = PCFShadowMap` (r186 removed the soft variant; softness comes from `sun.shadow.radius`), `pixelRatio = min(devicePixelRatio, 2)`, background `PALETTE.offwhite`, faint fog toward the background.
`requestRender()` schedules a single `requestAnimationFrame`; the renderer never loops continuously on its own.

## `src/render/cameraRig.js`

```js
export function createCameraRig(camera, { minDistance = 6, maxDistance = 220, minPolar = 0.08, maxPolar = 1.45 })
// -> {
//   target: Vector3, distance, theta, phi,        // current (already damped) spherical state
//   setHome({ target, distance, theta, phi }), home(animate = true),
//   orbit(dTheta, dPhi), pan(dxPixels, dyPixels, viewportHeight), zoom(factor), dolly(delta),
//   focus(point: Vector3, distance?, animate = true),
//   update(dtSeconds) -> boolean (true while still animating: damping or tweens),
//   startCinematic({ center: Vector3, radius, height, duration }) , cancelCinematic(), isCinematic(),
//   applyToCamera()                                // writes position/lookAt to the camera
//   onChange(cb)                                   // called whenever the camera moved
// }
```
The rig never registers DOM listeners. Camera height must stay ≥ 0.5 ft (`phi` clamp + target y ≥ 0). Damped motion uses exponential smoothing; honors `prefersReducedMotion` by finishing tweens immediately when `rig.reducedMotion = true`.

## `src/render/roomMesh.js`

```js
export function createRoomView(sceneCtx)    // -> RoomView
RoomView = {
  group: THREE.Group,                       // added to the scene
  build(ws),                                // (re)builds floor, walls, exterior context and finishes from ws (disposes old)
  applyFinishes(ws),                        // rebuild only materials (floor + walls)
  setWallHeight(h),                         // cheap rebuild of walls only
  floorMesh,                                // pickable, userData = { kind: 'floor', pickable: true }
  walls: { [wallId]: { group, faceMesh, frame, attachGroup } },
  //   faceMesh: pickable inner face (PlaneGeometry length × height) with userData { kind: 'wall', wallId, pickable: true }
  //   attachGroup: THREE.Group positioned at the wall start vertex, rotation.y = Math.atan2(frame.normal.x, frame.normal.z) so local +X = frame.dir, local +Z = frame.normal, local +Y up.
  //                Wall entities are added here at position (u, v, 0).
  setWallFade(wallId, faded, immediate = false), // fades the wall group (face, thickness, and all attachGroup children) to opacity ~0.08 and
                                                //   sets userData.pickable = false on faded meshes; smooth 180 ms tween (returns true while animating)
  update(dt) -> boolean,                       // advances fade tweens; true while animating
  getWallFrames(),                             // WallFrame[] with ids
  setFloorHighlight(mode),                     // 'none' | 'hover' | 'selected' | 'target-valid' | 'target-invalid'
  setWallHighlight(wallId, mode),
  dispose(),
}
```
Visuals: floor = ShapeGeometry from the polygon (UVs in feet) with the finish material + a subtle one-foot
grid overlay plane; walls = inner face plane + 0.5 ft thick box behind it (neutral exterior material) + top cap;
exterior context = ground apron (large neutral plane, receives shadows), foundation edge (extruded outline ring),
entrance path (strip in front of the entrance door if the workspace has one), a few abstract geometric planters.
Exterior context is decoration only: `userData.pickable = false`, never affects state.

---

## `src/ui/colorWheel.js`

```js
export function createColorWheel({ size = 180, color = '#b9613a', onInput, onChange, label = 'Custom color' })
// -> { element, setColor(hex, silent = true), getColor(), destroy() }
```
Hue/saturation wheel on a canvas with a draggable thumb + a brightness (value) `<input type="range">`.
`onInput(hex)` fires continuously while scrubbing; `onChange(hex)` fires once when the pointer is released
(or on range `change`). Keyboard: arrow keys nudge hue/saturation on the focused wheel. Uses Pointer Events with capture. Accessible labels.

---

## UI shell (`index.html` + `styles.css`) — element ids the integrator wires

```
#app                         full-viewport grid
#viewport                    <canvas> for three.js (position absolute, fills the stage)
#labels                      overlay layer for projected HTML labels (pointer-events: none)
header#topbar
  #product-name              "3D Store Studio"
  #workspace-name            button showing the workspace name (click to rename) 
  #workspace-type            badge: "Store" | "Warehouse"
  #save-status               aria-live="polite" text: "Saving…" | "Saved" | "Save failed"
  #wall-height               <input type="number" min="8" max="30" step="0.5">  with #wall-height-dec / #wall-height-inc buttons
  #btn-finishes              "Design Finishes"
  #btn-floorplan             "Edit Floor Plan"
  #btn-new-space             "New Space"
  #btn-home                  "Home View"
aside#build-kit              left panel (class "panel")
  #kit-search                <input type="search">
  #kit-tabs                  container for category tab buttons (role="tablist")
  #kit-cards                 container for cards (role="list")
  #kit-toggle                collapse/expand button (small screens)
  #kit-empty                 "no matches" message
aside#details                right panel
  #details-title, #details-subtitle, #details-body, #details-actions (Duplicate/Remove buttons live here)
  #details-back              "Back" (steps selection back, same as Escape)
  #details-close             collapse
#history                     floating: #btn-undo, #btn-redo
#hud                         top-center game HUD
  #hud-objective, #hud-progress (ribbon of 5 dots), #hud-count, #hud-score, #hud-collision, #hud-brief-toggle, #hud-brief (collapsible list), #btn-review
#finish-panel                left panel for Finish Design (hidden by default, replaces #build-kit)
  #finish-tabs (Floors/Walls/Windows/Doors), #finish-body, #finish-done
#floorplan-dialog            <dialog> for the floor plan editor (inputs listed in the integrator's module)
#newspace-dialog             <dialog>
#toasts                      milestone / info toasts container (aria-live="polite")
#portrait-notice             overlay shown on portrait tablets ("Rotate to landscape"), with #portrait-continue button
#drag-ghost                  floating miniature during palette drags (hidden by default)
```
The shell is static markup; all dynamic content is injected by JS. CSS must include the visual
system: warm off-white ground, rounded white translucent panels (backdrop-filter), soft shadows,
accent tokens (`--charcoal`, `--brown`, `--terracotta`, `--sage`, `--amber`, `--blue`), visible
`:focus-visible` rings, reduced-motion media query, portrait-notice rules, and responsive collapse
of the side panels under ~900 px width.

---

## Integrator-owned modules (`src/app/*`, `src/main.js`)

`src/app/studio.js` exposes the app API used by UI controllers and tests:

```js
window.__studio = {
  getState(), commit(label, mutator), select(sel), getSelection(),
  placeAt(defId, worldPoint | {wallId,u,v}), moveEntity, rotateEntity, resizeEntity, duplicateSelected, removeSelected,
  undo(), redo(), setFinish(...), addWindow(...), setDoorStyle(...), newSpace(type,name), setRoom(...),
  project(x, y, z) -> {x, y} screen px, pick(x, y) -> hit, cameraRig, collisions(), game(), save(), flushSave(),
}
```
