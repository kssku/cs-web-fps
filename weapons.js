import * as THREE from 'three';

/* =========================================================================
   武器系统 — 枪械数据、后坐力、弹道、命中判定
   ========================================================================= */

/** 武器定义表 */
export const WEAPONS = {
  AK47: {
    name: 'AK-47',
    damage: 36,
    headMult: 4.0,
    legMult: 0.75,
    rpm: 600,
    magSize: 30,
    reserve: 90,
    reloadTime: 2.5,
    spreadBase: 0.0016,
    spreadMove: 0.020,
    spreadAir: 0.055,
    recoilPitch: 0.0075,
    recoilYaw: 0.0026,
    recoilRecover: 7.5,
    range: 120,
    auto: true,
  },
  M4A1: {
    name: 'M4A1',
    damage: 30,
    headMult: 4.0,
    legMult: 0.75,
    rpm: 666,
    magSize: 30,
    reserve: 90,
    reloadTime: 3.1,
    spreadBase: 0.0013,
    spreadMove: 0.017,
    spreadAir: 0.048,
    recoilPitch: 0.0058,
    recoilYaw: 0.0020,
    recoilRecover: 8.2,
    range: 120,
    auto: true,
  },
  AWP: {
    name: 'AWP',
    damage: 115,
    headMult: 1.5,
    legMult: 0.9,
    rpm: 41,
    magSize: 10,
    reserve: 30,
    reloadTime: 3.7,
    spreadBase: 0.00008,
    spreadMove: 0.09,
    spreadAir: 0.16,
    recoilPitch: 0.045,
    recoilYaw: 0.004,
    recoilRecover: 3.0,
    range: 200,
    auto: false,
  },
  DEAGLE: {
    name: 'Desert Eagle',
    damage: 63,
    headMult: 4.0,
    legMult: 0.8,
    rpm: 267,
    magSize: 7,
    reserve: 35,
    reloadTime: 2.2,
    spreadBase: 0.0018,
    spreadMove: 0.032,
    spreadAir: 0.07,
    recoilPitch: 0.028,
    recoilYaw: 0.004,
    recoilRecover: 4.5,
    range: 100,
    auto: false,
  },
};

/** 武器运行时状态 */
export class Weapon {
  constructor(key) {
    this.key = key;
    this.def = WEAPONS[key];
    this.ammo = this.def.magSize;
    this.reserve = this.def.reserve;
    this.reloading = false;
    this.reloadEnd = 0;
    this.nextShotTime = 0;
    this.shotInterval = 60 / this.def.rpm;
    // 后坐力累积（需要回正）
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.shotCount = 0;
  }

  canShoot(now) {
    return !this.reloading && this.ammo > 0 && now >= this.nextShotTime;
  }

  canReload() {
    return !this.reloading && this.ammo < this.def.magSize && this.reserve > 0;
  }

  startReload(now) {
    if (!this.canReload()) return false;
    this.reloading = true;
    this.reloadEnd = now + this.def.reloadTime * 1000;
    return true;
  }

  updateReload(now) {
    if (this.reloading && now >= this.reloadEnd) {
      const need = this.def.magSize - this.ammo;
      const take = Math.min(need, this.reserve);
      this.ammo += take;
      this.reserve -= take;
      this.reloading = false;
      this.shotCount = 0;
      return true; // 换弹完成
    }
    return false;
  }

  /**
   * 开火，返回本次射击的散布与后坐力信息
   */
  fire(now) {
    this.ammo--;
    this.nextShotTime = now + this.shotInterval * 1000;
    this.shotCount++;

    // 连续射击时后坐力递增（前 10 发线性增长，之后保持）
    const ramp = Math.min(this.shotCount, 10) / 10;
    const pitchKick = this.def.recoilPitch * (0.55 + ramp * 0.75);
    const yawKick = this.def.recoilYaw * (0.5 + ramp) * (Math.random() * 2 - 1);

    this.recoilPitch += pitchKick;
    this.recoilYaw += yawKick;

    return { pitchKick, yawKick };
  }

  /**
   * 每秒调用：恢复后坐力
   */
  recoverRecoil(dt, isFiring) {
    if (isFiring) return;
    const rate = this.def.recoilRecover * dt;
    this.recoilPitch = Math.max(0, this.recoilPitch - rate * this.recoilPitch - rate * 0.002);
    this.recoilYaw -= Math.min(Math.abs(this.recoilYaw), rate * Math.abs(this.recoilYaw) + rate * 0.001) * Math.sign(this.recoilYaw);
    if (Math.abs(this.recoilPitch) < 1e-5) this.recoilPitch = 0;
    if (Math.abs(this.recoilYaw) < 1e-5) this.recoilYaw = 0;
    // 停火后重置连发计数
    if (this.shotCount > 0) this.shotCount = Math.max(0, this.shotCount - dt * 6);
  }

