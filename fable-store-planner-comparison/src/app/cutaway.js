// Dollhouse cutaway: walls whose outer side faces the camera fade out (and become click-through)
// so the interior is always visible while orbiting.

export function createCutaway(roomView, camera) {
  const state = new Map(); // wallId -> faded boolean
  let firstPass = true;

  function shouldFade(frame) {
    // Camera on the outer side of the wall plane => the wall is between the camera and the interior.
    const rx = camera.position.x - frame.start.x;
    const rz = camera.position.z - frame.start.z;
    const side = rx * frame.normal.x + rz * frame.normal.z;
    return side < -0.05;
  }

  /** Recompute fades; returns true when any wall changed state. */
  function update() {
    let changed = false;
    for (const [wallId, wall] of Object.entries(roomView.walls)) {
      const faded = shouldFade(wall.frame);
      if (state.get(wallId) !== faded) {
        state.set(wallId, faded);
        roomView.setWallFade(wallId, faded, firstPass);
        changed = true;
      }
    }
    firstPass = false;
    return changed;
  }

  /** Call after the room was rebuilt: apply the current fades immediately. */
  function reset() {
    state.clear();
    firstPass = true;
    update();
  }

  function isFaded(wallId) { return state.get(wallId) === true; }

  return { update, reset, isFaded };
}
