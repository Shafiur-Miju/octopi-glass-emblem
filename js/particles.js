import * as THREE from 'three';
import { WAVE, PARTICLES, LOOP, TAU } from './config.js';
import { makeRandom } from './utils.js';

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uMorph;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uFade;
  uniform float uStagger;
  uniform float uReverse;
  uniform float uSpins;
  uniform float uThroat;
  uniform float uLift;
  uniform float uAmp;
  uniform float uBaseY;
  uniform float uDrift;
  uniform vec2  uField;   // width, depth
  uniform vec3  uOmega;   // temporal harmonics
  uniform vec3  uFreq;    // spatial frequencies
  uniform mat4  uEmblemMatrix;

  attribute vec2  aGrid;    // 0..1 lattice coordinate
  attribute vec3  aEmblem;  // target point on the emblem shell
  attribute float aRand;    // morph stagger
  attribute float aTwist;   // vortex personality

  varying float vAlpha;
  varying float vShade;

  const float PI  = 3.141592653589793;
  const float TAU = 6.283185307179586;

  void main() {
    float halfW = uField.x * 0.5;
    float halfD = uField.y * 0.5;

    /* ---- 1. the flowing sine field ------------------------------------
       Drift wraps by whole grid columns per loop, and nothing here depends
       on the particle *index* — so the field maps exactly onto itself and
       the cut back to t = 0 is invisible.                                */
    float x = aGrid.x * uField.x - halfW + uTime * uDrift;
    x = mod(x + halfW, uField.x) - halfW;
    float z = aGrid.y * uField.y - halfD;

    float h = sin(x * uFreq.x + uTime * uOmega.x) * 0.60
            + sin(z * uFreq.y - uTime * uOmega.y) * 0.34
            + sin((x + z) * uFreq.z + uTime * uOmega.z) * 0.26;

    vec3 wavePos = vec3(x, uBaseY + h * uAmp, z);

    float edge = (1.0 - smoothstep(halfW * 0.56, halfW * 0.99, abs(x)))
               * (1.0 - smoothstep(halfD * 0.52, halfD * 0.99, abs(z)));

    /* ---- 2. the emblem shell ------------------------------------------ */
    vec3 emblemPos = (uEmblemMatrix * vec4(aEmblem, 1.0)).xyz;

    /* ---- 3. cylindrical morph = free vortex ---------------------------
       Interpolating polar coordinates (not XYZ) is what turns a straight
       A▸B tween into a spiral. Radius funnels down to a throat at mid-path
       and blooms back out onto the emblem; the winding is proportional to
       the start radius, so the outer dots trail into real spiral arms.   */
    vec2 pw = wavePos.xz;
    vec2 pe = emblemPos.xz;
    float rw = length(pw);
    float re = length(pe);
    float aw = atan(pw.y, pw.x);
    float ae = atan(pe.y, pe.x);
    float rNorm = clamp(rw / halfW, 0.0, 1.0);

    // Outer dots move first, with a pinch of per-dot randomness on top —
    // and the order mirrors on the way back out (see timeline.reverse).
    float delay = uStagger * clamp(0.78 * (1.0 - rNorm) + 0.22 * aRand, 0.0, 1.0);
    delay = mix(delay, uStagger - delay, uReverse);
    float t = clamp(uMorph * (1.0 + uStagger) - delay, 0.0, 1.0);
    float k = t * t * (3.0 - 2.0 * t);

    // Shortest-arc base rotation…
    float da = mod(ae - aw + PI, TAU) - PI;

    /* …plus a *transient* swirl. sin(PI·k) is zero at both ends, so however
       many turns a dot takes on the way it still lands exactly on its wave
       node (k=0) and exactly on its emblem node (k=1) — no drift, no seam. */
    float phase = sin(PI * k);
    float swirl = phase * TAU * uSpins * (0.30 + rNorm * 0.95 + (aTwist - 0.5) * 0.14);

    float radius = k < 0.5
      ? mix(rw, uThroat, smoothstep(0.0, 1.0, k * 2.0))
      : mix(uThroat, re, smoothstep(0.0, 1.0, k * 2.0 - 1.0));
    float angle = aw + da * k + swirl;
    float y = mix(wavePos.y, emblemPos.y, k)
            + phase * (rNorm * uLift - 0.10)
            + phase * (aTwist - 0.5) * 0.32;

    vec3 pos = vec3(cos(angle) * radius, y, sin(angle) * radius);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float lift = h * 0.5 + 0.5;
    gl_PointSize = uSize * uPixelRatio * (10.0 / max(0.001, -mv.z))
                 * (0.82 + 0.34 * lift) * mix(1.0, 0.78, k);

    vShade = mix(0.82 + 0.26 * lift, 1.0, k * 0.6);
    vAlpha = mix(edge, 1.0, k) * uFade;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3  uColor;
  uniform float uOpacity;

  varying float vAlpha;
  varying float vShade;

  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float dist = dot(d, d);
    if (dist > 0.25) discard;

    float a = smoothstep(0.25, 0.015, dist);
    gl_FragColor = vec4(uColor * vShade, a * vAlpha * uOpacity);

    #include <colorspace_fragment>
  }
