// Fixture catalog: every placeable thing in the editor is described here.
// Pure data — no DOM, no three.js. Sizes are in feet.

/** @typedef {{ id:string, name:string, description:string, category:string, workspace:string[], anchor:'floor'|'wall',
 *  size:{width:number,height:number,depth:number}, resizable:Record<string,[number,number]>, params:Record<string,{default:number,min:number,max:number,step:number,label:string}>,
 *  collision:'solid'|'flat', countsAsEquipment:boolean, tags:string[], defaultV:number }} CatalogDef */

const LEVELS = (def, min, max) => ({ default: def, min, max, step: 1, label: 'Shelf levels' });
const SPACING = (def, min, max) => ({ default: def, min, max, step: 0.25, label: 'Shelf spacing (ft)' });

function def(partial) {
  return {
    description: '',
    workspace: ['store'],
    anchor: 'floor',
    resizable: {},
    params: {},
    collision: 'solid',
    countsAsEquipment: true,
    tags: [],
    defaultV: 0,
    ...partial,
  };
}

/** @type {CatalogDef[]} */
export const CATALOG = [
  // ---------------------------------------------------------------- store: freestanding
  def({
    id: 'display-table', name: 'Display Table', category: 'displays',
    description: 'Low merchandise table with a solid top and tapered legs. Good for folded goods and feature displays.',
    size: { width: 4, height: 2.5, depth: 2.5 },
    resizable: { width: [2, 8], depth: [2, 4] },
    tags: ['table', 'merchandise', 'feature'],
  }),
  def({
    id: 'custom-shelf', name: 'Custom Shelf', category: 'shelving',
    description: 'Configurable single-sided shelving unit. Set its width, height, depth, level count and spacing.',
    size: { width: 4, height: 6, depth: 1.5 },
    resizable: { width: [2, 12], height: [3, 10], depth: [1, 3] },
    params: { levels: LEVELS(4, 2, 8), spacing: SPACING(0, 0, 4) },
    tags: ['shelf', 'shelving', 'wall unit', 'custom'],
  }),
  def({
    id: 'gondola', name: 'Double-Sided Gondola', category: 'shelving',
    description: 'Free-standing double-sided gondola run with a shared centre spine and shelves on both faces.',
    size: { width: 4, height: 5.5, depth: 3 },
    resizable: { width: [2, 12], height: [4, 7] },
    params: { levels: LEVELS(4, 2, 6) },
    tags: ['gondola', 'shelf', 'aisle'],
  }),
  def({
    id: 'gridwall-tower', name: 'Gridwall Tower', category: 'shelving',
    description: 'Four-sided wire grid tower on a weighted base for hanging accessories.',
    size: { width: 2, height: 6, depth: 2 },
    tags: ['grid', 'tower', 'accessories'],
  }),
  def({
    id: 'slatwall-tower', name: 'Slatwall Tower', category: 'shelving',
    description: 'Four-sided slatwall tower with horizontal grooves for hooks and shelves.',
    size: { width: 2, height: 6, depth: 2 },
    tags: ['slat', 'tower'],
  }),
  def({
    id: 'four-way-rack', name: 'Four-Way Garment Rack', category: 'racks',
    description: 'Chrome four-arm garment rack on a central post. Each arm faces a different direction.',
    size: { width: 3, height: 5.5, depth: 3 },
    tags: ['garment', 'apparel', 'rack', 'clothing'],
  }),
  def({
    id: 'round-rack', name: 'Round Garment Rack', category: 'racks',
    description: 'Circular chrome rail on a centre post for high-capacity apparel.',
    size: { width: 3, height: 5, depth: 3 },
    tags: ['garment', 'apparel', 'rack', 'clothing', 'circle'],
  }),
  def({
    id: 'rolling-rack', name: 'Rolling Garment Rack', category: 'racks',
    description: 'Straight rail rack on casters. Adjustable length.',
    size: { width: 5, height: 5.5, depth: 2 },
    resizable: { width: [3, 8] },
    tags: ['garment', 'apparel', 'rack', 'clothing', 'rolling'],
  }),
  def({
    id: 'dump-bin', name: 'Dump Bin', category: 'displays',
    description: 'Open-top promotional bin for loose bulk merchandise.',
    size: { width: 3, height: 2.5, depth: 3 },
    tags: ['bin', 'promo', 'sale'],
  }),
  def({
    id: 'spinner-rack', name: 'Spinner Rack', category: 'displays',
    description: 'Tall rotating rack with wire pockets, ideal beside a counter.',
    size: { width: 1.5, height: 5.5, depth: 1.5 },
    tags: ['spinner', 'rotating', 'cards', 'impulse'],
  }),
  def({
    id: 'glass-showcase', name: 'Glass Showcase', category: 'displays',
    description: 'Lockable glass display case on a solid plinth. Adjustable length.',
    size: { width: 5, height: 3.5, depth: 2 },
    resizable: { width: [3, 8] },
    tags: ['glass', 'case', 'jewellery', 'showcase', 'cabinet'],
  }),
  def({
    id: 'mannequin', name: 'Mannequin', category: 'displays',
    description: 'Abstract full-body mannequin on a round base.',
    size: { width: 1.5, height: 6, depth: 1.5 },
    tags: ['mannequin', 'apparel', 'figure'],
  }),
  def({
    id: 'service-counter', name: 'Service Counter / Register', category: 'service',
    description: 'Cash-wrap counter with register, raised transaction top and storage below. Adjustable length.',
    size: { width: 6, height: 3.5, depth: 2.5 },
    resizable: { width: [4, 16] },
    tags: ['counter', 'register', 'checkout', 'pos', 'cash wrap'],
  }),

  // ---------------------------------------------------------------- wall fixtures (both workspaces)
  def({
    id: 'slatwall-panel', name: 'Slatwall Panel', category: 'wall', anchor: 'wall',
    workspace: ['store', 'warehouse'],
    description: 'Wall-mounted slatwall panel with horizontal grooves for hooks and brackets.',
    size: { width: 4, height: 4, depth: 0.15 },
    resizable: { width: [2, 8], height: [2, 8] },
    defaultV: 1,
    tags: ['slat', 'wall', 'panel'],
  }),
  def({
    id: 'gridwall-panel', name: 'Gridwall Panel', category: 'wall', anchor: 'wall',
    workspace: ['store', 'warehouse'],
    description: 'Wall-mounted wire grid panel on standoff brackets.',
    size: { width: 2, height: 6, depth: 0.15 },
    resizable: { width: [2, 8], height: [2, 8] },
    defaultV: 0.5,
    tags: ['grid', 'wall', 'panel'],
  }),
  def({
    id: 'pegboard-panel', name: 'Pegboard Panel', category: 'wall', anchor: 'wall',
    workspace: ['store', 'warehouse'],
    description: 'Perforated pegboard panel for hooks and small parts.',
    size: { width: 4, height: 4, depth: 0.1 },
    resizable: { width: [2, 8], height: [2, 8] },
    defaultV: 1,
    tags: ['peg', 'pegboard', 'wall', 'panel'],
  }),

  // ---------------------------------------------------------------- warehouse equipment
  def({
    id: 'pallet-rack', name: 'Pallet Rack Bay', category: 'storage', workspace: ['warehouse'],
    description: 'Selective pallet racking bay with upright frames and orange beam levels.',
    size: { width: 9, height: 16, depth: 4 },
    resizable: { width: [8, 12], height: [8, 24] },
    params: { levels: LEVELS(3, 2, 6) },
    tags: ['rack', 'racking', 'pallet', 'storage', 'beam'],
  }),
  def({
    id: 'pallet-marker', name: 'Pallet Location Marker', category: 'planning', workspace: ['warehouse'],
    description: 'Painted floor location for one pallet. Flat marker, only collides with other markers.',
    size: { width: 4, height: 0.05, depth: 4 },
    collision: 'flat',
    tags: ['pallet', 'location', 'marker', 'floor', 'slot'],
  }),
  def({
    id: 'wire-shelving', name: 'Adjustable Wire Shelving', category: 'storage', workspace: ['warehouse'],
    description: 'Chrome wire shelving unit with adjustable levels.',
    size: { width: 4, height: 6, depth: 1.5 },
    resizable: { width: [3, 6], height: [4, 8], depth: [1, 2.5] },
    params: { levels: LEVELS(4, 2, 7) },
    tags: ['wire', 'shelf', 'shelving', 'chrome'],
  }),
  def({
    id: 'packing-station', name: 'Packing Station', category: 'stations', workspace: ['warehouse'],
    description: 'Packing bench with an upper supply shelf, roll holder and monitor arm.',
    size: { width: 6, height: 5, depth: 2.5 },
    resizable: { width: [4, 10] },
    tags: ['pack', 'packing', 'bench', 'station', 'shipping'],
  }),
  def({
    id: 'forklift', name: 'Forklift + Reserved Zone', category: 'planning', workspace: ['warehouse'],
    description: 'Planning reference: a forklift parked inside its striped 6 × 13 ft reserved zone. The zone is the collision footprint.',
    size: { width: 6, height: 7, depth: 13 },
    countsAsEquipment: false,
    tags: ['forklift', 'vehicle', 'zone', 'reserved', 'parking'],
  }),

  // ---------------------------------------------------------------- architecture (managed in Finish Design)
  def({
    id: 'door', name: 'Door', category: 'architecture', anchor: 'wall', workspace: [],
    description: 'Door opening. Style is applied in Finish Design.',
    size: { width: 6, height: 7, depth: 0.3 },
    collision: 'solid', countsAsEquipment: false,
    tags: ['door', 'entrance', 'exit'],
  }),
  def({
    id: 'window', name: 'Window', category: 'architecture', anchor: 'wall', workspace: [],
    description: 'Window opening. Added, moved and resized in Finish Design.',
    size: { width: 4, height: 3, depth: 0.2 },
    resizable: { width: [1.5, 20], height: [1.5, 12] },
    collision: 'solid', countsAsEquipment: false,
    defaultV: 3,
    tags: ['window', 'glass'],
  }),
];

