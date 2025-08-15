// Basit 3D FPS "dolaşma" demosu (Multiplayer)
// WASD hareket, Fare: bakış, Space: zıpla, Shift: koş
// Multiplayer: Socket.IO ile konum/yön yayını ve diğer oyuncuları gösterme

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ----- Ayarlar -----
const eyeHeight = 1.7;        // Kamera (oyuncu göz) yüksekliği
const playerRadius = 0.4;     // Oyuncu çember yarıçapı (XZ çarpışma)
const gravity = 18;           // Yerçekimi m/s^2
const NET_HZ = 15;            // Ağ gönderim frekansı (Hz)
const WORLD_SEED = 20250815;  // Harita deterministik RNG tohumu (tüm istemciler aynı dünya)

// ----- Durum -----
let scene, camera, renderer, controls;
let clock = new THREE.Clock();

let playerY = 0;              // Ayak yüksekliği (zemin = 0)
let velocityY = 0;            // Dikey hız
let canJump = false;

const move = { forward: false, backward: false, left: false, right: false, sprint: false };

const obstacles = [];      // Mesh listesi
const obstacleBoxes = [];  // THREE.Box3 listesi (statik)
const otherPlayers = new Map(); // id -> { group, target:{x,y,z,yaw}, lastUpdate }

// Ağ
let socket = null;
let netAccum = 0;

// UI
const infoEl = () => document.getElementById('info');

// RNG (deterministik)
function makeRNG(seed) {
  let s = seed >>> 0;
  return (min, max) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    const t = s / 4294967296;
    return min + t * (max - min);
  };
}
const rng = makeRNG(WORLD_SEED);

// ----- Başlat -----
init();
animate();

// ----- Kurulum -----
function init() {
  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1220);
  scene.fog = new THREE.Fog(0x0e1220, 60, 180);

  // Camera
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, eyeHeight, 0);

  // Controls (Pointer Lock)
  controls = new PointerLockControls(camera, renderer.domElement);
  scene.add(controls.getObject());
  controls.getObject().position.set(0, 0, 10);
  playerY = 0;

  const overlay = document.getElementById('overlay');
  const startButton = document.getElementById('startButton');
  const noteEl = overlay.querySelector('.note');

  // Başlat
  startButton.addEventListener('click', () => controls.lock());

  controls.addEventListener('lock', () => {
    overlay.hidden = true;
    setInfoText(true);
  });
  controls.addEventListener('unlock', () => {
    overlay.hidden = false;
    setInfoText(false);
  });

  document.addEventListener('pointerlockerror', () => {
    if (noteEl) {
      noteEl.textContent = 'Pointer Lock başarısız. Masaüstü tarayıcı ve sunucu üzerinden deneyin.';
    }
  });

  // Lights
  const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x334155, 0.8);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(20, 25, 10);
  scene.add(dir);

  // Ground
  const floorGeo = new THREE.PlaneGeometry(400, 400, 1, 1);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x20323f, metalness: 0.0, roughness: 1.0 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.receiveShadow = true;
  scene.add(floor);

  // Grid helper
  const grid = new THREE.GridHelper(400, 80, 0x5aa2e8, 0x294c66);
  if (Array.isArray(grid.material)) {
    grid.material.forEach((m) => { m.opacity = 0.18; m.transparent = true; });
  } else {
    grid.material.opacity = 0.18;
    grid.material.transparent = true;
  }
  scene.add(grid);

  // Dekor ve engeller
  createObstacles();

  // Bilgi
  setInfoText(false);

  // Input ve resize
  window.addEventListener('resize', onWindowResize);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  }, { passive: false });

  // Ağa bağlan
  connectNetworking();
}

function setInfoText(locked = false) {
  const el = infoEl();
  if (!el) return;
  el.innerHTML =
    'WASD: Hareket  |  Fare: Bakış  |  Space: Zıpla  |  Shift: Koş  |  ESC: Çıkış<br/>' +
    (locked ? 'Oyun aktif (Pointer Lock açık).' : 'Başlat’a tıklayın. Multiplayer etkin.');
}

// ----- Dünya / Engeller -----
function createObstacles() {
  // Rastgele “bina” blokları (deterministik RNG ile)
  for (let i = 0; i < 50; i++) {
    const sx = rng(1.5, 4.5);
    const sy = rng(2.0, 5.0);
    const sz = rng(1.5, 4.5);
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.55 + (rng(0, 1) * 0.1), 0.4, 0.5),
      roughness: 0.9, metalness: 0.0
    });
    const box = new THREE.Mesh(geo, mat);

    const x = rng(-160, 160);
    const z = rng(-160, 160);
    box.position.set(x, sy / 2, z);

    if (new THREE.Vector2(x, z).length() < 8) { // başlangıca çok yakınsa yeniden dene
      i--;
      continue;
    }

    box.receiveShadow = true;
    scene.add(box);
    obstacles.push(box);

    box.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(box);
    obstacleBoxes.push(b);
  }

  // Anıt/kule
  for (let i = 0; i < 6; i++) {
    const h = 12 + i * 6;
    const geo = new THREE.BoxGeometry(3, h, 3);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4cc9f0, roughness: 0.8, metalness: 0 });
    const tower = new THREE.Mesh(geo, mat);
    const angle = (i / 6) * Math.PI * 2;
    const R = 60;
    tower.position.set(Math.cos(angle) * R, h / 2, Math.sin(angle) * R);
    scene.add(tower);
    obstacles.push(tower);

    tower.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(tower);
    obstacleBoxes.push(b);
  }
}