  /** 当前有效散布（弧度） */
  currentSpread(isMoving, isAir, isCrouch, isWalk) {
    let s = this.def.spreadBase;
    if (isAir) s += this.def.spreadAir;
    else if (isMoving) s += isWalk ? this.def.spreadMove * 0.45 : this.def.spreadMove;
    if (isCrouch) s *= 0.62;
    return s;
  }
}

// ------------------------------------------------------------------ 枪口火焰
let muzzleLight = null;
let muzzleTimer = 0;

export function initMuzzle(scene, camera) {
  muzzleLight = new THREE.PointLight(0xffcc66, 0, 8, 2);
  scene.add(muzzleLight);
  return muzzleLight;
}

export function flashMuzzle(camera) {
  if (!muzzleLight) return;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  muzzleLight.position.copy(camera.position).addScaledVector(dir, 0.8);
  muzzleLight.intensity = 6;
  muzzleTimer = 0.045;
  if (viewModel) {
    viewModel.flashTimer = 0.05;
    viewModel.kickZ += 0.055;
    viewModel.kickPitch += 0.05;
    viewModel.flashSprite.visible = true;
    viewModel.flashSprite.material.rotation = Math.random() * Math.PI;
    const s = 0.75 + Math.random() * 0.45;
    viewModel.flashSprite.scale.set(s, s, s);
  }
}

export function updateMuzzle(dt) {
  if (muzzleTimer > 0) {
    muzzleTimer -= dt;
    if (muzzleTimer <= 0 && muzzleLight) muzzleLight.intensity = 0;
  }
  if (viewModel && viewModel.flashTimer > 0) {
    viewModel.flashTimer -= dt;
    if (viewModel.flashTimer <= 0) viewModel.flashSprite.visible = false;
  }
}

// ==========================================================================
//  第一人称武器视图模型 — 程序化低多边形 AK-47
//  挂在相机下，仅渲染在近裁剪面之外；带开火后坐、换弹、走路摆动动画
// ==========================================================================

let viewModel = null;

const MAT_GUN = {
  body:   new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.62, metalness: 0.55 }),
  metal:  new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.38, metalness: 0.85 }),
  wood:   new THREE.MeshStandardMaterial({ color: 0x6b431f, roughness: 0.82, metalness: 0.05 }),
  mag:    new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.75, metalness: 0.1 }),
  hand:   new THREE.MeshStandardMaterial({ color: 0x1f1712, roughness: 0.95, metalness: 0.0 }),
};

