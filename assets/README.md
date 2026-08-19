# assets

`logo.svg` here is the emblem's source — it is built from this file
automatically — extruded with a bevel, so it renders as a laser-cut acrylic
piece. The particle field samples that same geometry, so the dots form the real
mark too. No other change is needed; reload the page.

Requirements:

- **Filled paths, not strokes.** Outline any strokes before exporting
  (Illustrator: Object ▸ Path ▸ Outline Stroke · Figma: Outline Stroke).
  Stroked paths carry no fill area, so there is nothing to extrude.
- Holes are honoured — use `fill-rule="evenodd"` for counters and cut-outs.
- Artwork is auto-centred and scaled to a radius of 1, so the viewBox and units
  do not matter.
- Depth and edge bevel come from `EMBLEM.svg` in `js/config.js`.

The current file was auto-traced from a photo, so `EMBLEM.svg.minAreaRatio`
drops the trace's shading paths and `simplify`/`smooth` even out its jagged
outline. **Original vector artwork would be cleaner** — drop it in as
`logo.svg` and set those three to 0.

Delete this file and the emblem falls back to the parametric hook in
`EMBLEM.hook` — a close approximation, but not the real mark. The debug panel
(press `D`, or load `?debug=1`) shows which one is live.
