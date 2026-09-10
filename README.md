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

## Any 3D model as a single mesh

Press **Open STL / OBJ…** (binary or ASCII STL, OBJ with polygon faces). The model is treated as one
triangle mesh (`buildMeshBody` in `src/aero.js`):

- Every triangle is an aerodynamic element with its own local wind. Connected, near-coplanar triangles
  are grouped into flat regions; each region acts as one plate for the chordwise pressure weighting,
  the aspect ratio and the wake torque, so a wing cut out of a solid still gets a wing's centre of
  pressure and lift slope.
- A closed solid's two skins share one plate's force (each skin carries half; the lee skin's separated
  contribution is weaker, like base pressure). An open surface works on both sides.
- Blunt faces with a long body behind them (a slab's leading edge, a fuselage nose) get their separated
  drag reduced by a reattachment factor that grows with afterbody length over face height.
- Mass is spread by volume through a closed solid or by area over a shell; the inertia tensor is
  integrated exactly over the tetrahedra of the mesh. Nose ballast is a point mass at the front-most
  vertex, which is how you move the centre of gravity of a uniform-density model until it trims.
- **Mesh resolution** subdivides every triangle into four (up to 12 000 faces): a finer mesh samples
  the local wind and the body's spin more finely, so accuracy improves with resolution.

Sample meshes exercise the same path: the playing card as a 0.3 mm slab, a cube, an icosphere, a folded
paper dart as an open surface, and the trainer glider built as one solid. `node test/mesh.js` drops each
at three resolutions; `node test/mcard.js` compares the mesh card with the panel card at three densities.

## The solid foam glider

`src/foam.js` builds a moulded foam chuck glider as one watertight mesh. The shape is a signed-distance
field: a body-of-revolution fuselage, a NACA 4412 wing lofted with taper, sweep, dihedral and incidence,
a NACA 0012 tailplane and fin, joined with a smooth union so the roots blend like foam. The surface is
extracted with surface nets on a rectilinear grid (finer across the fuselage and fin), which is closed
and connected by construction; the Model panel's resolution setting picks the carving grid.

For closed solids the aerodynamics work on mid-surface elements: every skin triangle finds the triangle
facing back at it through the material and the pair becomes a plate element on the camber surface, so a
thick airfoil is treated the way thin-airfoil theory treats it. Triangles with nothing thin behind them
(the nose, blunt edges) stay bluff facets. Places where pairs cross in two directions are bodies, which
form their own regions. Lifting regions get strip-wise chords, an aspect ratio from span over median
chord, and a zero-lift angle and quarter-chord moment integrated from the section slopes with the
thin-airfoil weights. `node test/camber.js` checks an isolated NACA 4412 wing against theory;
`node test/foam.js` carves the glider at three grid levels and flies it.

## Gliders

`src/objects.js` holds a parametric glider (span, chord, taper, sweep, dihedral, incidence, wing position,
camber, airfoil fraction, reflex, tail area and arm, tail incidence, fin, nose weight, skin weight). The
designer reports mass, static margin (centre of mass to neutral point, in chords), and runs a trim analysis:
the angle of attack where the pitching moment crosses zero with a stable slope, the airspeed where lift
balances weight there, and the resulting L/D. Gliders launch at that trim speed by default. Presets:
trainer glider, paper dart, flying wing (reflexed), the same wing untrimmed, and a tail-heavy trainer.

## Files

- `src/aero.js` – aerodynamics and rigid-body core, no dependencies, runs in node.
- `src/objects.js` – object catalogue, glider designer, mesh builders, STL/OBJ parsers.
- `src/app.js`, `src/page.html` – three.js scene, controls, HUD.
- `build.mjs` – inlines everything into `dist/index.html` (artifact fragment) and `index.html` (full page).
- `test/*.js` – headless checks: `node test/run.js` drops every object and prints what it did;
  `node test/trim.js` trims and flies each glider preset.

```
node build.mjs
node test/run.js
```
