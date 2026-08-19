import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { EMBLEM, GLASS, TAU } from './config.js';
import { clamp } from './utils.js';

/* ------------------------------------------------------------------ spine */

/**
 * The hook centreline: a long leg out from the central hole, a 180° bend that
 * forms the petal, then a short leg curling back in. Built from named
 * parameters so the silhouette stays tunable — see dev/shape-preview.html.
 */
export function buildSpine(hook = EMBLEM.hook) {
  const { innerRadius, archRadius, apexRadius, lean, leanPower,
          spread, shortEnd, shortCurl, shortPower } = hook;
  const deg = THREE.MathUtils.degToRad;
  const points = [];
  const push = (r, a) => points.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));

  /* `leanPower` back-loads the tangential lean: > 1 leaves the tip pointing
     straight at the centre and saves the swirl for the outer half, which is
     what keeps the central hole a clean circle rather than a spiral. */
  const span = archRadius - innerRadius;
  const legAngle = (r) =>
    deg(lean) * span * Math.pow(Math.max(0, r - innerRadius) / span, leanPower);

  const LEG = 6;
  for (let i = 0; i <= LEG; i++) {
    const r = innerRadius + (span * i) / LEG;
    push(r, legAngle(r));
  }

  // Arch — sweeps `spread` degrees while bulging out to the apex.
  const enter = legAngle(archRadius);
  const ARCH = 9;
  for (let i = 1; i < ARCH; i++) {
    const t = i / ARCH;
    push(archRadius + (apexRadius - archRadius) * Math.sin(Math.PI * t), enter + deg(spread) * t);
  }

  // Short leg — mirrors the lean on the way back in.
  const exit = enter + deg(spread);
  /* The short leg is the hook proper: `shortPower` < 1 makes it swing hard
     immediately out of the bend and then run straight inwards, which parks its
     tip midway between the two neighbouring long legs. A gradual curve instead
     drags it across the next hook — the two collide around r ≈ 0.6. */
  const SHORT = 8;
  for (let i = 0; i <= SHORT; i++) {
    const r = archRadius - ((archRadius - shortEnd) * i) / SHORT;
    push(r, exit - deg(lean * shortCurl) * span * Math.pow((archRadius - r) / span, shortPower));
  }

  return new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
}

/** Kept for the preview tool. */
export const armSpine = () => buildSpine();

/* -------------------------------------------------------- cross-section */

/**
 * Superellipse ring: a flat ribbon with softly bevelled edges — the profile of
 * a laser-cut acrylic piece, not a round tube. `bevel` 2 = ellipse, higher =
 * squarer with a tighter edge radius.
 */
function crossSection(count, halfWidth, halfThickness, bevel) {
  const e = 2 / bevel;
  const ring = [];

  for (let j = 0; j <= count; j++) {
    const v = (j / count) * TAU;
    const c = Math.cos(v);
    const s = Math.sin(v);
    const x = Math.sign(c) * Math.pow(Math.abs(c), e);
    const y = Math.sign(s) * Math.pow(Math.abs(s), e);

    // Exact normal from the implicit form |x|ⁿ + |y|ⁿ = 1.
    let nx = (Math.sign(x) * Math.pow(Math.abs(x), bevel - 1)) / halfWidth;
    let ny = (Math.sign(y) * Math.pow(Math.abs(y), bevel - 1)) / halfThickness;
    const len = Math.hypot(nx, ny) || 1;

    ring.push({ x: x * halfWidth, y: y * halfThickness, nx: nx / len, ny: ny / len });
  }
  return ring;
}

/** Circular ease used to dome the ribbon ends into round caps. */
const capEase = (x) => (x >= 1 ? 1 : Math.sqrt(1 - (1 - clamp(x)) ** 2));

/* ------------------------------------------------------------------ sweep */

/**
 * Sweeps the cross-section along a *planar* spine. Frenet frames are useless
 * here — a flat curve makes them flip at every inflection — so the frame is
 * pinned to world Z, which also guarantees the ribbon stays coplanar.
 */