/** 造一个盒子并摆位 */
function box(w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** 造一根圆柱并沿 X 轴摆放 */
function tube(r, len, x, y, z, mat, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

/**
 * 构建 AK-47 视图模型。坐标约定：-Z 为枪口指向，+X 为右。
 * @returns {THREE.Group} 可直接 add 到 camera 的组
 */
function buildAK47() {
  const g = new THREE.Group();

  // ---- 机匣
  g.add(box(0.075, 0.085, 0.30, 0, 0, -0.05, MAT_GUN.body));
  // 机匣顶部防尘盖（略窄，形成层次）
  g.add(box(0.055, 0.022, 0.24, 0, 0.052, -0.06, MAT_GUN.metal));

  // ---- 枪管 + 导气管
  g.add(tube(0.013, 0.30, 0, 0.022, -0.34, MAT_GUN.metal));
  g.add(tube(0.010, 0.20, 0, 0.052, -0.30, MAT_GUN.body));
  // 枪口制退器
  g.add(tube(0.020, 0.055, 0, 0.022, -0.515, MAT_GUN.metal));

  // ---- 护木（木质）
  g.add(box(0.062, 0.070, 0.19, 0, 0.012, -0.245, MAT_GUN.wood));
  // 护木下方的小握把
  g.add(box(0.050, 0.062, 0.075, 0, -0.058, -0.215, MAT_GUN.wood));

  // ---- 弹匣（AK 的香蕉弹匣，用两段错位模拟弧度）
  const mag1 = box(0.052, 0.13, 0.085, 0, -0.105, -0.045, MAT_GUN.mag);
  mag1.rotation.x = 0.10;
  g.add(mag1);
  const mag2 = box(0.050, 0.11, 0.080, 0, -0.205, -0.005, MAT_GUN.mag);
  mag2.rotation.x = 0.38;
  g.add(mag2);

  // ---- 握把（后倾）
  const grip = box(0.048, 0.135, 0.070, 0, -0.100, 0.075, MAT_GUN.wood);
  grip.rotation.x = -0.28;
  g.add(grip);

  // ---- 枪托
  const stock = box(0.048, 0.070, 0.26, 0, -0.020, 0.235, MAT_GUN.wood);
  stock.rotation.x = 0.045;
  g.add(stock);
  // 枪托底板
  g.add(box(0.052, 0.095, 0.020, 0, -0.030, 0.365, MAT_GUN.metal));

  // ---- 准星 / 照门
  g.add(box(0.012, 0.045, 0.012, 0, 0.075, -0.455, MAT_GUN.metal));
  g.add(box(0.030, 0.028, 0.014, 0, 0.072, -0.055, MAT_GUN.metal));

  // ---- 拉机柄
  g.add(tube(0.008, 0.055, 0.052, 0.030, -0.10, MAT_GUN.metal, 8));

  // ---- 持枪的手（低多边形示意，不做手指细节）
  const handR = box(0.058, 0.075, 0.085, 0.008, -0.125, 0.070, MAT_GUN.hand);
  handR.rotation.x = -0.30;
  g.add(handR);
  const handL = box(0.062, 0.070, 0.100, -0.005, -0.095, -0.225, MAT_GUN.hand);
  g.add(handL);

  // ---- 枪口火焰 sprite
  const flashMat = new THREE.SpriteMaterial({
    color: 0xffcc66, transparent: true, opacity: 0.95,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const flashSprite = new THREE.Sprite(flashMat);
  flashSprite.position.set(0, 0.022, -0.55);
  flashSprite.scale.set(0.75, 0.75, 0.75);
  flashSprite.visible = false;
  g.add(flashSprite);

  g.userData.flashSprite = flashSprite;
  return g;
}

/**
 * 初始化视图模型并挂到相机上。
 * @param {THREE.Camera} camera
 * @param {string} weaponKey
 */
export function initViewModel(camera, weaponKey = 'AK47') {
  if (viewModel) disposeViewModel();
  const root = buildAK47();

  // 基准持枪姿态：右下角，略微内旋
  const base = new THREE.Group();
  base.add(root);
  base.position.set(0.155, -0.145, -0.28);
  base.rotation.set(0.02, 0.055, 0.0);

  camera.add(base);

  viewModel = {
    root: base,
    gun: root,
    flashSprite: root.userData.flashSprite,
    // 动画状态
    kickZ: 0, kickPitch: 0,
    bobX: 0, bobY: 0, bobPhase: 0,
    reloadT: 0, reloadDur: 0,
    flashTimer: 0,
    basePos: base.position.clone(),
    baseRot: base.rotation.clone(),
  };
  return viewModel;
}

/** 触发换弹动画 */
export function playReloadAnim(durationSec) {
  if (!viewModel) return;
  viewModel.reloadT = durationSec;
  viewModel.reloadDur = durationSec;
}

/** 武器切换：重建模型（目前所有枪共用 AK 外形） */
export function setViewModelWeapon(camera, weaponKey) {
  initViewModel(camera, weaponKey);
}

function disposeViewModel() {
  if (!viewModel) return;
  const root = viewModel.root;
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
  if (root.parent) root.parent.remove(root);
  viewModel = null;
}

/**
 * 每帧更新视图模型动画。
 * @param {number} dt
 * @param {boolean} isMoving 玩家是否在移动
 * @param {number} hspeed  水平速度（用于摆动幅度）
 * @param {boolean} isReloading
 */
export function updateViewModel(dt, isMoving, hspeed, isReloading) {
  if (!viewModel) return;
  const vm = viewModel;

  // ---- 开火后坐回弹
  vm.kickZ += (0 - vm.kickZ) * Math.min(1, dt * 14);
  vm.kickPitch += (0 - vm.kickPitch) * Math.min(1, dt * 12);

  // ---- 走路摆动
  let targetBobX = 0, targetBobY = 0;
  if (isMoving && hspeed > 0.4) {
    vm.bobPhase += dt * hspeed * 2.3;
    const amp = Math.min(1, hspeed / 5.6) * 0.014;
    targetBobX = Math.sin(vm.bobPhase) * amp;
    targetBobY = -Math.abs(Math.cos(vm.bobPhase)) * amp * 0.75;
  }
  vm.bobX += (targetBobX - vm.bobX) * Math.min(1, dt * 12);
  vm.bobY += (targetBobY - vm.bobY) * Math.min(1, dt * 12);

  // ---- 换弹动画：枪下沉 + 前倾，末段回位
  let reloadDrop = 0, reloadTilt = 0;
  if (vm.reloadT > 0) {
    vm.reloadT = Math.max(0, vm.reloadT - dt);
    // 归一化进度 0→1
    const p = 1 - vm.reloadT / vm.reloadDur;
    // 前 25% 下沉，中段保持，后 30% 回位
    let k;
    if (p < 0.25) k = p / 0.25;
    else if (p < 0.70) k = 1;
    else k = Math.max(0, 1 - (p - 0.70) / 0.30);
    reloadDrop = -0.115 * k;
    reloadTilt = 0.38 * k;
  }

  const b = vm.basePos, r = vm.baseRot;
  vm.root.position.set(
    b.x + vm.bobX,
    b.y + vm.bobY + reloadDrop,
    b.z + vm.kickZ
  );
  vm.root.rotation.set(
    r.x + vm.kickPitch + reloadTilt,
    r.y,
    r.z
  );
}
