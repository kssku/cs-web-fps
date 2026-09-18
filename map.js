import * as THREE from 'three';

/* =========================================================================
   CS WEB FPS — 类 Counter-Strike 网页射击游戏
   零构建依赖：Three.js 通过 importmap 从 CDN 加载
   ========================================================================= */

// ------------------------------------------------------------------ 常量
const PLAYER_EYE = 1.65;
const PLAYER_CROUCH_EYE = 1.05;
const PLAYER_RADIUS = 0.42;
const GRAVITY = 22;
const JUMP_SPEED = 7.2;
const WALK_SPEED = 3.1;
const RUN_SPEED = 5.6;
const CROUCH_SPEED = 1.7;
const AIR_ACCEL = 2.2;
const GROUND_ACCEL = 14;
const GROUND_FRICTION = 11;
const MOUSE_SENS = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.03;

const TEAM_CT = 'CT';
const TEAM_T = 'T';

// ------------------------------------------------------------------ 全局状态
const state = {
  running: false,
  paused: false,
  dead: false,
  scoreCT: 0,
  scoreT: 0,
  playerKills: 0,
  playerDeaths: 0,
  enemiesAlive: 0,
  round: 1,
};

// ------------------------------------------------------------------ Three 基础
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app').prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc4e8);
scene.fog = new THREE.Fog(0xc8d8e8, 40, 130);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.05, 500);
camera.rotation.order = 'YXZ';

// ------------------------------------------------------------------ 灯光
const hemi = new THREE.HemisphereLight(0xbfd8f0, 0x6b6550, 1.15);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2dc, 2.0);
sun.position.set(45, 70, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 200;
const S = 65;
sun.shadow.camera.left = -S;
sun.shadow.camera.right = S;
sun.shadow.camera.top = S;
sun.shadow.camera.bottom = -S;
sun.shadow.bias = -0.0008;
scene.add(sun);
scene.add(sun.target);

// ------------------------------------------------------------------ 材质库
const MAT = {
  sand: new THREE.MeshStandardMaterial({ color: 0xd8c49a, roughness: 0.95 }),
  sandDark: new THREE.MeshStandardMaterial({ color: 0xbda87e, roughness: 0.95 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xc9b48c, roughness: 0.9 }),
  wallTall: new THREE.MeshStandardMaterial({ color: 0xb9a276, roughness: 0.92 }),
  crate: new THREE.MeshStandardMaterial({ color: 0xa8794a, roughness: 0.85 }),
  crateDark: new THREE.MeshStandardMaterial({ color: 0x8a5f36, roughness: 0.88 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.45, metalness: 0.7 }),
  door: new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.8 }),
  barrel: new THREE.MeshStandardMaterial({ color: 0x4a7a4a, roughness: 0.6, metalness: 0.35 }),
  barrelRed: new THREE.MeshStandardMaterial({ color: 0x9a3a3a, roughness: 0.6, metalness: 0.35 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0xa8a8a0, roughness: 0.96 }),
};

// ------------------------------------------------------------------ 碰撞体集合
/** @type {{min:THREE.Vector3, max:THREE.Vector3}[]} */
const colliders = [];
const mapGroup = new THREE.Group();
scene.add(mapGroup);

/**
 * 添加一个盒体到场景，并注册为碰撞体
 * @param {number} w 宽(X)  @param {number} h 高(Y)  @param {number} d 深(Z)
 * @param {number} x 中心X  @param {number} y 中心Y  @param {number} z 中心Z
 * @param {THREE.Material} mat 材质
 * @param {boolean} solid 是否参与碰撞
 * @param {boolean} shadow 是否投影
 */
function addBox(w, h, d, x, y, z, mat, solid = true, shadow = true) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  mapGroup.add(mesh);
  if (solid) {
    colliders.push({
      min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
    });
  }
  return mesh;
}

// ============================================================== 地图构建
// 布局参考 de_dust2 简化版：中路 + 长道 + A点 + B点 + 双方出生点
const MAP_SIZE = 76;   // 地图边长
const WALL_H = 6;      // 外墙高

/** 出生点 */
const SPAWN_CT = new THREE.Vector3(-30, 0, 30);
const SPAWN_T = new THREE.Vector3(30, 0, -30);
const ENEMY_SPAWNS = [
  new THREE.Vector3(30, 0, -30),
  new THREE.Vector3(26, 0, -24),
  new THREE.Vector3(33, 0, -22),
  new THREE.Vector3(22, 0, -32),
  new THREE.Vector3(28, 0, -34),
  new THREE.Vector3(35, 0, -27),
];

