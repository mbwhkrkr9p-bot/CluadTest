# Component harness pages

Standalone pages used while building and reviewing individual modules. Serve the project
(`npm run dev`) and open them directly, e.g. `http://localhost:4173/tests/harness/fixtures-store/`.

| Page | What it shows |
| --- | --- |
| `webgl-check.html` | Minimal WebGL smoke test for the vendored three.js build |
| `fixtures-store/` | Every store fixture at default and resized dimensions, with bounds checks logged to the console |
| `fixtures-wall-warehouse/` | Wall panels, all door and window styles, and the warehouse equipment |
| `room-finishes/` | Room meshes, exterior context, every floor and wall finish, wall fade and swatch rendering |
| `scene-camera/` | Renderer setup and camera rig limits (orbit / pan / zoom / cinematic) |
| `previews/` | All Build Kit card icons, door and window previews and drag miniatures |
| `ui-shell/colorwheel.html` | The HSV colour wheel component in isolation |
| `integration/` | The studio, picking, manipulation and input layers without the UI panels (drives `window.__t`) |

They are development aids, not part of the shipped app; the automated checks live in
`tests/unit` and `tests/e2e`.