class RibbonSweep {
  constructor(curve) {
    const { segments, width, thickness, bevel, radial } = EMBLEM.ribbon;

    this.curve = curve;
    this.segments = segments;
    this.radial = radial;
    this.section = crossSection(radial, width / 2, thickness / 2, bevel);
    this.spine = curve.getSpacedPoints(segments);

    // Round caps: the dome is as long as the ribbon is half-wide.
    this.capLength = Math.min(0.2, width / 2 / curve.getLength());

    const up = new THREE.Vector3(0, 0, 1);
    this.T = [];
    this.N = [];
    this.U = [];

    for (let i = 0; i <= segments; i++) {
      const t = curve.getTangentAt(i / segments).normalize();
      const n = new THREE.Vector3().crossVectors(up, t).normalize();
      this.T.push(t);
      this.N.push(n);
      this.U.push(new THREE.Vector3().crossVectors(t, n).normalize());
    }
  }

  /** Ribbon scale at arc position u — 1 through the body, 0 at each tip. */
  scaleAt(u) {
    return capEase(u / this.capLength) * capEase((1 - u) / this.capLength);
  }

  /** One vertex: position + normal for arc position i, ring position j. */
  vertex(i, j, position, normal) {
    const u = i / this.segments;
    const scale = this.scaleAt(u);
    const P = this.spine[i];
    const N = this.N[i];
    const U = this.U[i];
    const s = this.section[j];

    position.set(
      P.x + (N.x * s.x + U.x * s.y) * scale,
      P.y + (N.y * s.x + U.y * s.y) * scale,
      P.z + (N.z * s.x + U.z * s.y) * scale
    );

    if (!normal) return position;

    normal.set(
      N.x * s.nx + U.x * s.ny,
      N.y * s.nx + U.y * s.ny,
      N.z * s.nx + U.z * s.ny
    );

    // Inside a cap, tilt the normal toward the tip so the dome shades right.
    const inCap = Math.min(u / this.capLength, (1 - u) / this.capLength, 1);
    if (inCap < 1) {
      const axial = u < 0.5 ? -1 : 1;
      normal.multiplyScalar(inCap).addScaledVector(this.T[i], axial * (1 - inCap)).normalize();
    }
    return position;
  }

  toGeometry() {
    const { segments, radial } = this;
    const count = (segments + 1) * (radial + 1);
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const index = [];

    const p = new THREE.Vector3();
    const n = new THREE.Vector3();

    for (let i = 0; i <= segments; i++) {
      for (let j = 0; j <= radial; j++) {
        this.vertex(i, j, p, n);
        const o = (i * (radial + 1) + j) * 3;
        position[o] = p.x; position[o + 1] = p.y; position[o + 2] = p.z;
        normal[o] = n.x; normal[o + 1] = n.y; normal[o + 2] = n.z;
        const t = (i * (radial + 1) + j) * 2;
        uv[t] = i / segments; uv[t + 1] = j / radial;
      }
    }

    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * (radial + 1) + j;
        const b = a + radial + 1;
        index.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(index);
    return geometry;
  }
}

/* -------------------------------------------------------------- from SVG */

/**
 * Builds the emblem from real logo artwork. An SVG is the ground truth for a
 * brand mark, so when assets/logo.svg exists it wins over the parametric hook
 * below — extruded with a bevel, which is exactly what a laser-cut acrylic
 * piece is. Fills become shapes; holes are honoured.
 */
export function shapesFromSVG(svgText, minAreaRatio = EMBLEM.svg.minAreaRatio, refine = false) {
  const paths = new SVGLoader().parse(svgText).paths;
  let shapes = paths.flatMap((path) => SVGLoader.createShapes(path));

  if (!shapes.length) {
    throw new Error(
      'no fillable paths — outline any strokes before exporting ' +
      '(Illustrator: Object ▸ Path ▸ Outline Stroke; Figma: Outline Stroke)'
    );
  }

  /* Artwork auto-traced from a photo carries hundreds of tiny shading paths on
     top of the real silhouette. Extruded, those become coplanar z-fighting
     confetti — so keep only shapes with a meaningful share of the largest
     one's area. Clean vector logos are unaffected: their parts are all large. */
  if (minAreaRatio > 0 && shapes.length > 1) {
    const areas = shapes.map((shape) => Math.abs(THREE.ShapeUtils.area(shape.getPoints(24))));
    const largest = Math.max(...areas);
    const kept = shapes.filter((_, i) => areas[i] >= largest * minAreaRatio);
    if (kept.length) {
      if (kept.length < shapes.length) {
        console.info(`[emblem] kept ${kept.length}/${shapes.length} paths above ${minAreaRatio * 100}% area`);
      }
      shapes = kept;
    }
  }

  return shapes;
}

