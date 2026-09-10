// Header: product name, workspace name/type, save status, wall height control and mode buttons.
export function createHeader(studio, { toasts, onFinishes, onFloorPlan, onNewSpace }) {
  const $ = (id) => document.getElementById(id);
  const nameBtn = $('workspace-name');
  const typeBadge = $('workspace-type');
  const saveStatus = $('save-status');
  const heightInput = $('wall-height');
  const heightDec = $('wall-height-dec');
  const heightInc = $('wall-height-inc');
  const btnFinishes = $('btn-finishes');
  const btnFloorPlan = $('btn-floorplan');
  const btnNewSpace = $('btn-new-space');
  const btnHome = $('btn-home');

  function refresh() {
    const ws = studio.getState();
    nameBtn.textContent = ws.name;
    nameBtn.title = 'Rename this space';
    typeBadge.textContent = ws.type === 'store' ? 'Store' : 'Warehouse';
    typeBadge.dataset.type = ws.type;
    if (document.activeElement !== heightInput) heightInput.value = String(ws.room.wallHeight);
  }

  function setSaveStatus(status) {
    const map = { saving: 'Saving…', saved: 'Saved', error: 'Save failed' };
    saveStatus.textContent = map[status] || '';
    saveStatus.dataset.status = status;
  }

  function commitHeight(value) {
    const h = Number(value);
    if (!Number.isFinite(h)) { refresh(); return; }
    const clamped = Math.min(30, Math.max(8, Math.round(h * 2) / 2));
    if (clamped !== studio.getState().room.wallHeight) studio.setWallHeight(clamped);
    refresh();
  }

  heightInput.addEventListener('change', () => commitHeight(heightInput.value));
  heightInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commitHeight(heightInput.value); heightInput.blur(); } });
  heightDec.addEventListener('click', () => commitHeight(studio.getState().room.wallHeight - 0.5));
  heightInc.addEventListener('click', () => commitHeight(studio.getState().room.wallHeight + 0.5));

  nameBtn.addEventListener('click', () => {
    const current = studio.getState().name;
    const next = window.prompt('Space name', current);
    if (next !== null && next.trim() && next.trim() !== current) {
      studio.renameWorkspace(next.trim());
      toasts.announce(`Renamed to ${next.trim()}`);
    }
  });

  btnFinishes.addEventListener('click', () => onFinishes());
  btnFloorPlan.addEventListener('click', () => onFloorPlan());
  btnNewSpace.addEventListener('click', () => onNewSpace());
  btnHome.addEventListener('click', () => { studio.cancelReview(); studio.home(true); });

  studio.on('change', refresh);
  studio.on('workspace', refresh);
  studio.on('save', setSaveStatus);
  studio.on('mode', (mode) => {
    btnFinishes.setAttribute('aria-pressed', mode === 'finish' ? 'true' : 'false');
    btnFinishes.textContent = mode === 'finish' ? 'Done Designing' : 'Design Finishes';
  });
  refresh();
  setSaveStatus('saved');

  return { refresh, setSaveStatus };
}