/** @type {Record<string, CatalogDef>} */
export const CATALOG_BY_ID = Object.fromEntries(CATALOG.map((d) => [d.id, d]));

export const CATEGORIES = {
  store: [
    { id: 'all', label: 'All' },
    { id: 'shelving', label: 'Shelving' },
    { id: 'racks', label: 'Racks' },
    { id: 'displays', label: 'Displays' },
    { id: 'service', label: 'Service' },
    { id: 'wall', label: 'Wall' },
  ],
  warehouse: [
    { id: 'all', label: 'All' },
    { id: 'storage', label: 'Storage' },
    { id: 'stations', label: 'Stations' },
    { id: 'planning', label: 'Planning' },
    { id: 'wall', label: 'Wall' },
  ],
};

export const DOOR_STYLES = [
  { id: 'full-glass', name: 'Full Glass', description: 'Single frameless glass leaf with a slim aluminium frame.' },
  { id: 'double-glass', name: 'Double Glass', description: 'Pair of glass leaves with a centre stile.' },
  { id: 'french-oak', name: 'French Oak', description: 'Oak doors with divided glass lites.' },
  { id: 'natural-oak', name: 'Natural Oak', description: 'Solid light oak panel door.' },
  { id: 'double-oak', name: 'Double Oak', description: 'Pair of solid oak panel doors.' },
  { id: 'dark-wood', name: 'Dark Wood', description: 'Solid dark walnut door with a narrow vision lite.' },
  { id: 'black-steel', name: 'Black Steel', description: 'Industrial black steel door with a kick plate.' },
];

