# Airfall

A 3D simulation of how objects interact with the air as they fall: leaves flutter, cards tumble, maple seeds
autorotate, shuttlecocks turn nose-first, and glider designs either fly or don't. Built for the phone: open
`index.html` (or the published artifact), pick an object, press **Drop**.

## What is simulated

Every object is a rigid body (6 degrees of freedom, quaternion attitude, full inertia tensor) built from
thin flat panels, spheres and point masses. Each panel is subdivided; every sub-panel sees its own local
relative wind, including the contribution of the body's spin, so rotational damping, autorotation, flutter
and tumbling emerge from one model rather than being scripted.

Per sub-panel (`src/aero.js`):

- **Attached flow**: lift slope `2π·AR/(AR+2)` with the wing's true aspect ratio, induced drag
  `CL²/(π·e·AR)`, optional camber (zero-lift angle) and reflex (`cm0`), and a leading-edge suction
  fraction that distinguishes a sharp flat plate (resultant normal to the plate) from an airfoil
  (lift perpendicular to the flow).
- **Stall**: smooth blend to flat-plate normal force `cd90·sin α` beyond the stall angle.
- **Centre of pressure** walks from the quarter chord toward mid-chord as `0.25 + 0.25·sin α`,
  implemented as a chordwise weighting of the sub-panel forces. This is what pitches a gliding card
  nose-up and what a glider's tail or reflex has to counter.
- **Wake torque**: a quasi-steady model makes a broadside fall perfectly stable (a plate is a
  parachute). An added-mass-scaled torque (`ρ·π·c²/4·b`) on separated flow tips the plate off broadside;
  its gain is calibrated so that a light sheet flutters and a dense card tumbles, matching the
  areal-density trend seen in falling-plate experiments.
- Closed bodies (the box) use one-sided faces with base suction on the lee side; spheres get pure drag;
  bluff bodies get a slow random vortex-shedding torque.

Integration is semi-implicit Euler with automatic sub-stepping from a stiffness estimate, Euler's
equations in the body frame, and ground contact at the lowest extremity.

## Gliders

`src/objects.js` holds a parametric glider (span, chord, taper, sweep, dihedral, incidence, wing position,
camber, airfoil fraction, reflex, tail area and arm, tail incidence, fin, nose weight, skin weight). The
designer reports mass, static margin (centre of mass to neutral point, in chords), and runs a trim analysis:
the angle of attack where the pitching moment crosses zero with a stable slope, the airspeed where lift
balances weight there, and the resulting L/D. Gliders launch at that trim speed by default. Presets:
trainer glider, paper dart, flying wing (reflexed), the same wing untrimmed, and a tail-heavy trainer.

## Files

- `src/aero.js` – aerodynamics and rigid-body core, no dependencies, runs in node.
- `src/objects.js` – object catalogue and glider designer.
- `src/app.js`, `src/page.html` – three.js scene, controls, HUD.
- `build.mjs` – inlines everything into `dist/index.html` (artifact fragment) and `index.html` (full page).
- `test/*.js` – headless checks: `node test/run.js` drops every object and prints what it did;
  `node test/trim.js` trims and flies each glider preset.

```
node build.mjs
node test/run.js
```