// ----- Resize -----
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ----- Klavye -----
function onKeyDown(e) {
  switch (e.code) {
    case 'KeyW':
    case 'ArrowUp': move.forward = true; break;
    case 'KeyS':
    case 'ArrowDown': move.backward = true; break;
    case 'KeyA':
    case 'ArrowLeft': move.left = true; break;
    case 'KeyD':
    case 'ArrowRight': move.right = true; break;
    case 'ShiftLeft':
    case 'ShiftRight': move.sprint = true; break;
    case 'Space':
      if (canJump) {
        velocityY = 8.5;
        canJump = false;
      }
      break;
  }
}
function onKeyUp(e) {
  switch (e.code) {
    case 'KeyW':
    case 'ArrowUp': move.forward = false; break;
    case 'KeyS':
    case 'ArrowDown': move.backward = false; break;
    case 'KeyA':
    case 'ArrowLeft': move.left = false; break;
    case 'KeyD':
    case 'ArrowRight': move.right = false; break;
    case 'ShiftLeft':
    case 'ShiftRight': move.sprint = false; break;
  }
}

// ----- Ana döngü -----
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);

  if (controls.isLocked) {
    updatePlayer(delta);
  }

  // Multiplayer: uzaktaki oyuncuları yumuşakça hedeflerine doğru ilerlet
  updateRemotePlayers(delta);

  // Multiplayer: belirli aralıklarla kendi durumunu gönder
  updateNetworking(delta);

  renderer.render(scene, camera);
}

// ----- Oyuncu fizik/hareket -----
function updatePlayer(delta) {
  const object = controls.getObject();
  const pos = object.position;

  const baseSpeed = 4.5;
  const sprintMult = 1.6;
  const speed = baseSpeed * (move.sprint ? sprintMult : 1.0);

  // Bakış yönüne göre XZ vektörleri
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0; forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

  let moveVec = new THREE.Vector3();
  if (move.forward) moveVec.add(forward);
  if (move.backward) moveVec.sub(forward);
  if (move.right) moveVec.add(right);
  if (move.left) moveVec.sub(right);
  if (moveVec.lengthSq() > 0) moveVec.normalize().multiplyScalar(speed * delta);

  // Yatay hareket uygula
  pos.x += moveVec.x;
  pos.z += moveVec.z;

  // Çarpışma çözümü (XZ)
  resolveHorizontalCollisions(pos);

  // Yer çekimi ve dikey hareket
  velocityY -= gravity * delta;
  playerY += velocityY * delta;

  // Zemin
  if (playerY < 0) {
    playerY = 0;
    velocityY = 0;
    canJump = true;
  }

  // Kamera Y (göz yüksekliği + ayak yüksekliği)
  camera.position.y = eyeHeight + playerY;
}

// XZ çarpışma (oyuncu çember vs kutular)
function resolveHorizontalCollisions(pos) {
  const playerMinY = playerY;
  const playerMaxY = playerY + eyeHeight;

  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < obstacleBoxes.length; i++) {
      const box = obstacleBoxes[i];
      if (playerMaxY < box.min.y || playerMinY > box.max.y) continue;

      const closestX = clamp(pos.x, box.min.x, box.max.x);
      const closestZ = clamp(pos.z, box.min.z, box.max.z);
      let dx = pos.x - closestX;
      let dz = pos.z - closestZ;
      const distSq = dx * dx + dz * dz;
      const r = playerRadius;

      if (distSq < r * r) {
        const eps = 1e-8;
        const dist = Math.sqrt(Math.max(distSq, eps));
        let nx, nz;

        if (dist < 1e-5) {
          const left = Math.abs(pos.x - box.min.x);
          const right = Math.abs(box.max.x - pos.x);
          const near = Math.abs(pos.z - box.min.z);
          const far = Math.abs(box.max.z - pos.z);
          if (Math.min(left, right) < Math.min(near, far)) {
            nx = left < right ? -1 : 1; nz = 0;
          } else {
            nx = 0; nz = near < far ? -1 : 1;
          }
        } else {
          nx = dx / dist; nz = dz / dist;
        }

        const overlap = r - dist;
        pos.x += nx * overlap;
        pos.z += nz * overlap;
      }
    }
  }
}

function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

