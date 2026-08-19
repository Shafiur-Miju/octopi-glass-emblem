/**
 * config.js — every tunable in one place.
 * Nothing here touches three.js, so it is safe to import anywhere.
 */

export const TAU = Math.PI * 2;

/** Full cycle length in seconds. Everything below is phase-locked to it. */
export const LOOP = 16;

/**
 * Normalised timeline (0..1 of LOOP). Overlaps are intentional — the glass
 * fades in while the last dots are still landing, and out before they leave.
 */
export const TIMELINE = {
  gather:   [0.22, 0.45], // wave ▸ vortex ▸ emblem shell
  reveal:   [0.40, 0.52], // glass materialises
  conceal:  [0.64, 0.74], // glass fades back out
  dissolve: [0.66, 0.94], // emblem shell ▸ vortex ▸ wave
};

export const CAMERA = {
  fov: 38,
  near: 0.1,
  far: 120,
  position: [0, 1.62, 12.4],
  target: [0, 0.02, 0],
  parallax: 0.55,   // world units of pointer-driven sway
  damping: 0.045,
};

export const WAVE = {
  cols: 190,          // lattice columns (rows derive from the budget)
  depth: 22,          // world units along Z
  widthPadding: 1.55, // field width = visible width × this
  baseY: -1.18,
  amplitude: 0.68,
  /** Spatial frequencies for the three summed sine bands. */
  freq: [0.42, 0.55, 0.27],
  /** Temporal harmonics (integers ⇒ perfectly periodic over LOOP). */
  harmonics: [3, 2, 1],
  /** Horizontal drift measured in whole grid columns per LOOP (integer!). */
  driftColumns: 62,
};

export const PARTICLES = {
  countDesktop: 22000,
  countMobile: 9000,
  size: 7.6,          // px at 1× DPR, 10 world units away
  color: 0x9aa2ae,
  opacity: 0.9,
  stagger: 0.70,      // spread of per-particle departure times
  spins: 1.15,        // base revolutions taken through the vortex
  throat: 0.55,       // world radius of the vortex eye at mid-morph
  lift: 1.35,         // how high the outer dots arc over the eye
};

export const EMBLEM = {
  arms: 8,
  scale: 2.55,
  tilt: -0.10,        // fixed X tilt of the whole assembly

  /**
   * 'z' spins the emblem in its own plane, like a wheel on a fixed hub — it
   * always faces the camera. 'y' turns it about the vertical axis instead, so
   * it passes through edge-on each half turn.
   */
  spinAxis: 'z',
  /* Revolutions per cycle. Whole numbers only, or the loop seams. The sign is
     the direction: negative turns clockwise (the top edge travels right),
     positive turns anticlockwise. */
  turnsPerLoop: -2,
  faceAt: 0.585,      // 'y' axis only: progress at which the emblem faces the camera

  /**
   * Real artwork wins over the parametric hook below. Drop the logo here and
   * it is extruded with a bevel — a laser-cut acrylic piece, exactly.
   */
  svg: {
    url: 'assets/logo.svg',
    /* Drop paths smaller than this share of the largest one. Auto-traced
       artwork carries hundreds of tiny shading paths; clean vector logos are
       unaffected. Set to 0 to keep every path. */
    minAreaRatio: 0.15,
    thickness: 0.075,   // extruded depth, in emblem units (outer radius = 1)
    bevelRatio: 0.28,   // share of the depth given to the rounded edge
    curveSegments: 12,  // curve subdivision when sampling the artwork
    /* Optional clean-up for rough artwork, off by default: this trace is
       already smooth at its own point spacing, so smoothing only moves the
       outline away from the logo. Raise only if an outline looks jagged. */
    simplify: 0,        // drop contour points closer than this × the radius
    smooth: 0,          // closed-contour smoothing passes
  },

  /** Fallback: flat acrylic ribbon swept along the parametric spine. */
  ribbon: {
    width: 0.15,      // in-plane stroke width (emblem-local units, outer r = 1)
    thickness: 0.058, // out-of-plane depth — a flat plate, ~3:1 to the width
    bevel: 6.5,       // superellipse exponent: 2 = round, ∞ = square edge
    segments: 300,
    radial: 26,
  },

  /**
   * The hook, as named parameters rather than magic control points.
   * Outer radius of the whole emblem is 1. Angles in degrees.
   *
   *        apex ___
   *            /   \      ← arch: the 180° bend that forms one petal
   *      long |     | short
   *       leg |     | leg
   *           ·     ·     ← rounded tips
   */
  hook: {
    innerRadius: 0.26,  // where the long leg's tip stops — sets the centre hole
    archRadius:  0.72,  // radius at which the bend starts and ends
    apexRadius:  0.93,  // bulge ≈ half the leg separation ⇒ a semicircular petal
    lean:        16,    // degrees of tangential sweep per unit of radius
    leanPower:   1.3,   // >1 back-loads the swirl, so tips leave the hole radially
    spread:      33,    // angular width of the bend ⇒ petal width and slot
    shortEnd:    0.52,  // where the short leg's tip stops
    shortCurl:   1.2,   // short leg's lean, as a multiple of the long leg's
    shortPower:  0.95,  // <1 turns it sharply out of the bend, then runs straight
  },
};

export const GLASS = {
  color: 0xffffff,
  transmission: 1.0,
  roughness: 0.16,   // ↑ toward 0.35 for a frosted/acrylic read, ↓ for optical glass
  thickness: 0.42,
  ior: 1.47,
  clearcoat: 1.0,
  clearcoatRoughness: 0.06,
  iridescence: 0.35,
  iridescenceIOR: 1.32,
  attenuationColor: 0xdfe7f2,
  attenuationDistance: 1.6,
  envMapIntensity: 1.15,
  specularIntensity: 1.0,
};

/** Derived helpers ------------------------------------------------------ */

export const isCoarsePointer = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(pointer: coarse)').matches;

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function particleCount() {
  const base = isCoarsePointer() ? PARTICLES.countMobile : PARTICLES.countDesktop;
  const area = window.innerWidth * window.innerHeight;
  const scale = Math.min(1, Math.max(0.45, area / (1600 * 900)));
  return Math.round(base * scale);
}
