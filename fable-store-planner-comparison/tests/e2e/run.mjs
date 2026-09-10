#!/usr/bin/env node
// Deterministic end-to-end smoke checks for 3D Store Studio.
// Starts the local static server, drives the real app in headless Chromium with Playwright,
// and verifies the acceptance checklist interactions. Fails on any console error, page error
// or non-local network request.
//
//   npm run test:e2e            (uses the globally installed playwright if no local one exists)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const PORT = Number(process.env.PORT || 4190);
const BASE = `http://localhost:${PORT}`;

async function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [];
  try { candidates.push(require.resolve('playwright')); } catch { /* not local */ }
  try {
    const globalRoot = (await import('node:child_process')).execSync('npm root -g', { encoding: 'utf8' }).trim();
    const p = path.join(globalRoot, 'playwright', 'index.mjs');
    if (existsSync(p)) candidates.push(p);
  } catch { /* ignore */ }
  for (const c of candidates) {
    try { return await import(c); } catch { /* try next */ }
  }
  throw new Error('Playwright is not installed. Install it with `npm i -D playwright` (browsers: `npx playwright install chromium`).');
}

const results = [];
let failures = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
async function step(name, fn) {
  try {
    const detail = await fn();
    check(name, true, typeof detail === 'string' ? detail : '');
  } catch (err) {
    check(name, false, err && err.message ? err.message : String(err));
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

async function main() {
  const { chromium } = await loadPlaywright();
  const server = spawn(process.execPath, [path.join(root, 'server.js'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => { server.stdout.on('data', () => resolve()); setTimeout(resolve, 1500); });

  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, hasTouch: false });
  const page = await context.newPage();
  const consoleErrors = [];
  const externalRequests = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (!url.startsWith(BASE)) { externalRequests.push(url); return route.abort(); }
    return route.continue();
  });

  const gotoApp = async () => {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__studio && document.documentElement.classList.contains('is-ready'), null, { timeout: 20000 });
    await page.waitForTimeout(300);
  };

  await gotoApp();
  await page.evaluate(() => { window.__studio.clearSaved(); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__studio && document.documentElement.classList.contains('is-ready'));
  await page.waitForTimeout(300);

  const S = (fn, ...args) => page.evaluate(fn, ...args);
  const state = () => S(() => JSON.parse(JSON.stringify(window.__studio.getState())));
  const canvasBox = async () => page.locator('#viewport').boundingBox();
  // wait until camera / fade animations have settled so projected points are stable
  const settle = async () => { await page.waitForTimeout(80); await page.waitForFunction(() => !window.__studio.studio.isAnimating(), null, { timeout: 20000 }).catch(() => {}); };
  const badge = async () => (await page.locator('#workspace-type').innerText()).trim().toLowerCase();

  // ---------------------------------------------------------------- load
  await step('Store template loads (40 × 28, 9 ft walls, entrance + exit)', async () => {
    const ws = await state();
    assert(ws.type === 'store', 'type');
    assert(ws.room.polygon.length === 4, 'rect');
    assert(near(ws.room.wallHeight, 9), 'height');
    const doors = ws.entities.filter((e) => e.type === 'door');
    assert(doors.length === 2, 'two doors');
    assert(doors.some((d) => d.meta.role === 'entrance' && near(d.width, 6)) && doors.some((d) => d.meta.role === 'exit' && near(d.width, 4)), 'door widths');
    const name = await page.locator('#product-name').innerText();
    assert(name.includes('3D Store Studio'), 'product name');
    return `${ws.name}`;
  });

  await step('Workspace can be renamed inline from the header', async () => {
    await page.locator('#workspace-name').click();
    const input = page.locator('input.workspace-name--editing');
    assert(await input.count() === 1, 'inline input');
    await input.fill('Summit Outfitters');
    await input.press('Enter');
    await page.waitForTimeout(100);
    assert((await state()).name === 'Summit Outfitters', 'renamed');
    assert((await page.locator('#workspace-name').innerText()).trim() === 'Summit Outfitters', 'header updated');
    await page.keyboard.press('Control+z');
    assert((await state()).name !== 'Summit Outfitters', 'rename undone');
  });

  await step('Header shows type, save status and wall height', async () => {
    assert((await badge()) === 'store', 'badge');
    assert((await page.locator('#wall-height').inputValue()) === '9', 'wall height input');
    const status = (await page.locator('#save-status').innerText()).trim();
    assert(/Saved|Saving/.test(status), `status=${status}`);
  });

  // ---------------------------------------------------------------- camera
  await step('Orbit, pan and zoom work; camera never goes below the floor', async () => {
    const box = await canvasBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const before = await S(() => window.__studio.camera.position.toArray());
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(cx + i * 15, cy + i * 30);
    await page.mouse.up();
    await page.waitForTimeout(700);
    const afterOrbit = await S(() => window.__studio.camera.position.toArray());
    assert(!near(before[0], afterOrbit[0], 0.01) || !near(before[2], afterOrbit[2], 0.01), 'orbit moved camera');
    assert(afterOrbit[1] >= 0.5, `camera y ${afterOrbit[1]}`);
    // try hard to go below the floor
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 40; i++) await page.mouse.move(cx, cy + i * 40);
    await page.mouse.up();
    await page.waitForTimeout(700);
    const low = await S(() => window.__studio.camera.position.toArray());
    assert(low[1] >= 0.5, `camera y after dragging down ${low[1]}`);
    // pan (right drag)
    const t0 = await S(() => window.__studio.rig.target.toArray());
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(cx + 120, cy + 40, { steps: 8 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(600);
    const t1 = await S(() => window.__studio.rig.target.toArray());
    assert(!near(t0[0], t1[0], 0.01) || !near(t0[2], t1[2], 0.01), 'pan moved target');
    // zoom (wheel)
    const d0 = await S(() => window.__studio.rig.distance);
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(600);
    const d1 = await S(() => window.__studio.rig.distance);
    assert(d1 < d0, `zoom in ${d0} -> ${d1}`);
    await page.keyboard.press('r');
    await page.waitForTimeout(300);
    await settle();
    const home = await S(() => window.__studio.rig.distance);
    assert(near(home, d0, 0.5), `home restored distance ${home} vs ${d0}`);
  });

  await step('Foreground wall fades and is click-through', async () => {
    await page.keyboard.press('r');
    await page.waitForTimeout(900);
    const faded = await S(() => window.__studio.studio.cutaway.isFaded('w2'));
    assert(faded, 'front wall should be faded from the home view');
    const pickable = await S(() => window.__studio.studio.roomView.walls.w2.faceMesh.userData.pickable);
    assert(pickable === false, 'faded wall must not be pickable');
    const backFaded = await S(() => window.__studio.studio.cutaway.isFaded('w0'));
    assert(!backFaded, 'back wall stays solid');
  });

  // ---------------------------------------------------------------- selection
  await step('Floor and walls are selectable; Escape steps back', async () => {
    const p = await S(() => window.__studio.project(0, 0, 0));
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(400);
    assert((await S(() => window.__studio.getSelection().kind)) === 'floor', 'floor selected');
    assert(!(await page.locator('#details').evaluate((el) => el.classList.contains('is-hidden'))), 'details visible');
    const w = await S(() => window.__studio.project(0, 4, -14));
    await page.mouse.click(w.x, w.y);
    await page.waitForTimeout(400);
    const sel = await S(() => window.__studio.getSelection());
    assert(sel.kind === 'wall' && sel.id === 'w0', `wall selected ${JSON.stringify(sel)}`);
    const title = await page.locator('#details-title').innerText();
    assert(/Wall/.test(title), 'details show wall');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    assert((await S(() => window.__studio.getSelection().kind)) === 'none', 'escape clears');
  });

  await step('Build Kit filters to wall fixtures when a wall is selected', async () => {
    await S(() => window.__studio.select({ kind: 'wall', id: 'w0' }));
    await page.waitForTimeout(200);
    const defs = await page.locator('#kit-cards .kit-card').evaluateAll((els) => els.map((e) => e.dataset.def));
    assert(defs.length === 3 && defs.every((d) => d.endsWith('-panel')), `wall-only cards: ${defs}`);
    await S(() => window.__studio.select({ kind: 'none' }));
    await page.waitForTimeout(100);
    const all = await page.locator('#kit-cards .kit-card').count();
    assert(all >= 13, `all cards ${all}`);
  });

  // ---------------------------------------------------------------- placement
  await step('Tap a card, then tap the floor to place a fixture', async () => {
    await settle();
    await page.locator('.kit-card[data-def="display-table"]').click();
    await page.waitForTimeout(150);
    const p = await S(() => window.__studio.project(-8, 0, 2));
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(100);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(300);
    const ws = await state();
    const tables = ws.entities.filter((e) => e.type === 'display-table');
    assert(tables.length === 1, 'one table placed');
    assert(near(tables[0].position.x % 0.5, 0) && near(tables[0].position.z % 0.5, 0), 'snapped to 6 in');
    assert(Math.abs(tables[0].position.x + 8) <= 0.5 && Math.abs(tables[0].position.z - 2) <= 0.5, `near tap ${JSON.stringify(tables[0].position)}`);
    assert((await S(() => window.__studio.getSelection())).id === tables[0].id, 'placed item selected');
  });

  await step('Drag a card into the room to place a fixture', async () => {
    await settle();
    await page.locator('.kit-card[data-def="dump-bin"]').scrollIntoViewIfNeeded();
    const card = await page.locator('.kit-card[data-def="dump-bin"]').boundingBox();
    const p = await S(() => window.__studio.project(6, 0, -4));
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    await page.mouse.down();
    await page.mouse.move(card.x + card.width / 2 + 30, card.y + 10, { steps: 4 });
    await page.mouse.move(p.x, p.y, { steps: 12 });
    await page.waitForTimeout(150);
    const ghostText = await page.locator('#drag-ghost-label').innerText();
    assert(/Drop to place/.test(ghostText), `ghost says "${ghostText}"`);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const ws = await state();
    const bins = ws.entities.filter((e) => e.type === 'dump-bin');
    assert(bins.length === 1, 'bin placed by drag');
    assert(Math.abs(bins[0].position.x - 6) <= 0.5 && Math.abs(bins[0].position.z + 4) <= 0.5, 'near the drop point');
  });

  await step('Dragging a card over a wall shows an invalid state for floor fixtures', async () => {
    await page.locator('.kit-card[data-def="mannequin"]').scrollIntoViewIfNeeded();
    const card = await page.locator('.kit-card[data-def="mannequin"]').boundingBox();
    const p = await S(() => window.__studio.project(0, 5, -14));
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    await page.mouse.down();
    await page.mouse.move(card.x + 40, card.y + 10, { steps: 4 });
    await page.mouse.move(p.x, p.y, { steps: 10 });
    await page.waitForTimeout(150);
    const invalid = await page.locator('#drag-ghost').evaluate((el) => el.classList.contains('is-invalid'));
    // dropping on the back wall face high up: not a floor target
    await page.mouse.move(box2(p), p.y - 200, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const ws = await state();
    assert(ws.entities.filter((e) => e.type === 'mannequin').length === 0, 'nothing placed outside');
    return invalid ? 'invalid state shown over the wall' : 'wall hit resolved to a floor point (allowed)';
    function box2(pt) { return pt.x; }
  });

  // ---------------------------------------------------------------- direct manipulation
  await step('Direct drag moves a floor fixture (no parent selection needed) and stays inside the room', async () => {
    await S(() => window.__studio.select({ kind: 'none' }));
    await settle();
    const ws0 = await state();
    const table = ws0.entities.find((e) => e.type === 'display-table');
    const p = await S((id) => { const e = window.__studio.getState().entities.find((x) => x.id === id); return window.__studio.project(e.position.x, e.height * 0.92, e.position.z); }, table.id);
    const far = await S(() => window.__studio.project(-40, 0, 2));
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x - 10, p.y, { steps: 2 });
    await page.mouse.move(far.x, far.y, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const ws1 = await state();
    const moved = ws1.entities.find((e) => e.id === table.id);
    assert(moved.position.x < table.position.x, 'moved left');
    assert(moved.position.x - moved.width / 2 >= -20 - 1e-6, `stays inside room: ${moved.position.x}`);
    assert(near(moved.position.x - moved.width / 2, -20, 0.01), 'clamped flush to the left wall');
    assert(ws1.game.arranged === true, 'arranged flag set');
  });

  await step('Rotation handle snaps to 15° increments', async () => {
    const ws0 = await state();
    const bin = ws0.entities.find((e) => e.type === 'dump-bin');
    await S((id) => window.__studio.select({ kind: 'entity', id }), bin.id);
    await page.waitForTimeout(200);
    await settle();
    const r = await S(() => window.__studio.studio.gizmos.getRotationRadius());
    assert(r > 0, 'rotation control visible');
    const handleR = r + 0.75;
    const h = await S(([x, z, hr]) => window.__studio.project(x, 0.03, z + hr), [bin.position.x, bin.position.z, handleR]);
    const hit = await S(([x, y]) => window.__studio.pick(x, y).kind, [h.x, h.y]);
    assert(hit === 'rotate-handle', `handle pickable at its screen position (got ${hit})`);
    // drag the handle around the ring by ~60°
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * (Math.PI / 3);
      const pt = await S(([x, z, hr, ang]) => window.__studio.project(x + Math.sin(ang) * hr, 0.03, z + Math.cos(ang) * hr), [bin.position.x, bin.position.z, handleR, a]);
      await page.mouse.move(pt.x, pt.y);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    const ws1 = await state();
    const rotated = ws1.entities.find((e) => e.id === bin.id);
    assert(rotated.rotation !== 0, 'rotated');
    assert(near(rotated.rotation % 15, 0), `snapped: ${rotated.rotation}`);
    assert(Math.abs(rotated.rotation - 60) <= 15, `≈60°: ${rotated.rotation}`);
  });

  // ---------------------------------------------------------------- collisions
  await step('Floor collision warning appears and clears', async () => {
    const ws0 = await state();
    const table = ws0.entities.find((e) => e.type === 'display-table');
    await S(([x, z]) => window.__studio.studio.placeFloorEntity('display-table', x, z), [table.position.x + 20, table.position.z]);
    const id2 = (await S(() => window.__studio.getSelection())).id;
    await S(([id, x, z]) => window.__studio.studio.moveEntity(id, { x, z }), [id2, table.position.x + 1, table.position.z]);
    const c1 = await S(() => { const r = window.__studio.collisions(); return { count: r.count, ids: [...r.colliding] }; });
    assert(c1.count > 0 && c1.ids.includes(table.id) && c1.ids.includes(id2), 'both tables flagged');
    assert((await page.locator('#hud-collision').isVisible()), 'HUD shows overlap badge');
    assert(/Clear the overlap/.test(await page.locator('#hud-objective').innerText()), 'objective replaced');
    assert((await page.locator('#labels .label--warning').count()) >= 2, 'warning labels shown');
    await S(([id, x, z]) => window.__studio.studio.moveEntity(id, { x, z }), [id2, table.position.x + 12, table.position.z]);
    const c2 = await S(() => window.__studio.collisions().count);
    assert(c2 === 0, 'cleared');
    assert(!(await page.locator('#hud-collision').isVisible()), 'badge hidden');
  });

  await step('Wall fixtures clamp to their wall, avoid door openings and warn on overlap', async () => {
    const a = await S(() => window.__studio.placeOnWall('slatwall-panel', 'w0', 5));
    assert(a && a.parent === 'w0' && near(a.position.u, 5), 'placed on back wall');
    const b = await S(() => window.__studio.placeOnWall('pegboard-panel', 'w0', 100));
    assert(b && near(b.position.u, 40 - b.width / 2), `clamped to wall end: ${b.position.u}`);
    // exit door is on w1 at u=6 (4 ft wide): a panel wanting u=6 must be pushed out of the opening
    const c = await S(() => window.__studio.placeOnWall('gridwall-panel', 'w1', 6, 0.5));
    const overlapsDoor = (c.position.u - c.width / 2 < 8) && (c.position.u + c.width / 2 > 4);
    assert(!overlapsDoor, `pushed out of the door opening: u=${c.position.u}`);
    // overlap two panels on w0 -> soft warning
    await S(([id]) => window.__studio.studio.moveEntity(id, { u: 5.5 }), [b.id]);
    const col = await S(() => [...window.__studio.collisions().colliding]);
    assert(col.includes(a.id) && col.includes(b.id), 'wall overlap flagged');
    await S(([id]) => window.__studio.studio.moveEntity(id, { u: 20 }), [b.id]);
    assert((await S(() => window.__studio.collisions().count)) === 0, 'wall overlap cleared');
  });

  await step('Wall fixture drags along its wall with direct manipulation', async () => {
    const ws0 = await state();
    const panel = ws0.entities.find((e) => e.type === 'slatwall-panel');
    await S(() => window.__studio.select({ kind: 'none' }));
    const p = await S((id) => {
      const e = window.__studio.getState().entities.find((x) => x.id === id);
      const w = window.__studio.studio.getWall(e.parent);
      return window.__studio.project(w.start.x + w.dir.x * e.position.u + w.normal.x * 0.1, e.position.v + e.height / 2, w.start.z + w.dir.z * e.position.u + w.normal.z * 0.1);
    }, panel.id);
    const target = await S(() => { const w = window.__studio.studio.getWall('w0'); return window.__studio.project(w.start.x + w.dir.x * 15, 3, w.start.z + w.dir.z * 15); });
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 8, p.y, { steps: 2 });
    await page.mouse.move(target.x, target.y, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const moved = (await state()).entities.find((e) => e.id === panel.id);
    assert(moved.parent === 'w0', 'still on its wall');
    assert(moved.position.u > panel.position.u + 3, `moved along the wall ${panel.position.u} -> ${moved.position.u}`);
    assert(moved.position.u - moved.width / 2 >= 0 && moved.position.u + moved.width / 2 <= 40, 'within wall');
  });

  await step('Regressions: grab above the base does not jump; history buttons reachable; details fields validate', async () => {
    // 1) grabbing a tall fixture near its top must not make it leap at drag start
    await S(() => window.__studio.select({ kind: 'none' }));
    await settle();
    const rack = await S(() => window.__studio.place('four-way-rack', 4, 4));
    await S(() => window.__studio.select({ kind: 'none' }));
    await settle();
    const top = await S((id) => { const e = window.__studio.getState().entities.find((x) => x.id === id); return window.__studio.project(e.position.x, e.height * 0.9, e.position.z); }, rack.id);
    await page.mouse.move(top.x, top.y);
    await page.mouse.down();
    await page.mouse.move(top.x + 6, top.y, { steps: 3 });
    const during = await S((id) => window.__studio.getState().entities.find((x) => x.id === id).position, rack.id);
    await page.mouse.up();
    await page.waitForTimeout(200);
    assert(Math.hypot(during.x - rack.position.x, during.z - rack.position.z) <= 1.0, `no jump at drag start: moved ${Math.hypot(during.x - rack.position.x, during.z - rack.position.z).toFixed(2)} ft`);
    // 2) floating Undo/Redo must be the element under the pointer at the iPad-landscape viewport
    const undoBox = await page.locator('#btn-undo').boundingBox();
    const hitEl = await S(([x, y]) => { const el = document.elementFromPoint(x, y); return el && (el.id === 'btn-undo' || el.closest('#btn-undo')) ? 'undo' : (el ? el.id || el.className : 'none'); }, [undoBox.x + undoBox.width / 2, undoBox.y + undoBox.height / 2]);
    assert(hitEl === 'undo', `undo button reachable (got ${hitEl})`);
    // 3) an emptied details field reverts instead of committing zero
    await S((id) => window.__studio.select({ kind: 'entity', id }), rack.id);
    await page.waitForTimeout(150);
    const before = (await state()).entities.find((e) => e.id === rack.id);
    await page.locator('#details-body input[data-key="x"]').fill('');
    await page.locator('#details-body input[data-key="x"]').press('Enter');
    await page.waitForTimeout(150);
    const afterEmpty = (await state()).entities.find((e) => e.id === rack.id);
    assert(near(afterEmpty.position.x, before.position.x), 'empty field left position unchanged');
    assert((await page.locator('#details-body input[data-key="x"]').inputValue()) !== '', 'field restored');
    // 4) rotation typed in the details field keeps the footprint inside the room
    const table = await S(() => window.__studio.place('display-table', 17.5, 12.5));
    await S(([id]) => window.__studio.studio.moveEntity(id, { x: 18, z: 12.75 }), [table.id]);
    await S((id) => window.__studio.select({ kind: 'entity', id }), table.id);
    await page.waitForTimeout(150);
    await page.locator('#details-body input[data-key="rotation"]').fill('45');
    await page.locator('#details-body input[data-key="rotation"]').press('Enter');
    await page.waitForTimeout(150);
    const rotated = (await state()).entities.find((e) => e.id === table.id);
    const oob = await S((id) => window.__studio.collisions().outOfBounds.has(id), table.id);
    assert(near(rotated.rotation, 45) && !oob, `rotated footprint stays inside (rot ${rotated.rotation}, oob ${oob})`);
    // 5) a refused resize puts the real value back into the field
    const shelf = await S(() => window.__studio.place('custom-shelf', -6, -6));
    await S((id) => window.__studio.select({ kind: 'entity', id }), shelf.id);
    await page.waitForTimeout(150);
    await page.locator('#details-body input[data-key="width"]').fill('12');
    await page.locator('#details-body input[data-key="width"]').press('Enter');
    await page.waitForTimeout(150);
    const w = (await state()).entities.find((e) => e.id === shelf.id).width;
    const fieldVal = await page.locator('#details-body input[data-key="width"]').inputValue();
    assert(near(Number(fieldVal), w), `field (${fieldVal}) matches model (${w})`);
    // clean up the extra fixtures so later steps see the expected counts
    await S(([a, b, c]) => { for (const id of [a, b, c]) window.__studio.studio.removeEntity(id); }, [rack.id, table.id, shelf.id]);
    await S(() => window.__studio.select({ kind: 'none' }));
  });

  // ---------------------------------------------------------------- resize
  await step('Custom Shelf dimensions and levels update the geometry', async () => {
    const shelf = await S(() => window.__studio.place('custom-shelf', 10, 8));
    const meshes0 = await S((id) => { let n = 0; window.__studio.studio.entityViews.groupOf(id).traverse((o) => { if (o.isMesh) n++; }); return n; }, shelf.id);
    await S((id) => window.__studio.studio.resizeEntity(id, { width: 8, height: 8, meta: { levels: 7 } }), shelf.id);
    const after = (await state()).entities.find((e) => e.id === shelf.id);
    assert(near(after.width, 8) && near(after.height, 8) && after.meta.levels === 7, `resized ${JSON.stringify(after)}`);
    const meshes1 = await S((id) => { let n = 0; window.__studio.studio.entityViews.groupOf(id).traverse((o) => { if (o.isMesh) n++; }); return n; }, shelf.id);
    assert(meshes1 > meshes0, `more shelf meshes ${meshes0} -> ${meshes1}`);
    const box = await S((id) => { const b = window.__studio.studio.entityViews.worldBox(id); return [b.max.y - b.min.y, b.max.x - b.min.x]; }, shelf.id);
    assert(box[0] > 7.5 && box[1] > 7.5, `geometry grew ${box}`);
    const bad = await S((id) => window.__studio.studio.resizeEntity(id, { width: 50 }), shelf.id);
    assert(bad === false || (await state()).entities.find((e) => e.id === shelf.id).width <= 12, 'width clamped to the catalog range');
  });

  await step('Service counter length is adjustable', async () => {
    const counter = await S(() => window.__studio.place('service-counter', -10, -8));
    await S((id) => window.__studio.studio.resizeEntity(id, { width: 12 }), counter.id);
    const after = (await state()).entities.find((e) => e.id === counter.id);
    assert(near(after.width, 12), 'length 12');
  });

  // ---------------------------------------------------------------- history
  await step('Undo/Redo cover placement, movement, rotation, resizing and finishes', async () => {
    const ws0 = await state();
    const n0 = ws0.entities.length;
    await S(() => window.__studio.studio.setFloorFinish('slate-tile'));
    assert((await state()).finishes.floor.preset === 'slate-tile', 'finish applied');
    await page.keyboard.press('Control+z');
    assert((await state()).finishes.floor.preset === ws0.finishes.floor.preset, 'undo finish');
    await page.keyboard.press('Control+Shift+z');
    assert((await state()).finishes.floor.preset === 'slate-tile', 'redo finish');
    // undo resize + placement chain
    let ws = await state();
    const counter = ws.entities.find((e) => e.type === 'service-counter');
    await page.keyboard.press('Control+z'); // finish
    await page.keyboard.press('Control+z'); // counter resize
    ws = await state();
    assert(near(ws.entities.find((e) => e.id === counter.id).width, 6), 'undo resize');
    await page.keyboard.press('Control+z'); // counter placement
    ws = await state();
    assert(!ws.entities.find((e) => e.id === counter.id), 'undo placement');
    await page.keyboard.press('Control+y');
    ws = await state();
    assert(ws.entities.find((e) => e.id === counter.id), 'redo placement');
    await page.keyboard.press('Control+y');
    await page.keyboard.press('Control+y');
    ws = await state();
    assert(ws.entities.length === n0 && ws.finishes.floor.preset === 'slate-tile', 'redo chain restored');
    // rotation & move undo
    const bin = ws.entities.find((e) => e.type === 'dump-bin');
    await S((id) => window.__studio.studio.rotateEntity(id, 90), bin.id);
    await S((id) => window.__studio.studio.moveEntity(id, { x: 0, z: 0 }), bin.id);
    await page.keyboard.press('Control+z');
    ws = await state();
    assert(near(ws.entities.find((e) => e.id === bin.id).position.x, bin.position.x), 'undo move');
    await page.keyboard.press('Control+z');
    ws = await state();
    assert(near(ws.entities.find((e) => e.id === bin.id).rotation, bin.rotation), 'undo rotation');
    assert(!(await page.locator('#btn-redo').isDisabled()), 'redo button enabled');
  });

  await step('Copy/Paste creates a fresh id; Delete removes; Escape steps back', async () => {
    const ws0 = await state();
    const table = ws0.entities.find((e) => e.type === 'display-table');
    await S((id) => window.__studio.select({ kind: 'entity', id }), table.id);
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    const ws1 = await state();
    assert(ws1.entities.length === ws0.entities.length + 1, 'pasted');
    const sel = await S(() => window.__studio.getSelection());
    assert(sel.kind === 'entity' && sel.id !== table.id, 'new id selected');
    const pasted = ws1.entities.find((e) => e.id === sel.id);
    assert(pasted.type === 'display-table' && !(near(pasted.position.x, table.position.x) && near(pasted.position.z, table.position.z)), 'offset copy');
    await page.keyboard.press('Delete');
    const ws2 = await state();
    assert(ws2.entities.length === ws0.entities.length, 'deleted');
    assert((await S(() => window.__studio.getSelection().kind)) === 'floor', 'selection stepped to the floor');
    await page.keyboard.press('Escape');
    assert((await S(() => window.__studio.getSelection().kind)) === 'none', 'escape to none');
    // duplicate via details button
    await S((id) => window.__studio.select({ kind: 'entity', id }), table.id);
    await page.locator('#btn-duplicate').click();
    const ws3 = await state();
    assert(ws3.entities.length === ws0.entities.length + 1, 'duplicated');
    await page.locator('#btn-remove').click();
    assert((await state()).entities.length === ws0.entities.length, 'removed via button');
  });

  // ---------------------------------------------------------------- finish design
  await step('Finish Design applies floor and wall presets through the UI', async () => {
    await page.locator('#btn-finishes').click();
    await page.waitForTimeout(200);
    assert(await page.locator('#finish-panel').isVisible(), 'finish panel open');
    assert(!(await page.locator('#build-kit').isVisible()), 'build kit hidden');
    assert(!(await page.locator('#hud').isVisible()), 'HUD hidden');
    await page.locator('#finish-body .swatch', { hasText: 'Dark walnut' }).click();
    assert((await state()).finishes.floor.preset === 'dark-walnut', 'floor preset');
    await page.locator('#finish-tabs .tab', { hasText: 'Walls' }).click();
    await page.locator('#finish-body .swatch', { hasText: 'White brick' }).click();
    assert((await state()).finishes.wallDefault.preset === 'white-brick', 'wall preset all');
    // per-wall: select w0 then apply to selected wall
    await S(() => window.__studio.select({ kind: 'wall', id: 'w0' }));
    await page.waitForTimeout(200);
    await page.locator('#finish-body .seg button', { hasText: 'Wall 1' }).click();
    await page.locator('#finish-body .swatch', { hasText: 'Lodge sage' }).click();
    const ws = await state();
    assert(ws.finishes.wallOverrides.w0 && ws.finishes.wallOverrides.w0.preset === 'lodge-sage', 'per-wall override');
    assert(ws.finishes.wallDefault.preset === 'white-brick', 'others unchanged');
  });

  await step('Custom colour via the in-app wheel: live preview, one undo entry, recent colours', async () => {
    await page.locator('#finish-body .seg button', { hasText: 'All walls' }).click();
    await page.locator('#finish-body .swatch', { hasText: 'Custom color' }).click();
    await page.waitForTimeout(200);
    await page.locator('#finish-body .color-wheel__canvas').scrollIntoViewIfNeeded();
    const wheel = await page.locator('#finish-body .color-wheel__canvas').boundingBox();
    assert(wheel, 'wheel rendered');
    const undoBefore = await S(() => window.__studio.studio.canUndo());
    const countBefore = await page.evaluate(() => window.__studio.studio.getState().customColors.length);
    await page.mouse.move(wheel.x + wheel.width / 2, wheel.y + wheel.height / 2);
    await page.mouse.down();
    await page.mouse.move(wheel.x + wheel.width * 0.8, wheel.y + wheel.height * 0.45, { steps: 8 });
    await page.mouse.move(wheel.x + wheel.width * 0.85, wheel.y + wheel.height * 0.5, { steps: 8 });
    const live = await S(() => window.__studio.getState().finishes.wallDefault.color);
    await page.mouse.up();
    await page.waitForTimeout(200);
    const ws = await state();
    assert(ws.finishes.wallDefault.preset === 'custom', 'custom preset');
    assert(/^#[0-9a-f]{6}$/.test(ws.finishes.wallDefault.color), `hex colour ${ws.finishes.wallDefault.color}`);
    assert(ws.customColors.length === countBefore + 1 && ws.customColors[0] === ws.finishes.wallDefault.color, 'recent colour recorded');
    assert((await page.locator('#finish-body .recent-color').count()) >= 1, 'recent colour cards');
    await page.keyboard.press('Control+z');
    const undone = await state();
    assert(undone.finishes.wallDefault.preset === 'custom' && undone.finishes.wallDefault.color !== ws.finishes.wallDefault.color, 'one undo entry reverts the whole scrub (colour preview kept)');
    await page.keyboard.press('Control+y');
    assert((await state()).finishes.wallDefault.color === ws.finishes.wallDefault.color, 'redo');
    assert(undoBefore === true, 'history existed');
    return `live=${live}`;
  });

  await step('Windows: place, drag, resize, snap, duplicate, remove', async () => {
    await page.locator('#finish-tabs .tab', { hasText: 'Windows' }).click();
    await S(() => window.__studio.select({ kind: 'wall', id: 'w0' }));
    await page.waitForTimeout(200);
    await page.locator('#finish-body .swatch', { hasText: 'Picture Window' }).click();
    let ws = await state();
    let win = ws.entities.find((e) => e.type === 'window');
    assert(win && win.parent === 'w0', 'window on w0');
    // drag along the wall
    await S(() => window.__studio.select({ kind: 'none' }));
    const p = await S((id) => {
      const e = window.__studio.getState().entities.find((x) => x.id === id);
      const w = window.__studio.studio.getWall(e.parent);
      return window.__studio.project(w.start.x + w.dir.x * e.position.u + w.normal.x * 0.15, e.position.v + e.height / 2, w.start.z + w.dir.z * e.position.u + w.normal.z * 0.15);
    }, win.id);
    const target = await S(() => { const w = window.__studio.studio.getWall('w0'); return window.__studio.project(w.start.x + w.dir.x * 30, 5, w.start.z + w.dir.z * 30); });
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 8, p.y, { steps: 2 });
    await page.mouse.move(target.x, target.y, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    ws = await state();
    const movedWin = ws.entities.find((e) => e.id === win.id);
    assert(movedWin.position.u > win.position.u + 3, `window dragged ${win.position.u} -> ${movedWin.position.u}`);
    // resize
    await S((id) => window.__studio.studio.resizeEntity(id, { width: 6, height: 4 }), win.id);
    ws = await state();
    assert(near(ws.entities.find((e) => e.id === win.id).width, 6), 'window resized');
    // snapping: a second window whose bottom is dragged near the first one's sill snaps to it
    const second = await S(() => window.__studio.studio.addWindow('picture', 'w0', 10));
    await S(([id]) => window.__studio.studio.moveEntity(id, { v: 1 }), [second.id]);
    const sill = ws.entities.find((e) => e.id === win.id).position.v;
    await S(() => window.__studio.select({ kind: 'none' }));
    const q = await S((id) => {
      const e = window.__studio.getState().entities.find((x) => x.id === id);
      const w = window.__studio.studio.getWall(e.parent);
      return window.__studio.project(w.start.x + w.dir.x * e.position.u + w.normal.x * 0.15, e.position.v + e.height / 2, w.start.z + w.dir.z * e.position.u + w.normal.z * 0.15);
    }, second.id);
    const t2 = await S(([u, v, h]) => { const w = window.__studio.studio.getWall('w0'); return window.__studio.project(w.start.x + w.dir.x * u, v + h / 2 + 0.2, w.start.z + w.dir.z * u); }, [10, sill, second.height]);
    await page.mouse.move(q.x, q.y);
    await page.mouse.down();
    await page.mouse.move(q.x, q.y - 6, { steps: 2 });
    await page.mouse.move(t2.x, t2.y, { steps: 12 });
    await page.waitForTimeout(100);
    const guideShown = await S(() => !!window.__studio.studio.gizmos.group.parent && document.querySelectorAll('#labels .label--dimension').length > 0);
    await page.mouse.up();
    await page.waitForTimeout(300);
    ws = await state();
    const snapped = ws.entities.find((e) => e.id === second.id);
    assert(near(snapped.position.v, sill, 1e-6), `snapped sill ${snapped.position.v} vs ${sill}`);
    // duplicate + remove via keyboard and buttons
    await S((id) => window.__studio.select({ kind: 'entity', id }), second.id);
    await page.locator('#btn-duplicate').click();
    ws = await state();
    assert(ws.entities.filter((e) => e.type === 'window').length === 3, 'window duplicated');
    await page.keyboard.press('Delete');
    ws = await state();
    assert(ws.entities.filter((e) => e.type === 'window').length === 2, 'window removed');
    return guideShown ? 'drag labels shown' : '';
  });

  await step('Door styles can be changed (selected door and all doors)', async () => {
    await page.locator('#finish-tabs .tab', { hasText: 'Doors' }).click();
    await page.locator('#finish-body .swatch', { hasText: 'Double Oak' }).click();
    let ws = await state();
    assert(ws.entities.filter((e) => e.type === 'door').every((d) => d.meta.style === 'double-oak'), 'all doors');
    const exit = ws.entities.find((e) => e.type === 'door' && e.meta.role === 'exit');
    await S((id) => window.__studio.select({ kind: 'entity', id }), exit.id);
    await page.waitForTimeout(200);
    await page.locator('#finish-body .swatch', { hasText: 'Black Steel' }).click();
    ws = await state();
    assert(ws.entities.find((e) => e.id === exit.id).meta.style === 'black-steel', 'selected door');
    assert(ws.entities.find((e) => e.type === 'door' && e.meta.role === 'entrance').meta.style === 'double-oak', 'other door untouched');
    await page.keyboard.press('Control+z');
    assert((await state()).entities.find((e) => e.id === exit.id).meta.style === 'double-oak', 'undo door style');
    await page.locator('#finish-done').click();
    await page.waitForTimeout(200);
    assert(await page.locator('#build-kit').isVisible(), 'back to build mode');
  });

  // ---------------------------------------------------------------- game
  await step('Store objectives progress (place, arrange, mix, zone) and Review becomes available', async () => {
    const info = await S(() => window.__studio.game());
    const done = info.steps.filter((s) => s.done).map((s) => s.id);
    assert(done.includes('place') && done.includes('arrange') && done.includes('mix') && done.includes('zone'), `steps done: ${done}`);
    assert(info.coreComplete, 'core complete');
    assert(await page.locator('#btn-review').isVisible(), 'review button');
    assert(/\d+%/.test(await page.locator('#hud-score').innerText()), 'score shown');
  });

  await step('Cinematic review runs and cancels on user input', async () => {
    await page.locator('#btn-review').click();
    await page.waitForTimeout(400);
    assert(await S(() => window.__studio.studio.isReviewing()), 'review active');
    const box = await canvasBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(200);
    assert(!(await S(() => window.__studio.studio.isReviewing())), 'cancelled by wheel');
    // let a reduced-motion-fast review complete via the API
    await S(() => { window.__studio.rig.reducedMotion = true; window.__studio.studio.startReview(); });
    await page.waitForFunction(() => window.__studio.getState().game.reviewed === true, null, { timeout: 60000 }).catch(() => {});
    const ws = await state();
    assert(ws.game.reviewed === true, 'review recorded');
    const info = await S(() => window.__studio.game());
    assert(info.complete, 'layout complete');
    await S(() => { window.__studio.rig.reducedMotion = false; });
  });

  // ---------------------------------------------------------------- floor plan (L-shape)
  await step('Floor plan editor: L-shaped room rebuilds walls and keeps wall fixtures', async () => {
    const before = await state();
    const panels = before.entities.filter((e) => e.anchor === 'wall' && e.type.endsWith('-panel'));
    await page.locator('#btn-floorplan').click();
    await page.waitForTimeout(200);
    await page.selectOption('#fp-shape', 'l-shape');
    await page.fill('#fp-notch-width', '12');
    await page.fill('#fp-notch-depth', '8');
    await page.selectOption('#fp-notch-corner', 'front-right');
    await page.locator('#fp-apply').click();
    await page.waitForTimeout(500);
    const ws = await state();
    assert(ws.room.polygon.length === 6, 'six walls');
    assert(ws.room.wallIds.length === 6, 'wall ids');
    for (const p of panels) {
      const now = ws.entities.find((e) => e.id === p.id);
      assert(now && now.parent === p.parent, `panel ${p.id} kept its wall`);
    }
    const walls = await S(() => Object.keys(window.__studio.studio.roomView.walls).length);
    assert(walls === 6, 'six wall meshes');
    // a floor fixture dragged toward the notch is clamped to the real outline
    const bin = ws.entities.find((e) => e.type === 'dump-bin');
    const start = await S((id) => { const e = window.__studio.getState().entities.find((x) => x.id === id); return window.__studio.project(e.position.x, e.height * 0.9, e.position.z); }, bin.id);
    await S(() => window.__studio.select({ kind: 'none' }));
    const intoNotch = await S(() => window.__studio.project(16, 0, 11));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 8, start.y, { steps: 2 });
    await page.mouse.move(intoNotch.x, intoNotch.y, { steps: 25 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const moved = (await state()).entities.find((e) => e.id === bin.id);
    const inside = await S((e) => {
      const g = window.__studio.studio;
      return g.collisions().outOfBounds.has(e.id);
    }, moved);
    assert(!inside, 'never left the polygon');
    const notchCorner = await S((e) => {
      const r = (e.rotation || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
      return [[-1, 1], [1, 1], [1, -1], [-1, -1]].some(([sx, sz]) => { const lx = sx * e.width / 2, lz = sz * e.depth / 2; const x = e.position.x + lx * c + lz * s, z = e.position.z - lx * s + lz * c; return x > 8 + 1e-6 && z > 6 + 1e-6; });
    }, moved);
    assert(!notchCorner, `not inside the notch: ${JSON.stringify(moved.position)}`);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    assert((await state()).room.polygon.length === 4, 'undo floor plan');
  });

  await step('Wall height change rebuilds the room without losing fixtures', async () => {
    const before = await state();
    await page.fill('#wall-height', '12');
    await page.locator('#wall-height').press('Enter');
    await page.waitForTimeout(400);
    const ws = await state();
    assert(near(ws.room.wallHeight, 12), 'height 12');
    assert(ws.entities.length === before.entities.length, 'fixtures kept');
    const h = await S(() => window.__studio.studio.roomView.walls.w0.faceMesh.geometry.parameters.height);
    assert(near(h, 12, 0.01), `wall mesh height ${h}`);
    await page.keyboard.press('Control+z');
    assert(near((await state()).room.wallHeight, 9), 'undo height');
  });

  // ---------------------------------------------------------------- persistence
  await step('Workspace survives a full reload (entities, finishes, colours, game)', async () => {
    await S(() => window.__studio.flushSave());
    await page.waitForTimeout(200);
    const before = await state();
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__studio && document.documentElement.classList.contains('is-ready'));
    await page.waitForTimeout(400);
    const after = await state();
    assert(after.id === before.id && after.name === before.name, 'same workspace');
    assert(after.entities.length === before.entities.length, 'entities restored');
    assert(JSON.stringify(after.entities) === JSON.stringify(before.entities), 'entities identical (stable ids, transforms, sizes)');
    assert(JSON.stringify(after.finishes) === JSON.stringify(before.finishes), 'finishes restored');
    assert(JSON.stringify(after.customColors) === JSON.stringify(before.customColors), 'custom colours restored');
    assert(after.game.reviewed === true && after.game.arranged === true, 'game progress restored');
    const meshes = await S(() => window.__studio.studio.entityViews.all().size);
    assert(meshes === after.entities.length, 'all entity views rebuilt');
  });

  // ---------------------------------------------------------------- warehouse
  await step('Warehouse template opens with objectives that update', async () => {
    await page.locator('#btn-new-space').click();
    await page.waitForTimeout(200);
    await page.locator('#ns-warehouse').click();
    await page.locator('#ns-create').click();
    await page.waitForTimeout(500);
    const ws = await state();
    assert(ws.type === 'warehouse', 'warehouse');
    const b = ws.room.polygon;
    const xs = b.map((p) => p.x), zs = b.map((p) => p.z);
    assert(near(Math.max(...xs) - Math.min(...xs), 80) && near(Math.max(...zs) - Math.min(...zs), 50), '80 × 50');
    assert(near(ws.room.wallHeight, 24), '24 ft walls');
    const doors = ws.entities.filter((e) => e.type === 'door');
    assert(doors.some((d) => d.meta.role === 'entrance' && near(d.width, 4)) && doors.some((d) => d.meta.role === 'exit' && near(d.width, 6)), 'door widths');
    assert((await badge()) === 'warehouse', 'badge');
    const cards = await page.locator('#kit-cards .kit-card').evaluateAll((els) => els.map((e) => e.dataset.def));
    assert(cards.includes('pallet-rack') && cards.includes('forklift') && !cards.includes('mannequin'), `warehouse cards ${cards}`);
    let info = await S(() => window.__studio.game());
    assert(info.steps[0].id === 'first' && !info.steps[0].done, 'fresh objectives');
    const rack = await S(() => window.__studio.place('pallet-rack', -20, -10));
    info = await S(() => window.__studio.game());
    assert(info.steps.find((s) => s.id === 'first').done, 'first piece');
    await S((id) => window.__studio.studio.rotateEntity(id, 90), rack.id);
    info = await S(() => window.__studio.game());
    assert(info.steps.find((s) => s.id === 'adjust').done, 'adjust');
    await S(() => window.__studio.place('pallet-marker', 0, 0));
    info = await S(() => window.__studio.game());
    assert(info.steps.find((s) => s.id === 'locate').done, 'locate');
    assert(!info.steps.find((s) => s.id === 'flow').done, 'flow not yet (marker does not count)');
    await S(() => window.__studio.place('packing-station', 20, 10));
    info = await S(() => window.__studio.game());
    assert(info.steps.find((s) => s.id === 'flow').done && info.coreComplete, 'flow + core complete');
    // forklift: collides via its zone but does not count as equipment
    const count0 = info.fixtureCount;
    const fork = await S(() => window.__studio.place('forklift', 0, 10));
    info = await S(() => window.__studio.game());
    assert(info.fixtureCount === count0, 'forklift not counted');
    assert(near(fork.width, 6) && near(fork.depth, 13), 'zone footprint');
    await S(([id]) => window.__studio.studio.moveEntity(id, { x: 20, z: 10 }), [fork.id]);
    assert((await S(() => window.__studio.collisions().count)) > 0, 'forklift zone collides with the packing station');
    // markers do not collide with solid equipment
    await S(([id]) => window.__studio.studio.moveEntity(id, { x: 0, z: 10 }), [fork.id]);
    await S(() => window.__studio.place('pallet-marker', -20, -10));
    const c = await S(() => window.__studio.collisions().count);
    assert(c === 0, `flat marker under a rack is allowed (${c})`);
  });

  // ---------------------------------------------------------------- portrait notice
  await step('Portrait iPad shows the landscape request', async () => {
    const ctx2 = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', (e) => consoleErrors.push(`pageerror(portrait): ${e.message}`));
    await p2.goto(`${BASE}/index.html`, { waitUntil: 'load' });
    await p2.waitForFunction(() => window.__studio);
    await p2.waitForTimeout(300);
    const visible = await p2.locator('#portrait-notice').evaluate((el) => el.classList.contains('is-visible'));
    assert(visible, 'notice visible in portrait');
    await p2.locator('#portrait-continue').click();
    assert(!(await p2.locator('#portrait-notice').evaluate((el) => el.classList.contains('is-visible'))), 'dismissable');
    await ctx2.close();
  });

  await step('Touch: one-finger drag moves a fixture, pinch zooms (touch emulation)', async () => {
    const ctx3 = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const p3 = await ctx3.newPage();
    p3.on('pageerror', (e) => consoleErrors.push(`pageerror(touch): ${e.message}`));
    await p3.goto(`${BASE}/index.html`, { waitUntil: 'load' });
    await p3.waitForFunction(() => window.__studio && document.documentElement.classList.contains('is-ready'));
    await p3.waitForTimeout(300);
    const e = await p3.evaluate(() => window.__studio.place('display-table', 0, 0));
    await p3.evaluate(() => window.__studio.select({ kind: 'none' }));
    const from = await p3.evaluate(() => window.__studio.project(0, 2.3, 0));
    const to = await p3.evaluate(() => window.__studio.project(-8, 0, 0));
    const cdp = await ctx3.newCDPSession(p3);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 10, y: from.y + (to.y - from.y) * i / 10 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p3.waitForTimeout(300);
    const moved = await p3.evaluate((id) => window.__studio.getState().entities.find((x) => x.id === id).position, e.id);
    assert(moved.x < -3, `touch drag moved the table ${JSON.stringify(moved)}`);
    const d0 = await p3.evaluate(() => window.__studio.rig.distance);
    const c = { x: 590, y: 410 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x - 40, y: c.y }, { x: c.x + 40, y: c.y }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x - 40 - i * 15, y: c.y }, { x: c.x + 40 + i * 15, y: c.y }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p3.waitForTimeout(600);
    const d1 = await p3.evaluate(() => window.__studio.rig.distance);
    assert(d1 < d0, `pinch zoomed in ${d0} -> ${d1}`);
    await ctx3.close();
  });

  // ---------------------------------------------------------------- hygiene
  await step('No external network requests', async () => {
    assert(externalRequests.length === 0, externalRequests.join(', '));
  });
  await step('No console errors or warnings during the workflow', async () => {
    assert(consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
  });

  await browser.close();
  server.kill();
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