/**
 * Auto-traced outlines are dense and visibly jagged — extruded, that
 * roughness shows up along every edge of the "acrylic". Drop points that are
 * closer together than the eye can resolve, then run a few closed-contour
 * smoothing passes.
 */
function refineContour(points, minDistance, passes) {
  const out = [];
  for (const p of points) {
    if (!out.length || p.distanceTo(out[out.length - 1]) >= minDistance) out.push(p.clone());
  }
  // The contour is closed, so drop a last point that doubles up on the first.
  if (out.length > 3 && out[0].distanceTo(out[out.length - 1]) < minDistance) out.pop();
  if (out.length < 4) return points;

  const n = out.length;
  for (let pass = 0; pass < passes; pass++) {
    const src = out.map((p) => p.clone());
    for (let i = 0; i < n; i++) {
      const a = src[(i - 1 + n) % n];
      const b = src[i];
      const c = src[(i + 1) % n];
      out[i].set((a.x + 2 * b.x + c.x) / 4, (a.y + 2 * b.y + c.y) / 4);
    }
  }
  return out;
}

/** Rebuild a shape (and its holes) from refined point loops. */
function refineShape(shape, size) {
  const { simplify, smooth, curveSegments } = EMBLEM.svg;
  if (!simplify && !smooth) return shape;

  const minDistance = size * simplify;
  const { shape: outer, holes } = shape.extractPoints(curveSegments);

  const refined = new THREE.Shape(refineContour(outer, minDistance, smooth));
  refined.holes = holes.map((hole) => new THREE.Path(refineContour(hole, minDistance, smooth)));
  return refined;
}

function geometryFromSVG(svgText) {
  const shapes = shapesFromSVG(svgText);

  // Normalise to the same footprint the parametric hook uses: outer radius 1,
  // centred on the origin. Measured before extruding so the bevel is not skewed.
  const box = new THREE.Box2();
  const v = new THREE.Vector2();
  for (const shape of shapes) {
    for (const p of shape.getPoints(24)) box.expandByPoint(p);
    for (const hole of shape.holes) for (const p of hole.getPoints(24)) box.expandByPoint(p);
  }
  const centre = box.getCenter(v.clone());
  const radius = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) / 2;
  const scale = 1 / radius;

  const { thickness, bevelRatio, curveSegments } = EMBLEM.svg;
  const depth = thickness / scale;
  const bevel = depth * bevelRatio;

  const geometry = mergeGeometries(
    shapes.map((shape) =>
      new THREE.ExtrudeGeometry(refineShape(shape, radius), {
        depth: depth - bevel * 2,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        /* Without this the bevel grows *outward* from the outline: every arm
           gets `bevelSize` fatter on each side and every gap that much
           narrower. Offsetting by -bevelSize puts the widest point of the
           bevel back on the artwork's own edge, so the silhouette is the logo
           rather than a dilated copy of it. */
        bevelOffset: -bevel,
        bevelSegments: 4,
        curveSegments,
      })
    ),
    false
  );

  /* SVG's Y axis points down. Rotating 180° about X flips it *without*
     mirroring, so face winding — and therefore the normals — stay correct. */
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI));
  geometry.translate(-centre.x, centre.y, depth / 2);
  geometry.scale(scale, scale, scale);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/* ---------------------------------------------------------------- sampler */

/**
 * Area-weighted point sampler over any geometry, driven by our seeded PRNG so
 * the particle field is identical on every reload (three's MeshSurfaceSampler
 * uses Math.random and cannot be seeded).
 */
class SurfaceSampler {
  constructor(geometry) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    this.position = g.attributes.position.array;

    const faces = this.position.length / 9;
    this.cdf = new Float32Array(faces);

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    let total = 0;

    for (let f = 0; f < faces; f++) {
      const o = f * 9;
      a.fromArray(this.position, o);
      b.fromArray(this.position, o + 3);
      c.fromArray(this.position, o + 6);
      total += b.sub(a).cross(c.sub(a)).length() * 0.5;
      this.cdf[f] = total;
    }
    for (let f = 0; f < faces; f++) this.cdf[f] /= total;

