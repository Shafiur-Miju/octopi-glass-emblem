import * as THREE from 'three';

import {
  CAMERA, LOOP, particleCount, prefersReducedMotion, isCoarsePointer,
} from './config.js';
import { Emblem } from './emblem.js';
import { ParticleField } from './particles.js';
import { createStudioEnvironment, createLights, createContactShadow } from './environment.js';
import { evaluate, progressOf } from './timeline.js';
import { damp, clamp } from './utils.js';

class Experience {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.reduced = prefersReducedMotion();

    // Dev handles: ?t=9 jumps into the cycle, ?still=1 freezes it there.
    const params = new URLSearchParams(location.search);
    this.elapsed = Number.parseFloat(params.get('t')) || 0;
    this.paused = params.get('still') === '1';

    this.pointer = new THREE.Vector2();
    this.pointerTarget = new THREE.Vector2();

    this.fps = { frames: 0, acc: 0, value: 60 };
    this.quality = { ratio: Math.min(window.devicePixelRatio || 1, 2), samples: [] };

    this.#initRenderer();
    this.#initScene();
  }

  /** Second half of construction — async because the artwork is fetched. */
  async start() {
    await this.#initContent();
    this.#initUI();
    this.#bindEvents();

    this.resize();
    this.renderer.setAnimationLoop(this.#tick);
    return this;
  }

  /* ------------------------------------------------------------ renderer */

  #initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(this.quality.ratio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping ?? THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;
  }

  #initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xffffff);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fov, window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far
    );
    this.camera.position.set(...CAMERA.position);
    this.cameraHome = this.camera.position.clone();
    this.target = new THREE.Vector3(...CAMERA.target);
    this.camera.lookAt(this.target);

    this.scene.add(createLights());
  }

  async #initContent() {
    this.envMap = createStudioEnvironment(this.renderer);
    this.scene.environment = this.envMap;

    this.emblem = await Emblem.load(this.envMap);
    this.scene.add(this.emblem.group);

    this.shadow = createContactShadow();
    this.scene.add(this.shadow);

    this.particles = new ParticleField(this.emblem, particleCount());
    this.scene.add(this.particles.points);
  }

  /* ------------------------------------------------------------------ UI */

  #initUI() {
    this.ui = {
      loader: document.getElementById('loader'),
      fps: document.getElementById('fps'),
    };

    const panel = document.createElement('div');
    panel.className = 'debug';
    panel.innerHTML = `
      <div class="debug__row"><span>particles</span><b>${this.particles.count.toLocaleString()}</b></div>
      <div class="debug__row"><span>loop</span><b>${LOOP}s</b></div>
      <div class="debug__row"><span>emblem</span><b>${this.emblem.source}</b></div>
      <div class="debug__row"><span>emblem tris</span><b>${(
        this.emblem.mesh.geometry.index
          ? this.emblem.mesh.geometry.index.count / 3
          : this.emblem.mesh.geometry.attributes.position.count / 3
      ).toLocaleString()}</b></div>
      <div class="debug__row"><span>phase</span><b data-phase>wave</b></div>
      <div class="debug__row"><span>dpr</span><b data-dpr></b></div>
      <div class="debug__bar"><i data-progress></i></div>
    `;
    document.getElementById('stage').appendChild(panel);

    this.ui.panel = panel;
    this.ui.phase = panel.querySelector('[data-phase]');
    this.ui.progress = panel.querySelector('[data-progress]');
    this.ui.dpr = panel.querySelector('[data-dpr]');

    if (new URLSearchParams(location.search).get('debug') === '1') panel.classList.add('is-open');
  }

  #bindEvents() {
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize, { passive: true });

    if (!isCoarsePointer()) {
      window.addEventListener('pointermove', (e) => {
        this.pointerTarget.set(
          (e.clientX / window.innerWidth) * 2 - 1,
          (e.clientY / window.innerHeight) * 2 - 1
        );
      }, { passive: true });
    }

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); this.paused = !this.paused; }
      if (e.key.toLowerCase() === 'd') this.ui.panel.classList.toggle('is-open');
      if (e.key.toLowerCase() === 'r') this.elapsed = 0;
    });

    document.addEventListener('visibilitychange', () => {
      // Swallow the gap so a backgrounded tab does not jump the timeline.
      if (!document.hidden) this.clock.getDelta();
    });
  }

  /* -------------------------------------------------------------- layout */

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(this.quality.ratio);

    // Portrait screens: pull back a little so the emblem never crops.
    const fit = clamp(1.35 / Math.max(0.62, this.camera.aspect), 1, 1.5);
    this.camera.position.z = this.cameraHome.z * fit;

    // Visible extent at the emblem plane, so the dot field always bleeds off-screen.
    const dist = this.camera.position.distanceTo(this.target);
    const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(CAMERA.fov) / 2) * dist;

    this.particles.resize(visibleHeight * this.camera.aspect, this.quality.ratio);

    if (this.ui?.dpr) this.ui.dpr.textContent = this.quality.ratio.toFixed(2);
  }

  /** Drop resolution (never below 1×) if we cannot hold ~55fps. */
  #autoQuality(dt) {
    const q = this.quality;
    q.samples.push(dt);
    if (q.samples.length < 90) return;

    const avg = q.samples.reduce((a, b) => a + b, 0) / q.samples.length;
    q.samples.length = 0;

    if (avg > 1 / 48 && q.ratio > 1) {
      q.ratio = Math.max(1, q.ratio - 0.25);
      this.resize();
    }
  }

  /* ---------------------------------------------------------------- loop */

  #tick = () => {
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    if (!this.paused) this.elapsed += dt * (this.reduced ? 0.55 : 1);

    const p = progressOf(this.elapsed, LOOP);
    const state = evaluate(p);

    this.emblem.update(state);
    // Feed the shader wrapped time: every wave term is periodic over LOOP, so
    // this is identical output while keeping float precision high for hours.
    this.particles.update(p * LOOP, state, this.emblem.mesh.matrixWorld);
    this.shadow.material.opacity = state.shadow * 0.17;

    // Pointer parallax, critically damped.
    if (!this.reduced) {
      this.pointer.x = damp(this.pointer.x, this.pointerTarget.x, 4.5, dt);
      this.pointer.y = damp(this.pointer.y, this.pointerTarget.y, 4.5, dt);
    }
    this.camera.position.x = this.cameraHome.x + this.pointer.x * CAMERA.parallax;
    this.camera.position.y = this.cameraHome.y - this.pointer.y * CAMERA.parallax * 0.6;
    this.camera.lookAt(this.target);

    this.renderer.render(this.scene, this.camera);

    // Reveal only once there is something on the canvas — hiding the loader on
    // the first rAF instead shows a blank frame while the scene compiles.
    if (!this.revealed) {
      this.revealed = true;
      this.ui.loader.classList.add('is-hidden');
    }

    this.#autoQuality(dt);
    this.#meter(dt, p, state);
  };

  #meter(dt, p, state) {
    const f = this.fps;
    f.frames++; f.acc += dt;
    if (f.acc >= 0.5) {
      f.value = Math.round(f.frames / f.acc);
      f.frames = 0; f.acc = 0;
      if (this.ui.fps) this.ui.fps.textContent = `${f.value} fps`;
    }
    if (this.ui.panel.classList.contains('is-open')) {
      this.ui.progress.style.width = `${(p * 100).toFixed(1)}%`;
      this.ui.phase.textContent =
        state.reveal > 0.5 ? 'emblem'
        : state.morph > 0.985 ? 'shell'
        : state.morph > 0.02 ? (p < 0.55 ? 'vortex ▸ in' : 'vortex ▸ out')
        : 'wave';
    }
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.onResize);
    this.particles.dispose();
    this.emblem.dispose();
    this.envMap.dispose();
    this.renderer.dispose();
  }
}

/* -------------------------------------------------------------- bootstrap */

const canvas = document.getElementById('scene');

try {
  window.experience = await new Experience(canvas).start();
  window.__octopiStarted = true; // tells the boot watchdog in index.html to stand down
} catch (error) {
  console.error(error);
  window.__octopiStarted = true;
  const loader = document.getElementById('loader');
  loader.classList.remove('is-hidden');
  loader.innerHTML =
    '<div class="boot-error"><h1>WebGL could not start</h1>' +
    `<p>${error.message}</p></div>`;
}
