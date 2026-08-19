import { TIMELINE, EMBLEM, TAU } from './config.js';
import { smootherstep, easeOutBack, lerp, clamp } from './utils.js';

/**
 * The whole animation is a pure function of loop progress `p` ∈ [0, 1).
 * Because every returned value is identical at p = 0 and p = 1, the cycle
 * cuts back to the top with no visible seam.
 */
export function evaluate(p) {
  const [g0, g1] = TIMELINE.gather;
  const [r0, r1] = TIMELINE.reveal;
  const [c0, c1] = TIMELINE.conceal;
  const [d0, d1] = TIMELINE.dissolve;

  // 0 = dots live in the wave, 1 = dots sit on the emblem shell.
  const morph = Math.min(
    smootherstep(g0, g1, p),
    1 - smootherstep(d0, d1, p)
  );

  // 0 = no glass, 1 = fully materialised glass.
  const reveal = Math.min(
    smootherstep(r0, r1, p),
    1 - smootherstep(c0, c1, p)
  );

  return {
    morph,
    reveal,
    /** Dots step aside (but never fully) once the glass owns the frame. */
    particleFade: 1 - 0.93 * reveal,
    /* Integer turns per loop keeps the spin phase-locked to the cycle. A wheel
       ('z') needs no phase offset — it always faces the camera. Turning about
       'y' does: the offset parks "face-on" in the middle of the visible window
       so the emblem sweeps ±60° instead of vanishing edge-on mid-reveal. */
    spin: TAU * EMBLEM.turnsPerLoop * (EMBLEM.spinAxis === 'y' ? p - EMBLEM.faceAt : p),
    /** A touch of scale-pop on materialise. */
    scale: lerp(0.84, 1, clamp(easeOutBack(reveal), 0, 1.08)),
    /** Fake contact shadow tracks the glass. */
    shadow: reveal,
    /* Departure order has to flip for the outbound leg, otherwise the dots
       that flew in first would also be the last to leave and the whole field
       would sit bunched around the emblem. Safe to switch anywhere inside
       the hold, where every dot is clamped at morph = 1 regardless. */
    reverse: p >= 0.55 ? 1 : 0,
  };
}

/** Wrap elapsed seconds into loop progress. */
export const progressOf = (elapsed, loop) => (elapsed % loop) / loop;
