// New Space dialog: choose Store or Warehouse and a name. Replaces the current workspace.
export function createNewSpaceDialog(studio, { toasts }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $('newspace-dialog');
  const storeBtn = $('ns-store');
  const warehouseBtn = $('ns-warehouse');
  const nameInput = $('ns-name');
  const createBtn = $('ns-create');
  const cancelBtn = $('ns-cancel');
  let type = 'store';
  let nameTouched = false;

  const DEFAULT_NAMES = { store: 'Lodge Outfitters', warehouse: 'North Dock Warehouse' };

  function setType(next) {
    type = next;
    storeBtn.setAttribute('aria-pressed', type === 'store' ? 'true' : 'false');
    warehouseBtn.setAttribute('aria-pressed', type === 'warehouse' ? 'true' : 'false');
    storeBtn.classList.toggle('is-selected', type === 'store');
    warehouseBtn.classList.toggle('is-selected', type === 'warehouse');
    if (!nameTouched) nameInput.value = DEFAULT_NAMES[type];
  }

  function open() {
    nameTouched = false;
    setType(studio.getState().type === 'warehouse' ? 'store' : 'warehouse');
    dialog.showModal();
    nameInput.focus();
    nameInput.select();
  }

  function create(e) {
    if (e) e.preventDefault();
    const name = nameInput.value.trim() || DEFAULT_NAMES[type];
    dialog.close();
    studio.newSpace(type, name);
    toasts.show(`New ${type === 'store' ? 'store' : 'warehouse'} “${name}” ready.`, { kind: 'success', duration: 2600 });
  }

  storeBtn.addEventListener('click', () => setType('store'));
  warehouseBtn.addEventListener('click', () => setType('warehouse'));
  nameInput.addEventListener('input', () => { nameTouched = true; });
  createBtn.addEventListener('click', create);
  cancelBtn.addEventListener('click', () => dialog.close());
  const form = dialog.querySelector('form');
  if (form) form.addEventListener('submit', create);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); dialog.close(); });
  return { open, isOpen: () => dialog.open };
}
