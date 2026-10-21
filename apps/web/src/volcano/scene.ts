import * as THREE from 'three';

// Vesuvius erupting over Pompeii for the winner: the twin-peaked mountain (the cone and the old Monte Somma
// ridge), a Plinian column of ash spreading like an umbrella pine, volcanic lightning, and the won block thrown
// out as glowing stones, one per transaction, sized like the squares of a bitmap, raining down on the city.

const CONE: [number, number][] = [
  [9.5, 0],
  [7.8, 0.7],
  [5.6, 2.4],
  [3.7, 4.6],
  [2.3, 6.2],
  [1.7, 6.8],
  [1.35, 6.7],
  [1.05, 6.2],
];
const CRATER = new THREE.Vector3(0, 6.6, 0);
const STONES = ['#ffb347', '#f7931a', '#ff6b1a', '#ffd166', '#ffe9b0', '#ff8c1a', '#c9962b'];

function coneHeight(r: number): number {
  if (r >= CONE[0][0]) return 0;
  for (let i = 0; i < 5; i++) {
    const [r0, h0] = CONE[i];
    const [r1, h1] = CONE[i + 1];
    if (r <= r0 && r >= r1) return h0 + ((h1 - h0) * (r0 - r)) / (r0 - r1);
  }
  return 6.8;
}

function gradientTexture(stops: [number, string][]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function pompeii(): THREE.Group {
  const city = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: '#d2b98c', roughness: 0.9 });
  const roof = new THREE.MeshStandardMaterial({ color: '#9c3b22', roughness: 0.85 });
  const wall = new THREE.MeshStandardMaterial({ color: '#b98f62', roughness: 0.95 });
  const column = new THREE.CylinderGeometry(0.15, 0.19, 1, 10);

  for (let i = 0; i < 13; i++) {
    const h = i % 5 === 3 ? 1.1 : 2.3;
    const c = new THREE.Mesh(column, stone);
    c.scale.y = h;
    c.position.set(-8.5 + i * 1.3, h / 2, 10.5);
    city.add(c);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.25, 0.5), stone);
  beam.position.set(-5.3, 2.42, 10.5);
  city.add(beam);

  const base = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.7, 3.4), stone);
  base.position.set(-3, 0.35, 14.5);
  city.add(base);
  for (let i = 0; i < 6; i++) {
    for (const z of [12.95, 16.05]) {
      const c = new THREE.Mesh(column, stone);
      c.scale.y = 2.6;
      c.position.set(-5.3 + i * 0.92, 0.7 + 1.3, z);
      city.add(c);
    }
  }
  const architrave = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.4, 3.5), stone);
  architrave.position.set(-3, 3.5, 14.5);
  city.add(architrave);
  const triangle = new THREE.Shape([new THREE.Vector2(-2.8, 0), new THREE.Vector2(2.8, 0), new THREE.Vector2(0, 1)]);
  const pediment = new THREE.Mesh(new THREE.ExtrudeGeometry(triangle, { depth: 3.5, bevelEnabled: false }), roof);
  pediment.position.set(-3, 3.7, 12.75);
  city.add(pediment);

  const houses: [number, number, number, number, number][] = [
    [-14, 17, 2.2, 1.6, 1.8],
    [-11.4, 19.5, 1.8, 1.3, 2.2],
    [-8.6, 18, 2.4, 1.7, 1.8],
    [-6.5, 21.5, 2, 1.2, 1.6],
    [-1, 19.5, 2.6, 1.5, 2],
    [2, 17.5, 1.8, 1.8, 1.6],
    [4.2, 20.5, 2.4, 1.3, 2.2],
    [3.5, 13.5, 2, 1.6, 2],
    [6.5, 15, 1.6, 1.2, 1.6],
    [-12, 13.5, 2, 1.4, 1.8],
    [13.5, 21, 2.2, 1.5, 1.8],
    [0.5, 23, 2.8, 1.4, 1.8],
  ];
  for (const [x, z, w, h, d] of houses) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wall);
    body.position.set(x, h / 2, z);
    const top = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.74, 0.6, 4), roof);
    top.rotation.y = Math.PI / 4;
    top.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
    top.position.set(x, h + 0.3, z);
    city.add(body, top);
  }

  const arena = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.55, 6, 28), wall);
  arena.rotation.x = Math.PI / 2;
  arena.scale.set(1, 0.68, 1);
  arena.position.set(10, 0.45, 17.5);
  const sand = new THREE.Mesh(new THREE.CircleGeometry(1.9, 24), new THREE.MeshStandardMaterial({ color: '#e0b878', roughness: 1 }));
  sand.rotation.x = -Math.PI / 2;
  sand.scale.set(1, 0.68, 1);
  sand.position.set(10, 0.05, 17.5);
  city.add(arena, sand);
  return city;
}

