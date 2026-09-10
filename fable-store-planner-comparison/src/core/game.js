// Layout "game": five guided steps per workspace type evaluated from the workspace state. Pure module.
import { CATALOG_BY_ID, isArchitecture } from './catalog.js';

export const STEPS = {
  store: [
    {
      id: 'place',
      title: 'Place a fixture',
      objective: 'Drag a fixture from the Build Kit onto the floor',
      hint: 'Pick any card on the left and drop it anywhere inside the room.',
    },
    {
      id: 'arrange',
      title: 'Arrange it',
      objective: 'Move, rotate or resize a fixture',
      hint: 'Drag a placed fixture, turn it with the amber rotation handle, or edit its size in the details panel.',
    },
    {
      id: 'mix',
      title: 'Mix it up',
      objective: 'Add a second kind of fixture',
      hint: 'Two different fixture types give shoppers a reason to look around.',
    },
    {
      id: 'zone',
      title: 'Zone the space',
      objective: 'Use two freestanding fixtures and one wall fixture',
      hint: 'Wall panels from the Wall tab attach to any wall; doors and windows do not count.',
    },
    {
      id: 'review',
      title: 'Review',
      objective: 'Run the cinematic review',
      hint: 'Press Review in the HUD to fly around your layout.',
    },
  ],
  warehouse: [
    {
      id: 'first',
      title: 'First equipment',
      objective: 'Place a piece of equipment',
      hint: 'Racks, shelving and stations all count. The forklift zone is a planning reference only.',
    },
    {
      id: 'adjust',
      title: 'Adjust',
      objective: 'Move, rotate or resize equipment',
      hint: 'Drag a placed item, turn it with the amber rotation handle, or edit its size in the details panel.',
    },
    {
      id: 'locate',
      title: 'Locate pallets',
      objective: 'Place a pallet location marker',
      hint: 'Markers are flat and only collide with other markers.',
    },
    {
      id: 'flow',
      title: 'Plan the flow',
      objective: 'Combine two different equipment types',
      hint: 'Pair racking with a packing station or wire shelving. Markers and the forklift do not count.',
    },
    {
      id: 'review',
      title: 'Review',
      objective: 'Run the cinematic review',
      hint: 'Press Review in the HUD to fly around your layout.',
    },
  ],
};

const OVERLAP_OBJECTIVE = 'Clear the overlap';
const COMPLETE_OBJECTIVE = 'Layout complete';
const CORE_STEPS = 4;

export function evaluateGame(ws, collisionReport) {
  const type = ws.type === 'warehouse' ? 'warehouse' : 'store';
  const fixtures = ws.entities.filter(isFixture);
  const checks = type === 'warehouse' ? warehouseChecks(ws, fixtures) : storeChecks(ws, fixtures);
  const steps = STEPS[type].map((step) => ({ ...step, done: Boolean(checks[step.id]) }));
  const doneCount = steps.filter((step) => step.done).length;
  const currentStep = steps.find((step) => !step.done) || null;
  const collisionCount = collisionReport && Number.isFinite(collisionReport.count) ? collisionReport.count : 0;
  const complete = doneCount === steps.length;
  return {
    steps,
    currentStep,
    objectiveText: collisionCount > 0 ? OVERLAP_OBJECTIVE : currentStep ? currentStep.objective : COMPLETE_OBJECTIVE,
    percent: Math.round((doneCount / steps.length) * 100),
    fixtureCount: fixtures.length,
    collisionCount,
    coreComplete: steps.slice(0, CORE_STEPS).every((step) => step.done),
    complete,
  };
}

/** Step ids that are done but not yet celebrated. */
export function newlyCompleted(ws, evaluation) {
  const celebrated = new Set(ws.game?.celebrated || []);
  return evaluation.steps.filter((step) => step.done && !celebrated.has(step.id)).map((step) => step.id);
}

// ---------------------------------------------------------------- private helpers

/** Equipment that counts toward progress: not architecture, and `countsAsEquipment` (forklift excluded). */
function isFixture(entity) {
  if (isArchitecture(entity.type)) return false;
  const def = CATALOG_BY_ID[entity.type];
  return Boolean(def && def.countsAsEquipment);
}

function distinctTypes(entities) {
  return new Set(entities.map((entity) => entity.type)).size;
}

function storeChecks(ws, fixtures) {
  return {
    place: fixtures.length >= 1,
    arrange: Boolean(ws.game?.arranged),
    mix: distinctTypes(fixtures) >= 2,
    zone: fixtures.filter((e) => e.anchor === 'floor').length >= 2 && fixtures.some((e) => e.anchor === 'wall'),
    review: Boolean(ws.game?.reviewed),
  };
}

function warehouseChecks(ws, fixtures) {
  const flowFixtures = fixtures.filter((e) => e.type !== 'pallet-marker');
  return {
    first: fixtures.length >= 1,
    adjust: Boolean(ws.game?.arranged),
    locate: fixtures.some((e) => e.type === 'pallet-marker'),
    flow: distinctTypes(flowFixtures) >= 2,
    review: Boolean(ws.game?.reviewed),
  };
}
