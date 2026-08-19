import * as THREE from 'three';

/**
 * A procedural "white studio": three emissive softboxes inside a bright shell,
 * baked into a PMREM cubemap. This is what gives the glass its edges — on a
 * pure-white page a transmissive material with no environment reads as invisible.
 */
export function createStudioEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const scene = new THREE.Scene();

  // Enclosing shell: bright top, cooler floor.
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(12, 32, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top:    { value: new THREE.Color(0xffffff) },
        bottom: { value: new THREE.Color(0xd8dde6) },
      },
      vertexShader: /* glsl */ `
        varying float vH;
        void main() {
          vH = normalize(position).y * 0.5 + 0.5;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 bottom;
        varying float vH;
        void main() {
          gl_FragColor = vec4(mix(bottom, top, smoothstep(0.15, 0.9, vH)), 1.0);
        }
      `,
    })
  );
  scene.add(shell);

  // [w, h, intensity, color, position, lookAt-ish rotation]
  const boxes = [
    { size: [9, 5], color: 0xffffff, power: 6.5, pos: [0, 7.5, 1.5],   rot: [Math.PI / 2, 0, 0] },
    { size: [5, 7], color: 0xeaf1ff, power: 3.4, pos: [-7, 1.5, 3.5],  rot: [0, Math.PI / 2.6, 0] },
    { size: [4, 6], color: 0xfff4e8, power: 2.6, pos: [7, 0.5, -2],    rot: [0, -Math.PI / 2.2, 0] },
    { size: [8, 4], color: 0xffffff, power: 1.6, pos: [0, -0.5, -8],   rot: [0, 0, 0] },
  ];

  for (const b of boxes) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(b.size[0], b.size[1]),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(b.color).multiplyScalar(b.power) })
    );
    mesh.position.set(...b.pos);
    mesh.rotation.set(...b.rot);
    scene.add(mesh);
  }

  const target = pmrem.fromScene(scene, 0.035);

  // The source scene is disposable; the render target is what we keep.
  scene.traverse((o) => {
    if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
  });
  pmrem.dispose();

  return target.texture;
}

/** Direct lights on top of the IBL: crisp speculars + a hint of rim. */
export function createLights() {
  const group = new THREE.Group();

  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(4.5, 6.5, 6);

  const rim = new THREE.DirectionalLight(0xd8e6ff, 1.5);
  rim.position.set(-5, 2.5, -4.5);

  const fill = new THREE.HemisphereLight(0xffffff, 0xe6e9ef, 0.55);

  group.add(key, rim, fill);
  return group;
}

/**
 * Soft radial "contact shadow" drawn into a canvas texture — a cheap stand-in
 * for ambient occlusion that costs one transparent quad instead of an SSAO pass.
 */
export function createContactShadow({ radius = 3.6, y = -2.35 } = {}) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;

  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.00, 'rgba(24, 30, 42, 0.55)');
  grad.addColorStop(0.35, 'rgba(24, 30, 42, 0.26)');
  grad.addColorStop(0.70, 'rgba(24, 30, 42, 0.06)');
  grad.addColorStop(1.00, 'rgba(24, 30, 42, 0.00)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.renderOrder = -1;
  return mesh;
}