export const WINDOW_STYLES = [
  { id: 'picture', name: 'Picture Window', width: 4, height: 3, sill: 3, description: 'Single fixed pane.' },
  { id: 'double', name: 'Double Window', width: 6, height: 3.5, sill: 3, description: 'Two panes with a centre mullion.' },
  { id: 'storefront', name: 'Storefront Glass', width: 8, height: 7, sill: 0.5, description: 'Floor-to-head storefront glazing.' },
];

export function getDef(typeId) {
  const d = CATALOG_BY_ID[typeId];
  if (!d) throw new Error(`Unknown catalog type: ${typeId}`);
  return d;
}

export function defsForWorkspace(type) {
  return CATALOG.filter((d) => d.workspace.includes(type));
}

/** Build a fresh entity (no id) for a def. `overrides` may set position/parent/meta/size. */
export function defaultEntityFor(def, overrides = {}) {
  const meta = {};
  for (const [k, p] of Object.entries(def.params)) meta[k] = p.default;
  const base = {
    type: def.id,
    anchor: def.anchor,
    parent: def.anchor === 'floor' ? 'room' : undefined,
    position: def.anchor === 'floor' ? { x: 0, z: 0 } : { u: 0, v: def.defaultV },
    rotation: 0,
    width: def.size.width,
    height: def.size.height,
    depth: def.size.depth,
    meta,
  };
  const out = { ...base, ...overrides };
  out.meta = { ...meta, ...(overrides.meta || {}) };
  if (overrides.position) out.position = { ...base.position, ...overrides.position };
  return out;
}

export function isArchitecture(typeId) {
  return typeId === 'door' || typeId === 'window';
}
