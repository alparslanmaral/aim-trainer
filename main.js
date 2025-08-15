// Basit 3D FPS "dolaşma" demosu
// WASD hareket, Fare ile bakış, Space zıplama, Shift koşma

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { PointerLockControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/PointerLockControls.js';

let scene, camera, renderer, controls;
let clock = new THREE.Clock();

const eyeHeight = 1.7;        // Kamera yüksekliği (oyuncunun göz yüksekliği)
const playerRadius = 0.4;     // Oyuncu çember yarıçapı (XZ düzleminde)
const gravity = 18;           // Yerçekimi m/s^2
let playerY = 0;              // Oyuncunun ayak yüksekliği (zemin = 0)
let velocityY = 0;            // Dikey hız
let canJump = false;

const move = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
};

const obstacles = [];      // Mesh listesi
const obstacleBoxes = [];  // THREE.Box3 listesi (dünya uzayında sabit)

const infoEl = () => document.getElementById('info');

init();
animate();

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

  // Controls (Pointer Lock) — hedefi renderer.domElement yap
  controls = new PointerLockControls(camera, renderer.domElement);
  scene.add(controls.getObject());
  // Başlangıç konumu (XZ), ayaklar zeminde
  controls.getObject().position.set(0, 0, 10);
  playerY = 0;

  const overlay = document.getElementById('overlay');
  const startButton = document.getElementById('startButton');
  const noteEl = overlay.querySelector('.note');

  // Başlat
  startButton.addEventListener('click', () => {
    // Bazı tarayıcılarda sadece tıklanan elemana yapılan istek kabul edilir;
    // PointerLockControls lock, domElement.requestPointerLock() çağırır.
    controls.lock();
  });

  // Pointer lock olayları
  controls.addEventListener('lock', () => {
    overlay.hidden = true;
    setInfoText(true);
  });
  controls.addEventListener('unlock', () => {
    overlay.hidden = false;
    setInfoText(false);
  });

  // Hata/uyarı geri bildirimi
  document.addEventListener('pointerlockerror', () => {
    if (noteEl) {
      noteEl.textContent = 'Pointer Lock başarısız. Tarayıcı izin vermedi veya desteklemiyor. Masaüstü bir tarayıcıda ve bir yerel sunucuda deneyin.';
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
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x20323f,
    metalness: 0.0,
    roughness: 1.0,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.receiveShadow = true;
  scene.add(floor);

  // Grid helper (zeminde referans çizgiler)
  const grid = new THREE.GridHelper(400, 80, 0x5aa2e8, 0x294c66);
  // Bazı sürümlerde material dizi olabilir; her ikisini de ayarla
  if (Array.isArray(grid.material)) {
    grid.material.forEach((m) => {
      m.opacity = 0.18;
      m.transparent = true;
    });
  } else {
    grid.material.opacity = 0.18;
    grid.material.transparent = true;
  }
  scene.add(grid);

  // Basit dekor: kutular ve kuleler
  createObstacles();

  // Bilgi
  setInfoText(false);

  // Input
  window.addEventListener('resize', onWindowResize);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  // Pencere kaydırmasını engelle (özellikle Space)
  window.addEventListener(
    'keydown',
    (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    },
    { passive: false }
  );
}

function setInfoText(locked = false) {
  const el = infoEl();
  if (!el) return;
  el.innerHTML =
    'WASD: Hareket  |  Fare: Bakış  |  Space: Zıpla  |  Shift: Koş  |  ESC: Çıkış<br/>' +
    (locked ? 'Oyun aktif (Pointer Lock açık).' : 'Başlat’a tıklayın. Bazı tarayıcılarda yerel sunucuda çalıştırın.');
}

function rng(min, max) {
  return Math.random() * (max - min) + min;
}

function createObstacles() {
  // Rastgele “bina” blokları
  for (let i = 0; i < 50; i++) {
    const sx = rng(1.5, 4.5);
    const sy = rng(2.0, 5.0);
    const sz = rng(1.5, 4.5);
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.55 + Math.random() * 0.1, 0.4, 0.5),
      roughness: 0.9,
      metalness: 0.0,
    });
    const box = new THREE.Mesh(geo, mat);

    // Pozisyonu zemine oturt (y merkezde olduğu için yarısı kadar yukarı)
    const x = rng(-160, 160);
    const z = rng(-160, 160);
    box.position.set(x, sy / 2, z);

    // Kameranın başlangıcına çok yakın olanları atla
    if (new THREE.Vector2(x, z).length() < 8) {
      i--;
      continue;
    }

    box.castShadow = false;
    box.receiveShadow = true;
    scene.add(box);
    obstacles.push(box);

    // Dünya uzayında Box3 hesapla ve kaydet (statik olduğu için bir kez yeterli)
    box.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(box);
    obstacleBoxes.push(b);
  }

  // Birkaç farklı renkli anıt/kule
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

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Klavye
function onKeyDown(e) {
  switch (e.code) {
    case 'KeyW':
    case 'ArrowUp':
      move.forward = true;
      break;
    case 'KeyS':
    case 'ArrowDown':
      move.backward = true;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      move.left = true;
      break;
    case 'KeyD':
    case 'ArrowRight':
      move.right = true;
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
      move.sprint = true;
      break;
    case 'Space':
      if (canJump) {
        velocityY = 8.5; // zıplama hızı
        canJump = false;
      }
      break;
  }
}

