# Architecture note

3D Store Studio is a state-first editor: a small serializable **workspace** object is the source of
truth, the three.js scene is *derived* from it, and every edit goes through one commit path that
records history, reconciles the scene, recomputes collisions and game progress, and autosaves.

```
UI panels / pointer input ──► studio.commit(label, mutator) ──► history.push(before, after)
                                       │
                                       ▼
                        reconcile(): room signature changed?  → rebuild room meshes, re-parent wall entities
                                     finishes changed?       → swap procedural materials
                                     entityViews.sync()      → build / rebuild / re-transform / remove fixture groups
                                       │
                                       ▼
                        computeCollisions() → tints, halos, labels        evaluateGame() → HUD, milestones
                                       │
                                       ▼
                        autosaver.schedule() → localStorage (debounced) → header save status
```

## Room polygon and wall frames

The room is a simple polygon of `{x, z}` vertices (feet, `+Y` up, floor at `y = 0`). Polygons are
stored in a canonical winding (positive signed area in the x/z plane), which makes the inward normal of
each edge deterministic: for edge direction `d = (dx, dz)` the inward normal is `n = (−dz, dx)`.
`geometry.wallFrames(polygon)` produces one **wall frame** per edge:

* `start`, `end`, `length`
* `dir` — unit vector along the wall (`u` axis)
* `normal` — unit inward normal (`n` axis)
* `v` is height above the floor

`wallLocalToWorld(frame, u, v, n)` and `worldToWallLocal(frame, p)` convert between the frame and
world space. Wall ids (`w0…wN`) are stored alongside the polygon (`room.wallIds[i]` belongs to edge
`i`), so a wall keeps its identity when the outline is edited. Rectangles and L-shapes come from
`templates.rectanglePolygon` / `templates.lShapePolygon`, but nothing downstream assumes four walls:
walls, collisions and clamping all operate on the actual polygon.

In the scene each wall is a group holding a pickable inner face plane, a thickness box, and an
`attachGroup` positioned at the wall start vertex and rotated so local `+X = dir`, `+Z = normal`,
`+Y` up. The room view exposes these per wall id.

## Entity serialization

Every placeable thing — fixtures, doors and windows alike — is an **entity**:

```
{ id, type, anchor: 'floor' | 'wall', parent: 'room' | wallId,
  position: { x, z } | { u, v }, rotation, width, height, depth, meta }
```

`type` refers to a catalog definition (`src/core/catalog.js`) that supplies defaults, resizable ranges,
configuration parameters (shelf levels/spacing), collision class and category. `meta` carries the
semantic extras (door style/role, window style, shelf levels). Ids are stable logical ids that survive
save/load, undo/redo and room rebuilds; only the three.js objects are recreated. The whole workspace
(name, type, polygon, wall ids, wall height, finishes, custom colours, entities, game progress) is
plain JSON, validated and repaired by `state.validateWorkspace` on load.

History is snapshot based: each commit stores the serialized workspace before and after. Undo/redo
restore a snapshot and run the same reconcile path as any other change, so the scene can never
drift from the state. Drags use `beginEdit()` / live `previewEntity()` / `endEdit()` so a whole
gesture is a single history entry, and an interrupted gesture simply commits its last valid state.

## Floor versus wall anchoring

* **Floor entities** are children of the room: `position {x, z}` is the footprint centre in
  room-local (= world) space, `rotation` is degrees about `+Y`, the mesh origin is the bottom centre
  and the base rests on `y = 0`. World transform: `position (x, 0, z)`, `rotation.y = rad(rotation)`.
* **Wall entities** are children of their wall's `attachGroup`: `position {u, v}` is the bottom
  centre of the wall contact, the back face is flush with the wall and positive depth protrudes along
  the inward normal. Because they live under the wall group, rebuilding the room (wall height, floor
  plan) only re-parents them; their `u/v` placement is untouched. `state.setRoom` keeps wall entities
  whose wall id still exists (clamping `u/v` to the new bounds) and drops the rest.

World transforms, collision bounds and top-down footprints are always computed from this state
(`state.entityWorldTransform`, `collisions.floorObb`, `collisions.wallRect`); there is no separate
2D position to drift.

## Collision strategy

* Floor entities use **oriented bounding boxes** (`{x, z, width, depth, rotation}`). Overlap is a
  separating-axis test; edge contact is not overlap. Objects have a collision class: `solid`
  fixtures collide with each other, `flat` markers (pallet locations) collide only with each other,
  so a marker can sit under a rack. The forklift's entity size *is* its 6 × 13 ft striped zone.
* Room containment (`obbInsidePolygon`) requires all four corners inside the polygon, no polygon
  edge crossing an OBB edge, and no polygon vertex inside the OBB — which is what makes an L-notch a
  hard boundary rather than a bounding-box approximation. `clampObbToPolygon` slides an object along
  walls (axis slides plus binary search from the last valid position) so drags feel natural around
  corners and notches; `findNearestValidObb` spiral-searches a free spot for taps and pastes.
* Wall entities use wall-local rectangles `{u0, u1, v0, v1}`. They are clamped to the wall's length
  and height; fixtures are additionally pushed out of door/window openings (hard), while overlaps
  between wall items are reported as soft warnings.
* `computeCollisions` returns the involved ids, out-of-bounds ids and pair count. Involved objects
  get a red emissive tint, a red footprint/frame halo and an "Overlap" label; the HUD replaces the
  current objective with "Clear the overlap" until the report is empty.

## Rendering and interaction

* `scene.js` sets up the renderer (ACES tone mapping, sRGB, PCF soft shadows, capped pixel ratio, a
  PMREM environment built from a procedural emissive room) and renders only on demand; the studio's
  tick loop keeps running only while the camera rig or a wall fade is animating.
* `cameraRig.js` is a damped spherical orbit with polar and distance clamps (the camera never drops
  below 0.5 ft), focus tweens and the cinematic review orbit. It has no DOM listeners; `input.js`
  translates Pointer Events (mouse, trackpad, touch, pen) into orbit/pan/pinch/zoom or into
  manipulation sessions from `manipulate.js`.
* `cutaway.js` fades any wall whose outer side faces the camera (camera beyond the wall plane) and
  marks its face and attached objects non-pickable, so the interior is always visible and clickable.
* Raycasting (`picking.js`) only considers objects flagged `userData.pickable`; decoration (grid,
  exterior context, halos, guides) is never selectable. Matrices are updated immediately after
  placement and rebuilds so picks are never stale.
* Fixtures, finishes and card previews are procedural (`src/render/fixtures`, `materials.js`,
  `previews.js`); replaced geometries, materials and canvas textures are disposed.

## Local persistence

`persistence.js` writes the serialized workspace to `localStorage` under a versioned key. The
autosaver debounces commits (≈350 ms), reports `saving` / `saved` / `error` to the header's
aria-live status, and is flushed on `beforeunload` and when the tab is hidden. On boot the app loads
and validates the stored workspace before creating the studio, so the editor opens directly on the
restored space; when nothing is stored it opens the default store. Persistence is deliberately
single-workspace and same-browser: no accounts, no cloud, no server.