`;

export class ParticleField {
  /**
   * @param {Emblem} emblem  provides the shell target points
   * @param {number} count   particle budget
   */
  constructor(emblem, requested) {
    const rng = makeRandom(0x5eed17);

    // Snap the budget to a complete lattice: a partial last row would break
    // the drift's exact self-mapping (and therefore the seam).
    const cols = WAVE.cols;
    const rows = Math.max(8, Math.round(requested / cols));
    const count = cols * rows;
    this.count = count;
    this.rows = rows;

    const grid = new Float32Array(count * 2);
    const shell = new Float32Array(count * 3);
    const rand = new Float32Array(count);
    const twist = new Float32Array(count);

    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      // Lattice coordinate — jittered by a *stable* half-cell so the grid
      // never looks mechanical, while staying a pure function of position.
      const col = i % cols;
      const row = (i - col) / cols;
      grid[i * 2]     = col / cols;
      grid[i * 2 + 1] = (row + (col % 2) * 0.5) / rows;

      emblem.sampleSurface(rng, p);
      shell[i * 3] = p.x; shell[i * 3 + 1] = p.y; shell[i * 3 + 2] = p.z;

      rand[i] = rng();
      twist[i] = rng();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aGrid', new THREE.BufferAttribute(grid, 2));
    geometry.setAttribute('aEmblem', new THREE.BufferAttribute(shell, 3));
    geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
    geometry.setAttribute('aTwist', new THREE.BufferAttribute(twist, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);

    const w = TAU / LOOP; // one harmonic
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime:   { value: 0 },
        uMorph:  { value: 0 },
        uFade:   { value: 1 },
        uSize:   { value: PARTICLES.size },
        uPixelRatio: { value: 1 },
        uStagger: { value: PARTICLES.stagger },
        uReverse: { value: 0 },
        uSpins:   { value: PARTICLES.spins },
        uThroat:  { value: PARTICLES.throat },
        uLift:    { value: PARTICLES.lift },
        uAmp:    { value: WAVE.amplitude },
        uBaseY:  { value: WAVE.baseY },
        uDrift:  { value: 0 },
        uField:  { value: new THREE.Vector2(40, WAVE.depth) },
        uOmega:  { value: new THREE.Vector3(...WAVE.harmonics.map((n) => n * w)) },
        uFreq:   { value: new THREE.Vector3(...WAVE.freq) },
        uColor:  { value: new THREE.Color(PARTICLES.color) },
        uOpacity: { value: PARTICLES.opacity },
        uEmblemMatrix: { value: new THREE.Matrix4() },
      },
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1;
  }

  /** Field width follows the viewport so dots always reach both edges. */
  resize(visibleWidth, pixelRatio) {
    const width = visibleWidth * WAVE.widthPadding;
    this.material.uniforms.uField.value.x = width;
    this.material.uniforms.uPixelRatio.value = pixelRatio;
    // Whole columns per loop ⇒ the lattice lands back on itself.
    this.material.uniforms.uDrift.value = (width / WAVE.cols) * WAVE.driftColumns / LOOP;
  }

  update(time, state, emblemMatrix) {
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uMorph.value = state.morph;
    u.uFade.value = state.particleFade;
    u.uReverse.value = state.reverse;
    u.uEmblemMatrix.value.copy(emblemMatrix);
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
