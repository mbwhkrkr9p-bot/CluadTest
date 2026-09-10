# 3D Store Studio

A lightweight, game-like 3D planner for laying out a retail store or a warehouse in the browser.
Everything runs locally: vanilla HTML/CSS/JavaScript ES modules plus a vendored copy of three.js.
No build step, no backend, no network requests, no external assets — every room, fixture, icon,
pattern and texture is generated with code.

## Run it

```bash
cd fable-store-planner-comparison
npm run dev          # starts http://localhost:4173/  (node server.js [port])
```

Open the URL on a desktop browser or an iPad in landscape. Nothing is installed by `npm run dev`;
it only starts the zero-dependency static server in `server.js`. Any static file server works too
(`npx serve .`, `python3 -m http.server`), as long as the page is served over HTTP so ES modules load.

## Test it

```bash
npm test             # Node unit tests: geometry, collisions, state, history, persistence, clipboard, game
npm run test:e2e     # Playwright smoke run through the real app (needs Playwright + Chromium available)
npm run check        # both
```

The end-to-end run starts the server, opens the app headlessly, and drives the acceptance
checklist with real pointer/keyboard/touch input: templates, camera limits, cutaway, selection,
tap/drag placement, direct drags, rotation snapping, collisions, resizing, undo/redo, copy/paste,
finish presets, the colour wheel, windows, doors, floor plan edits, reload persistence, game
objectives and the portrait notice. It also fails on any console error and on any request that
leaves `localhost`. Playwright is resolved from a local install or from the global npm root.

## Using the editor

| Action | Mouse / trackpad | Touch / Apple Pencil | Keyboard |
| --- | --- | --- | --- |
| Orbit | drag on empty space, floor or wall | one finger | |
| Pan | right-drag, middle-drag, Shift+drag | two fingers | |
| Zoom | wheel / trackpad pinch | pinch | |
| Home view | Home View button | | `R` |
| Select | click floor, wall, door, window or fixture | tap | `Esc` steps back |
| Place | tap a card then tap a surface, or drag a card into the room | same | |
| Move | drag the fixture directly | drag | arrow keys (½ ft, Shift = 1 ft) |
| Rotate | drag the curved handle on the floor ring (15° snaps) | drag | `[` / `]` |
| Resize | Details panel | | |
| Duplicate / Remove | Details panel | | Ctrl/Cmd+C, Ctrl/Cmd+V, Ctrl/Cmd+D, Delete |
| Undo / Redo | floating buttons | | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y |

* **Design Finishes** opens the finish mode: floor presets, wall presets (per wall or all walls), a custom
  HSV colour wheel with the eight most recent custom colours, windows (place, drag, resize, snap, duplicate,
  remove) and door styles.
* **Edit Floor Plan** changes the name, size, wall height, rectangle/L-shape outline and door locations.
* **New Space** starts a fresh Store (40 × 28 ft) or Warehouse (80 × 50 ft).
* The workspace autosaves to `localStorage` and is restored on reload (single workspace, same browser).
* The HUD walks through a five-step design path and shows fixture count, completion, and overlaps.

## Layout of the source

```
index.html, styles.css        UI shell and design system
server.js                     local static server (npm run dev)
vendor/three/                 three.js r186 ES-module build (MIT)
src/main.js                   bootstrap and test hook (window.__studio)
src/core/                     serializable state, geometry, collisions, catalog, history, persistence, game (Node-safe)
src/render/                   three.js scene, camera rig, room meshes, procedural materials, fixtures, card previews
src/app/                      integration: studio orchestrator, picking, input, manipulation, placement, gizmos, labels
src/ui/                       DOM panels: header, build kit, details, HUD, finish design, dialogs, colour wheel
tests/unit, tests/e2e         node --test suites and the Playwright smoke run
docs/ARCHITECTURE.md          architecture note; docs/CONTRACTS.md module contracts
```

## Notes

* three.js is vendored from the `three@0.186.0` npm package (`vendor/three`), so the app never
  touches a CDN. Its license is included.
* The app makes zero network requests after the page's own files load; the e2e run enforces this.
* This is a comparison build written from scratch; it does not share code with any other planner.
