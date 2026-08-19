# Dotted Wave ▸ Vortex ▸ Glass Emblem

A seamless looping WebGL piece on a clean white background:

1. **Dotted wave grid** — a drifting sine-wave particle field in soft light grey.
2. **Particle transition** — the dots funnel into a central vortex/spiral.
3. **3D glass emblem** — the logo as a bevelled acrylic plate, shaded with a
   physical transmission material and spinning in its own plane like a wheel on
   a fixed hub. Built from real artwork at `assets/logo.svg` when present;
   otherwise from the parametric hook below.
4. **Dissolve** — the emblem breaks back into the flowing dots, and the cycle
   cuts back to frame one with no visible seam.

## Run it

ES modules need a real origin, so open it through a server rather than `file://`:

```bash
npx serve .          # or: python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

Three.js r169 is pulled from a CDN via the import map in `index.html`. To vendor
it instead, drop the build into `vendor/` and repoint the two import-map entries.

## Controls

| Input | Action |
| --- | --- |
| `Space` | pause / resume |
| `D` | debug panel (phase, progress, particle count, DPR) |
| `R` | restart the cycle |
| pointer | damped camera parallax |
| `?t=9.4` | jump to a moment in the cycle (seconds) |
| `?still=1` | freeze there — handy for grabbing stills |
| `?lite=1` | skip the transmission pass on low-power GPUs |
| `?debug=1` | open the debug panel on load |

## Files

```
index.html          markup + import map
css/styles.css      page chrome, HUD, loader
js/config.js        every tunable — timings, geometry, material, budgets
js/utils.js         easing, deterministic PRNG, frame-rate-independent damping
js/timeline.js      the cycle as a pure function of progress p ∈ [0,1)
js/environment.js   procedural studio IBL, lights, contact shadow
js/emblem.js        SVG import, parametric fallback, glass material, sampler
assets/logo.svg     ← drop the real logo here (see assets/README.md)
dev/shape-preview.html  2D silhouette sweep for tuning the fallback
js/particles.js     the GPU particle system (wave, vortex and morph shaders)
js/main.js          renderer, resize, input, render loop
```

## How the loop stays seamless

Everything is a pure function of loop progress, and every term returns to its
starting value at `p = 1`:

- **Wave.** Temporal frequencies are integer harmonics of `2π/LOOP`. The
  horizontal drift advances a whole number of grid columns per cycle, so the
  lattice maps exactly onto itself. Nothing in the wave phase depends on a
  particle's *index* — only on its wrapped position — which is what makes that
  self-mapping invisible.
- **Vortex.** The morph interpolates *polar* coordinates instead of XYZ, which
  is what bends a straight A→B tween into a spiral. Radius funnels to a throat
  at mid-path, then blooms onto the emblem. The extra winding rides on a
  `sin(π·k)` envelope, so however many turns a dot takes it still lands exactly
  on its wave node at `k = 0` and its emblem node at `k = 1`.
- **Emblem.** Whole revolutions per cycle, so the wheel is back at its starting
  angle at `p = 1`. The spinner sits at the emblem's centre, making it pure
  rotation — the hub never drifts.
- **Departure order** flips for the outbound leg (`timeline.reverse`), switched
  during the hold where every dot is clamped at `morph = 1` and the change
  cannot be seen.

## The emblem geometry

### Spin

`EMBLEM.spinAxis` picks how the emblem turns:

| Value | Motion |
| --- | --- |
| `'z'` (current) | spins in its own plane, like a wheel on a fixed hub — always faces the camera |
| `'y'` | turns about the vertical axis, passing through edge-on each half turn |

`turnsPerLoop` is revolutions per cycle — keep it a whole number or the loop
seams, and make it negative to reverse direction. `tilt` leans the whole
assembly back so the plate catches light and shows its thickness; set it to `0`
for a dead-on wheel.

On `'y'`, `faceAt` parks "face-on" in the middle of the visible window so the
emblem sweeps ±60° instead of vanishing edge-on mid-reveal. It is ignored on
`'z'`, which needs no such offset.

### Real artwork (what is in use)

The logo lives at **`assets/logo.svg`** and the emblem is built from it — parsed
with `SVGLoader`, extruded with a bevel (which is what a laser-cut acrylic piece
is), auto-centred and scaled to a radius of 1. The particle field samples that
same geometry, so the dots form the real mark too. Press `D` (or load `?debug=1`)
to confirm which source is live.

The current file was auto-traced from a photo, so one bit of cleanup is needed
— `EMBLEM.svg.minAreaRatio`. A trace turns every shading gradient into its own
path (this file has 384 paths in 313 greys); extruded, they become coplanar
z-fighting confetti. Keeping only paths above 15% of the largest one's area
leaves the single true silhouette. Clean vector logos are unaffected — their
parts are all large. Set it to `0` to keep everything.

`simplify` and `smooth` can decimate and even out a rough outline, but are
**off**: this trace is already smooth at its own point spacing, so they only
move the outline away from the logo. Verify with the fidelity tool below —
it measures the deviation between the processed outline and the source.

`thickness` and `bevelRatio` set the plate depth and edge radius, and
`bevelOffset: -bevelSize` in [emblem.js](js/emblem.js) is what keeps the
silhouette honest: `ExtrudeGeometry`'s bevel grows *outward* from the outline
by default, fattening every arm by `bevelSize` on each side and narrowing every
gap by the same amount. The negative offset puts the widest point of the bevel
back on the artwork's own edge.

`thickness` and `bevelRatio` set the plate depth and edge radius.

**If you have the original vector artwork, drop it in instead** — it will be
cleaner than a trace at every zoom level. Requirements: filled paths, not
strokes (outline strokes before exporting — a stroked path has no fill area to
extrude), and `fill-rule="evenodd"` for holes. With clean artwork you can set
`minAreaRatio: 0`, `simplify: 0` and `smooth: 0`.

### Checking fidelity

`dev/shape-preview.html` renders the silhouette in 2D canvas — no WebGL, so it
is instant — and overlays the **source outline in red** on the processed fill,
printing the max and average deviation as a share of the emblem radius:

```
/dev/shape-preview.html?svg=1&px=330&v=[[0,0,12]]        # current settings
/dev/shape-preview.html?svg=1&v=[[0,0,4],[0.004,3,4]]    # compare processing
/dev/shape-preview.html?svg=1&zoom=4&focus=0.5,0.4       # zoom into one region
```

Each entry of `v` is `[simplify, smooth, curveSegments]`. `0.00%` deviation
means the outline is the artwork.

### Fallback: the parametric hook

Without artwork, `EMBLEM.hook` builds an approximation of the mark — eight
hooks, each a long leg out from the central hole, a 180° bend forming a petal,
and a short leg curling back:

| Parameter | Effect |
| --- | --- |
| `innerRadius` | where the long leg stops — sets the size of the central hole |
| `archRadius` / `apexRadius` | where the bend sits and how far it bulges |
| `spread` | angular width of the bend ⇒ petal width and slot |
| `lean` | degrees of tangential sweep per unit radius ⇒ how much it swirls |
| `leanPower` | `> 1` back-loads that swirl, so tips leave the hole radially |
| `shortEnd` / `shortCurl` / `shortPower` | length and hook of the short leg |
| `ribbon.*` | stroke width, plate thickness, and edge bevel |

Note the crowding constraint: at the bend radius, two leg widths plus the slot
plus the gap to the next hook must fit inside 45°. Push `spread` or `width` too
far and the short leg collides with the neighbouring long leg around r ≈ 0.6.

`dev/shape-preview.html` draws the silhouette in 2D canvas — no WebGL, so it
renders instantly and you can compare many variants at once:

```
/dev/shape-preview.html?px=460                      # current config, large
/dev/shape-preview.html?v=[{"lean":18},{"spread":40}] # sweep param patches
```

Each entry in `v` is a patch over `EMBLEM.hook` (plus an optional `width`).
Copy the winner's numbers into `EMBLEM.hook`.

## Performance notes

- One `THREE.Points` draw call. All wave, vortex and morph maths runs in the
  vertex shader — the CPU only updates a handful of uniforms per frame.
- The ribbon is swept with frames pinned to world Z rather than Frenet frames,
  which would flip at every inflection of a planar curve.
- Particle targets come from a seeded area-weighted sampler over the emblem
  geometry, so the field is identical on every reload and works with any shape
  — parametric or imported.
- The eight arms are merged into a single geometry so the transmission pass
  (an extra scene render) runs once, not eight times.
- Particle budget scales with viewport area and pointer type; `#autoQuality`
  steps the device pixel ratio down (never below 1×) if frame time slips.
- `prefers-reduced-motion` slows the cycle and disables parallax.