type Stone = { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; s: number; t: number; state: 0 | 1 | 2 };

export function startVolcano(canvas: HTMLCanvasElement, sizes: number[]): () => void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = gradientTexture([
    [0, '#120604'],
    [0.45, '#4a160a'],
    [0.75, '#b8461a'],
    [1, '#e88a3a'],
  ]);
  scene.fog = new THREE.Fog('#4a1c0c', 34, 95);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
  scene.add(new THREE.HemisphereLight('#ffb27a', '#1a0d08', 0.7));
  const dusk = new THREE.DirectionalLight('#ffcf9a', 0.9);
  dusk.position.set(-20, 14, 30);
  scene.add(dusk);
  const glow = new THREE.PointLight('#ff7a1a', 260, 70, 1.3);
  glow.position.copy(CRATER).add(new THREE.Vector3(0, 1.2, 0));
  scene.add(glow);
  const bolt = new THREE.PointLight('#cfe1ff', 0, 60, 1.2);
  scene.add(bolt);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 64), new THREE.MeshStandardMaterial({ color: '#3a2416', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const bay = new THREE.Mesh(new THREE.PlaneGeometry(60, 90), new THREE.MeshStandardMaterial({ color: '#1d3047', roughness: 0.18, metalness: 0.75 }));
  bay.rotation.x = -Math.PI / 2;
  bay.position.set(46, 0.03, 10);
  scene.add(bay);

  const rock = new THREE.MeshStandardMaterial({ color: '#4b3125', roughness: 0.96, flatShading: true });
  const mountain = new THREE.Mesh(new THREE.LatheGeometry(CONE.map(([r, h]) => new THREE.Vector2(r, h)).reverse(), 72), rock);
  scene.add(mountain);
  const somma = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        [4.3, 3.1],
        [4.75, 4.15],
        [5.3, 3.9],
        [6.8, 2.5],
        [9, 0.8],
        [11, 0],
      ].map(([r, h]) => new THREE.Vector2(r, h)),
      48,
      Math.PI * 0.55,
      Math.PI * 0.95,
    ),
    new THREE.MeshStandardMaterial({ color: '#3d3322', roughness: 0.97, flatShading: true, side: THREE.DoubleSide }),
  );
  somma.position.set(-0.6, 0, -0.4);
  scene.add(somma);
  const lava = new THREE.Mesh(new THREE.CircleGeometry(1.05, 32), new THREE.MeshBasicMaterial({ color: '#ff9a2a' }));
  lava.rotation.x = -Math.PI / 2;
  lava.position.set(0, 6.25, 0);
  scene.add(lava);
  const riverMaterial = new THREE.MeshBasicMaterial({ color: '#ff5a0a' });
  for (let k = 0; k < 6; k++) {
    const a = Math.PI * 0.15 + (k / 6) * Math.PI * 1.1 + Math.random() * 0.3;
    const points: THREE.Vector3[] = [];
    for (let r = 1.4; r <= 9.4; r += 0.4) {
      const wobble = Math.sin(r * 1.9 + k) * 0.1;
      points.push(new THREE.Vector3(Math.cos(a + wobble) * r, coneHeight(r) + 0.04, Math.sin(a + wobble) * r));
    }
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 60, 0.09 - k * 0.006, 6), riverMaterial));
  }
  scene.add(pompeii());

  // The ash column: soft puffs rising from the crater, slowing, then spreading out into the umbrella.
  const PUFFS = 700;
  const puffPos = new Float32Array(PUFFS * 3);
  const puffVel = new Float32Array(PUFFS * 3);
  const puffColor = new Float32Array(PUFFS * 3);
  const puffSize = new Float32Array(PUFFS);
  const puffAlpha = new Float32Array(PUFFS);
  const puffAge = new Float32Array(PUFFS);
  const puffLife = new Float32Array(PUFFS);
  const plumeGeometry = new THREE.BufferGeometry();
  plumeGeometry.setAttribute('position', new THREE.BufferAttribute(puffPos, 3));
  plumeGeometry.setAttribute('aColor', new THREE.BufferAttribute(puffColor, 3));
  plumeGeometry.setAttribute('aSize', new THREE.BufferAttribute(puffSize, 1));
  plumeGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(puffAlpha, 1));
  const plumeMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uScale: { value: 600 } },
    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      attribute vec3 aColor;
      uniform float uScale;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uScale / -mv.z;
        vAlpha = aAlpha;
        vColor = aColor;
      }`,
    fragmentShader: `
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(vColor, smoothstep(0.5, 0.08, d) * vAlpha);
        #include <colorspace_fragment>
      }`,
  });
  const plume = new THREE.Points(plumeGeometry, plumeMaterial);
  plume.frustumCulled = false;
  scene.add(plume);
  const lit = new THREE.Color('#d0662a');
  const ash = new THREE.Color('#6e5d52');
  const top = new THREE.Color('#3e3430');
  const tint = new THREE.Color();
  const spawnPuff = (i: number) => {
    puffPos.set([CRATER.x + (Math.random() - 0.5) * 1.2, CRATER.y, CRATER.z + (Math.random() - 0.5) * 1.2], i * 3);
    puffVel.set([(Math.random() - 0.5) * 0.8, 4.5 + Math.random() * 3, (Math.random() - 0.5) * 0.8], i * 3);
    puffAge[i] = 0;
    puffLife[i] = 7 + Math.random() * 5;
  };
  for (let i = 0; i < PUFFS; i++) {
    spawnPuff(i);
    puffAge[i] = -Math.random() * 6;
  }

  // Volcanic lightning in the cloud.
  const boltGeometry = new THREE.BufferGeometry();
  const boltPoints = new Float32Array(10 * 3);
  boltGeometry.setAttribute('position', new THREE.BufferAttribute(boltPoints, 3));
  const boltLine = new THREE.Line(boltGeometry, new THREE.LineBasicMaterial({ color: '#e6f0ff' }));
  boltLine.visible = false;
  boltLine.frustumCulled = false;
  scene.add(boltLine);
  let nextBolt = 2.2;
  let boltOff = 0;

  // The won block, one glowing stone per transaction.
  const sorted = [...sizes].sort((a, b) => a - b);
  const big = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const count = Math.max(400, Math.min(1400, sizes.length || 800));
  const stones = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1, emissive: '#ff5a00', emissiveIntensity: 0.45 }),
    count,
  );
  stones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  stones.frustumCulled = false;
  const color = new THREE.Color();
  const list: Stone[] = [];
  for (let i = 0; i < count; i++) {
    const vsize = sizes.length ? sizes[i % sizes.length] : 150 + Math.random() * 600;
    const s = Math.min(0.75, 0.14 + 0.5 * Math.sqrt(Math.min(vsize, big * 2) / big));
    list.push({
      p: CRATER.clone(),
      v: new THREE.Vector3(),
      r: new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
      w: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8),
      s,
      t: i < count * 0.7 ? Math.random() * 1.6 : 1.6 + Math.random() * 4,
      state: 0,
    });
    stones.setColorAt(i, color.set(STONES[i % STONES.length]));
  }
  scene.add(stones);

  let portrait = false;
  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    portrait = w < h;
    camera.aspect = w / h;
    camera.fov = portrait ? 72 : 52;
    camera.updateProjectionMatrix();
    plumeMaterial.uniforms.uScale.value = (h * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  };
  resize();
  window.addEventListener('resize', resize);

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const hidden = new THREE.Vector3(0, -80, 0);
  let elapsed = 0;
  let last = performance.now();
  let frame = 0;
  let running = true;

  const tick = (now: number) => {
    if (!running) return;
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    elapsed += dt;
    const erupting = elapsed < 16;

    for (let i = 0; i < count; i++) {
      const c = list[i];
      if (c.state === 0 && elapsed >= c.t) {
        const a = Math.random() * Math.PI * 2;
        const out = 1.5 + Math.random() * 5.5;
        c.v.set(Math.cos(a) * out, 10 + Math.random() * 8, Math.sin(a) * out + 2.2);
        c.p.copy(CRATER);
        c.state = 1;
      }
      if (c.state === 1) {
        c.v.y -= 9.8 * dt;
        c.p.addScaledVector(c.v, dt);
        c.r.x += c.w.x * dt;
        c.r.y += c.w.y * dt;
        c.r.z += c.w.z * dt;
        const radius = Math.hypot(c.p.x, c.p.z);
        const floor = coneHeight(radius) + c.s / 2;
        if (c.p.y < floor && c.v.y < 0) {
          c.p.y = floor;
          c.v.y *= -0.3;
          const slope = radius < CONE[0][0] ? 1.4 : 0;
          c.v.x = c.v.x * 0.6 + (c.p.x / (radius || 1)) * slope;
          c.v.z = c.v.z * 0.6 + (c.p.z / (radius || 1)) * slope;
          c.w.multiplyScalar(0.5);
          if (Math.abs(c.v.y) < 0.6 && Math.hypot(c.v.x, c.v.z) < 0.7 && radius > CONE[0][0] - 0.3) c.state = 2;
        }
      }
      if (c.state === 0) matrix.compose(hidden, quaternion.identity(), scale.setScalar(0.001));
      else matrix.compose(c.p, quaternion.setFromEuler(c.r), scale.setScalar(c.s));
      stones.setMatrixAt(i, matrix);
    }
    stones.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < PUFFS; i++) {
      puffAge[i] += dt;
      if (puffAge[i] < 0) {
        puffAlpha[i] = 0;
        continue;
      }
      if (puffAge[i] > puffLife[i]) {
        if (erupting) spawnPuff(i);
        else {
          puffAlpha[i] = 0;
          continue;
        }
      }
      const k = i * 3;
      const y = puffPos[k + 1];
      if (y > 15) {
        const dx = puffPos[k] - CRATER.x;
        const dz = puffPos[k + 2] - CRATER.z;
        const d = Math.hypot(dx, dz) || 1;
        puffVel[k] += (dx / d) * 1.6 * dt;
        puffVel[k + 2] += (dz / d) * 1.6 * dt;
        puffVel[k + 1] *= 1 - 1.4 * dt;
      } else {
        puffVel[k + 1] *= 1 - 0.08 * dt;
      }
      puffPos[k] += puffVel[k] * dt + 0.25 * dt;
      puffPos[k + 1] += puffVel[k + 1] * dt;
      puffPos[k + 2] += puffVel[k + 2] * dt;
      const life = puffAge[i] / puffLife[i];
      const h = Math.min(1, Math.max(0, (puffPos[k + 1] - CRATER.y) / 12));
      tint.copy(lit).lerp(ash, Math.min(1, h * 1.6)).lerp(top, Math.max(0, h - 0.6));
      puffColor.set([tint.r, tint.g, tint.b], k);
      puffSize[i] = 1.6 + life * 6 + h * 3;
      puffAlpha[i] = Math.min(1, puffAge[i] * 2) * (1 - life) * 0.85;
    }
    plumeGeometry.attributes.position.needsUpdate = true;
    plumeGeometry.attributes.aColor.needsUpdate = true;
    plumeGeometry.attributes.aSize.needsUpdate = true;
    plumeGeometry.attributes.aAlpha.needsUpdate = true;

    if (elapsed > nextBolt && elapsed < 22) {
      let x = (Math.random() - 0.5) * 8;
      let y = 15 + Math.random() * 4;
      let z = (Math.random() - 0.5) * 6;
      for (let j = 0; j < 10; j++) {
        boltPoints.set([x, y, z], j * 3);
        x += (Math.random() - 0.5) * 1.4;
        y -= 0.5 + Math.random() * 0.6;
        z += (Math.random() - 0.5) * 1.4;
      }
      boltGeometry.attributes.position.needsUpdate = true;
      boltLine.visible = true;
      bolt.position.set(boltPoints[0], boltPoints[1], boltPoints[2]);
      bolt.intensity = 900;
      boltOff = elapsed + 0.12;
      nextBolt = elapsed + 1.2 + Math.random() * 2.8;
    }
    if (elapsed > boltOff) {
      boltLine.visible = false;
      bolt.intensity = 0;
    }

    glow.intensity = 200 + Math.sin(elapsed * 7) * 40 + (elapsed < 1.6 ? (1.6 - elapsed) * 900 : 0);
    const sway = Math.sin(elapsed * 0.16) * 0.32;
    const distance = (portrait ? 40 : 32) - Math.min(5, elapsed * 0.35);
    const shake = elapsed < 2 ? (2 - elapsed) * 0.25 : 0;
    camera.position.set(
      Math.sin(sway) * distance + (Math.random() - 0.5) * shake,
      (portrait ? 4.5 : 5.5) + (Math.random() - 0.5) * shake,
      Math.cos(sway) * distance + (Math.random() - 0.5) * shake,
    );
    camera.lookAt(0, portrait ? 1.5 : 3.5, 0);
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    running = false;
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', resize);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    (scene.background as THREE.Texture | null)?.dispose();
    renderer.dispose();
  };
}