function onKeyUp(e) {
  switch (e.code) {
    case 'KeyW':
    case 'ArrowUp':
      move.forward = false;
      break;
    case 'KeyS':
    case 'ArrowDown':
      move.backward = false;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      move.left = false;
      break;
    case 'KeyD':
    case 'ArrowRight':
      move.right = false;
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
      move.sprint = false;
      break;
  }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);

  if (controls.isLocked) {
    updatePlayer(delta);
  }

  renderer.render(scene, camera);
}

function updatePlayer(delta) {
  const object = controls.getObject(); // oyuncu kapsülü grubu (kamera bunun içinde)
  const pos = object.position;

  // Hız
  const baseSpeed = 4.5;
  const sprintMult = 1.6;
  const speed = baseSpeed * (move.sprint ? sprintMult : 1.0);

  // Kameranın bakış yönüne göre hareket vektörleri (XZ düzleminde)
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();

  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

  let moveVec = new THREE.Vector3();
  if (move.forward) moveVec.add(forward);
  if (move.backward) moveVec.sub(forward);
  if (move.right) moveVec.add(right);
  if (move.left) moveVec.sub(right);

  if (moveVec.lengthSq() > 0) {
    moveVec.normalize().multiplyScalar(speed * delta);
  }

  // Önce yatay hareket uygula
  pos.x += moveVec.x;
  pos.z += moveVec.z;

  // Yatay çarpışma çözümü (XZ çemberi vs kutular)
  resolveHorizontalCollisions(pos);

  // Yer çekimi ve dikey hareket
  velocityY -= gravity * delta;
  playerY += velocityY * delta;

  // Zemine bas
  if (playerY < 0) {
    playerY = 0;
    velocityY = 0;
    canJump = true;
  }

  // Kameranın ayak yüksekliğine göre Y konumu
  camera.position.y = eyeHeight + playerY;
}

// Oyuncu ile kutular arasında XZ düzleminde çarpışma çözümü
function resolveHorizontalCollisions(pos) {
  // Oyuncunun dikey aralığı (ayak-yükseklik)
  const playerMinY = playerY;
  const playerMaxY = playerY + eyeHeight;

  // Birkaç tekrar ile itişi stabilize et (köşelerde takılmayı azaltır)
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < obstacleBoxes.length; i++) {
      const box = obstacleBoxes[i];

      // Dikey aralık çakışmıyorsa bu kutuyu yatayda önemsemeyelim
      if (playerMaxY < box.min.y || playerMinY > box.max.y) continue;

      // XZ düzleminde AABB'ye en yakın nokta
      const closestX = clamp(pos.x, box.min.x, box.max.x);
      const closestZ = clamp(pos.z, box.min.z, box.max.z);

      let dx = pos.x - closestX;
      let dz = pos.z - closestZ;
      const distSq = dx * dx + dz * dz;
      const r = playerRadius;

      if (distSq < r * r) {
        // Penetrasyon var, dışarı it
        const eps = 1e-8;
        const dist = Math.sqrt(Math.max(distSq, eps));
        let nx, nz;

        if (dist < 1e-5) {
          // Merkez tam köşede/kenarda olabilir: en küçük nüfuza göre eksenel it
          const left = Math.abs(pos.x - box.min.x);
          const right = Math.abs(box.max.x - pos.x);
          const near = Math.abs(pos.z - box.min.z);
          const far = Math.abs(box.max.z - pos.z);
          if (Math.min(left, right) < Math.min(near, far)) {
            nx = left < right ? -1 : 1;
            nz = 0;
          } else {
            nx = 0;
            nz = near < far ? -1 : 1;
          }
        } else {
          nx = dx / dist;
          nz = dz / dist;
        }

        const overlap = r - dist;
        pos.x += nx * overlap;
        pos.z += nz * overlap;
      }
    }
  }
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}