// ----- Multiplayer: Ağ -----
function connectNetworking() {
  if (!window.io) {
    console.error('Socket.IO client bulunamadı. index.html içinde /socket.io/socket.io.js dahil mi?');
    return;
  }
  socket = window.io(); // aynı origin
  const myName = `P-${Math.random().toString(36).slice(2, 6)}`;

  socket.on('connect', () => {
    socket.emit('join', { name: myName });
  });

  socket.on('players:init', (list) => {
    list.forEach(({ id, name, state }) => {
      if (id === socket.id) return;
      addRemotePlayer(id, name, state);
    });
  });

  socket.on('player:joined', ({ id, name }) => {
    if (id === socket.id) return;
    addRemotePlayer(id, name, null);
  });

  socket.on('player:state', ({ id, state }) => {
    updateRemotePlayer(id, state);
  });

  socket.on('player:left', ({ id }) => {
    removeRemotePlayer(id);
  });
}

function updateNetworking(delta) {
  if (!socket || socket.disconnected) return;
  netAccum += delta;
  if (netAccum >= 1 / NET_HZ) {
    netAccum = 0;

    // Konum ve yön (yaw/pitch)
    const pos = controls.getObject().position;
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    const payload = {
      x: pos.x,
      y: playerY, // ayak yüksekliği
      z: pos.z,
      yaw: euler.y,
      pitch: euler.x,
      ts: Date.now()
    };
    socket.emit('state', payload);
  }
}

// ----- Multiplayer: Uzak oyuncular -----
function addRemotePlayer(id, name, state) {
  if (otherPlayers.has(id)) return;

  const color = colorFromId(id);
  const group = createAvatar(color, name || `P-${id.slice(0, 4)}`);

  // İlk durum
  let target = { x: 0, y: 0, z: 0, yaw: 0 };
  if (state) {
    target = { x: state.x, y: state.y || 0, z: state.z, yaw: state.yaw || 0 };
    group.position.set(target.x, target.y, target.z);
    group.rotation.y = target.yaw;
  }

  scene.add(group);
  otherPlayers.set(id, { group, target, lastUpdate: performance.now(), name });
}

function updateRemotePlayer(id, state) {
  const entry = otherPlayers.get(id);
  if (!entry) return;
  entry.target.x = state.x;
  entry.target.y = state.y || 0;
  entry.target.z = state.z;
  entry.target.yaw = state.yaw || 0;
  entry.lastUpdate = performance.now();
}

function removeRemotePlayer(id) {
  const entry = otherPlayers.get(id);
  if (!entry) return;
  scene.remove(entry.group);
  entry.group.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    }
  });
  otherPlayers.delete(id);
}

function updateRemotePlayers(delta) {
  const posLerp = Math.min(1, delta * 10); // daha küçük -> daha yumuşak
  const yawLerp = Math.min(1, delta * 10);

  for (const { group, target } of otherPlayers.values()) {
    // Pozisyonu yumuşat
    group.position.x = THREE.MathUtils.lerp(group.position.x, target.x, posLerp);
    group.position.y = THREE.MathUtils.lerp(group.position.y, target.y, posLerp);
    group.position.z = THREE.MathUtils.lerp(group.position.z, target.z, posLerp);

    // Yaw'ı açı-lerp ile yumuşat
    group.rotation.y = lerpAngle(group.rotation.y, target.yaw, yawLerp);
  }
}

function lerpAngle(a, b, t) {
  let diff = (b - a + Math.PI) % (Math.PI * 2);
  if (diff < 0) diff += Math.PI * 2;
  diff -= Math.PI;
  return a + diff * t;
}

// Basit avatar (silindir + kafa küresi + isim etiketi için küçük bir halka)
function createAvatar(color, name = '') {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.0 });
  const headMat = bodyMat.clone();
  headMat.color = new THREE.Color().copy(new THREE.Color(color)).offsetHSL(0, 0, 0.15);

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.4, 16), bodyMat);
  body.position.y = 0.7;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), headMat);
  head.position.y = 1.6;

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.04, 8, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.05;

  group.add(body, head, ring);

  // Basit isim etiketi (Sprite ile)
  if (name) {
    const label = makeTextSprite(name);
    label.position.set(0, 2.1, 0);
    group.add(label);
  }

  return group;
}

// Sprite tabanlı basit metin etiketi
function makeTextSprite(text) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const pad = 6;
  ctx.font = '500 22px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell';
  const metrics = ctx.measureText(text);
  const w = Math.ceil(metrics.width) + pad * 2;
  const h = 28 + pad * 2;
  canvas.width = w * 2;
  canvas.height = h * 2;
  ctx.scale(2, 2);

  // Arkaplan
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  roundRect(ctx, 0, 0, w, h, 8);
  ctx.fill();
  ctx.stroke();

  // Metin
  ctx.fillStyle = '#e8eef5';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '500 22px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell';
  ctx.fillText(text, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  // Boyutlandır
  const scale = 0.0075; // piksel->dünya
  sprite.scale.set(w * scale, h * scale, 1);
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function colorFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const hue = ((h >>> 0) % 360) / 360;
  const col = new THREE.Color();
  col.setHSL(hue, 0.65, 0.55);
  return col;
}