function buildMap() {
  const half = MAP_SIZE / 2;

  // ---- 地面
  const groundGeo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE);
  const ground = new THREE.Mesh(groundGeo, MAT.sand);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  mapGroup.add(ground);

  // 地面碰撞体：贴地放一块与地图等大的薄板（顶面在 y=0）。
  // 没有它玩家会无限下坠——物理只遍历 colliders，而地面此前仅存在于场景里。
  colliders.push({
    min: new THREE.Vector3(-half, -1, -half),
    max: new THREE.Vector3(half, 0, half),
  });

  // 地面网格纹理感（用细线辅助空间感）
  const grid = new THREE.GridHelper(MAP_SIZE, 38, 0x8a7a5a, 0x8a7a5a);
  grid.material.opacity = 0.16;
  grid.material.transparent = true;
  grid.position.y = 0.01;
  mapGroup.add(grid);

  // ---- 四面外墙
  const t = 1.2; // 墙厚
  addBox(MAP_SIZE, WALL_H, t, 0, WALL_H / 2, -half, MAT.wallTall);
  addBox(MAP_SIZE, WALL_H, t, 0, WALL_H / 2, half, MAT.wallTall);
  addBox(t, WALL_H, MAP_SIZE, -half, WALL_H / 2, 0, MAT.wallTall);
  addBox(t, WALL_H, MAP_SIZE, half, WALL_H / 2, 0, MAT.wallTall);

  // ---- 中央大通道（简化中路）
  // 中路两侧的墙，形成 funnel
  addBox(2, 5, 26, -6, 2.5, 6, MAT.wall);
  addBox(2, 5, 26, 6, 2.5, 6, MAT.wall);

  // 中门（CT 侧）
  addBox(1.2, 5, 10, -6, 2.5, 20, MAT.wall);
  addBox(1.2, 5, 10, 6, 2.5, 20, MAT.wall);

  // ---- 中路转角的箱子堆
  addBox(2, 2, 2, -3.5, 1, -4, MAT.crate);
  addBox(2, 2, 2, 3.5, 1, -4, MAT.crate);
  addBox(2, 1, 2, -3.5, 2.5, -4, MAT.crateDark);

  // ---- A 点区域（右前方 / +X, +Z）
  // A 点平台
  addBox(14, 1.6, 12, 24, 0.8, 20, MAT.concrete);
  // A 点掩体
  addBox(2.4, 2.4, 2.4, 19, 1.2, 24, MAT.crate);
  addBox(2.4, 2.4, 2.4, 29, 1.2, 24, MAT.crate);
  addBox(3, 1.2, 3, 24, 0.6, 27, MAT.crateDark);
  addBox(1.6, 3, 1.6, 24, 1.5, 14, MAT.barrel);
  addBox(1.6, 3, 1.6, 21, 1.5, 17, MAT.barrelRed);
  // A 点矮墙
  addBox(10, 1.1, 0.8, 24, 0.55, 12, MAT.wall);

  // ---- B 点区域（左前方 / -X, -Z）
  // B 点上方的箱体阵地
  addBox(12, 1.4, 10, -24, 0.7, -20, MAT.concrete);
  addBox(2.6, 2.6, 2.6, -28, 1.3, -24, MAT.crate);
  addBox(2.6, 2.6, 2.6, -20, 1.3, -24, MAT.crate);
  addBox(2.6, 2.6, 2.6, -24, 1.3, -16, MAT.crateDark);
  addBox(8, 1.1, 0.8, -24, 0.55, -15.2, MAT.wall);
  addBox(1.6, 3, 1.6, -17, 1.5, -21, MAT.barrel);

  // ---- 侧翼通道（连接中路与 A/B）
  // A 侧通道墙
  addBox(1.2, 5, 18, 14, 2.5, 22, MAT.wall);
  addBox(1.2, 5, 14, 20, 2.5, 6, MAT.wall);
  // B 侧通道墙
  addBox(1.2, 5, 18, -14, 2.5, -22, MAT.wall);
  addBox(1.2, 5, 14, -20, 2.5, -6, MAT.wall);

  // ---- 出生点附近的掩体
  // CT 侧
  addBox(3, 1.5, 1, -26, 0.75, 24, MAT.crateDark);
  addBox(1, 1.5, 3, -22, 0.75, 28, MAT.crateDark);
  addBox(1.6, 3, 1.6, -33, 1.5, 26, MAT.barrel);
  // T 侧
  // 原坐标 (26, -24) 正好压住 ENEMY_SPAWNS[1]，敌人生成即卡在碰撞体内。
  // 沿 -z 内移到 -28，仍作为 T 出生点前的掩体。
  addBox(3, 1.5, 1, 26, 0.75, -28, MAT.crateDark);
  addBox(1, 1.5, 3, 22, 0.75, -28, MAT.crateDark);
  addBox(1.6, 3, 1.6, 33, 1.5, -26, MAT.barrelRed);

  // ---- 散落箱体，增加掩体密度
  const scatter = [
    [-10, 12], [10, -12], [-12, -6], [12, 6],
    [-2, 14], [2, -14], [-16, 2], [16, -2],
    [-8, -14], [8, 14], [0, 24], [0, -24],
  ];
  for (const [sx, sz] of scatter) {
    const s = 1.6 + Math.random() * 0.8;
    addBox(s, s, s, sx, s / 2, sz, Math.random() > 0.5 ? MAT.crate : MAT.crateDark);
  }
}

buildMap();

// ------------------------------------------------------------------ 导出共享引用
export { THREE, scene, camera, renderer, colliders, MAT, state, addBox, mapGroup };
export {
  PLAYER_EYE, PLAYER_CROUCH_EYE, PLAYER_RADIUS, GRAVITY, JUMP_SPEED,
  WALK_SPEED, RUN_SPEED, CROUCH_SPEED, AIR_ACCEL, GROUND_ACCEL,
  GROUND_FRICTION, MOUSE_SENS, MAX_PITCH, TEAM_CT, TEAM_T,
  SPAWN_CT, SPAWN_T, ENEMY_SPAWNS, MAP_SIZE, WALL_H,
};