    if (geometry.index) g.dispose();
  }

  sample(rng, target) {
    // Binary search the area CDF, then a uniform barycentric point.
    const x = rng();
    let lo = 0;
    let hi = this.cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cdf[mid] < x) lo = mid + 1;
      else hi = mid;
    }

    let u = rng();
    let v = rng();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }

    const o = lo * 9;
    const p = this.position;
    return target.set(
      p[o] + u * (p[o + 3] - p[o]) + v * (p[o + 6] - p[o]),
      p[o + 1] + u * (p[o + 4] - p[o + 1]) + v * (p[o + 7] - p[o + 1]),
      p[o + 2] + u * (p[o + 5] - p[o + 2]) + v * (p[o + 8] - p[o + 2])
    );
  }
}

/* ----------------------------------------------------------------- emblem */

/** Eight parametric hooks at 45°, merged into a single geometry. */
function geometryFromHooks() {
  const base = new RibbonSweep(buildSpine()).toGeometry();
  const parts = [];
  for (let i = 0; i < EMBLEM.arms; i++) {
    const g = base.clone();
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ((i / EMBLEM.arms) * TAU));
    parts.push(g);
  }
  base.dispose();

  const geometry = mergeGeometries(parts, false);
  geometry.computeBoundingSphere();
  parts.forEach((g) => g.dispose());
  return geometry;
}

export class Emblem {
  /**
   * Prefers real artwork at assets/logo.svg and falls back to the parametric
   * hook. Async because the artwork has to be fetched.
   * @returns {Promise<Emblem>}
   */
  static async load(envMap) {
    let geometry = null;
    let source = 'hooks';

    try {
      const response = await fetch(EMBLEM.svg.url, { cache: 'no-cache' });
      if (response.ok) {
        geometry = geometryFromSVG(await response.text());
        source = 'svg';
      }
    } catch (error) {
      console.warn(`[emblem] ${EMBLEM.svg.url} unusable — falling back to the parametric hook.\n`, error);
      geometry = null;
    }

    return new Emblem(envMap, geometry ?? geometryFromHooks(), source);
  }

  constructor(envMap, geometry, source = 'hooks') {
    this.source = source;
    this.sampler = new SurfaceSampler(geometry);

    this.material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(GLASS.color),
      metalness: 0,
      roughness: GLASS.roughness,
      transmission: GLASS.transmission,
      thickness: GLASS.thickness,
      ior: GLASS.ior,
      clearcoat: GLASS.clearcoat,
      clearcoatRoughness: GLASS.clearcoatRoughness,
      iridescence: GLASS.iridescence,
      iridescenceIOR: GLASS.iridescenceIOR,
      attenuationColor: new THREE.Color(GLASS.attenuationColor),
      attenuationDistance: GLASS.attenuationDistance,
      specularIntensity: GLASS.specularIntensity,
      envMap,
      envMapIntensity: GLASS.envMapIntensity,
      transparent: true,
      opacity: 0,
      depthWrite: true,
      side: THREE.FrontSide,
    });

    /* Lite mode (?lite=1): drops the transmission pass — a whole extra scene
       render per frame — in favour of a plain frosted look. Worth wiring to a
       "low power" toggle on older mobile GPUs. */
    if (new URLSearchParams(location.search).get('lite') === '1') {
      this.material.transmission = 0;
      this.material.iridescence = 0;
      this.material.roughness = 0.28;
      this.material.color.set(0xdde3ec);
    }

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;

    // spinner (rotates about EMBLEM.spinAxis) ▸ tilt ▸ mesh
    this.spinner = new THREE.Group();
    this.spinner.add(this.mesh);

    this.group = new THREE.Group();
    this.group.rotation.x = EMBLEM.tilt;
    this.group.scale.setScalar(EMBLEM.scale);
    this.group.add(this.spinner);
  }

  /** Drive from the timeline. */
  update({ spin, reveal, scale }) {
    // The spinner sits at the emblem's centre, so this is pure rotation —
    // the hub never moves, whichever axis it turns about.
    this.spinner.rotation.set(0, 0, 0);
    this.spinner.rotation[EMBLEM.spinAxis] = spin;
    this.material.opacity = reveal;
    this.mesh.visible = reveal > 0.002;
    this.group.scale.setScalar(EMBLEM.scale * scale);
    this.group.updateMatrixWorld(true);
  }

  /** Random point on the emblem surface, in emblem-local space. */
  sampleSurface(rng, target = new THREE.Vector3()) {
    return this.sampler.sample(rng, target);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
