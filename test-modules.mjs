// 模块加载与逻辑自检（Node 环境，模拟最小 DOM）

const stubEl = () => ({
  style: {},
  classList: { add() {}, remove() {}, toggle() {} },
  textContent: '',
  innerHTML: '',
  appendChild() {},
  removeChild() {},
  remove() {},
  querySelectorAll: () => [],
  querySelector: () => stubEl(),
  addEventListener() {},
  getContext: () => ({
    clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, arc() {},
    fill() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, save() {},
    restore() {}, translate() {}, rotate() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {},
  }),
  width: 380, height: 380,
  animate: () => ({ onfinish: null }),
  prepend() {},
  get firstChild() { return null; },
  children: [],
});

// Three.js 的 WebGLRenderer 构造时会调 document.createElementNS('canvas')
// 并用返回对象的 getContext('webgl2'/'webgl') 探测上下文，桩里必须补齐
const stubCanvas = () => {
  const c = stubEl();
  // Three 会读若干 WebGL 枚举；返回类型必须与真实 GL 一致，否则内部会调字符串方法而崩
  const GL_VERSION = 0x1f02;
  const GL_SHADING_LANGUAGE_VERSION = 0x8b8c;
  const GL_VENDOR = 0x1f00;
  const GL_RENDERER = 0x1f01;
  const GL_MAX_TEXTURE_SIZE = 0x0d33;
  // 用真实对象而非 Proxy：Three 会直接读 gl.VERSION 之类的属性名吗？不会，
  // 它用 gl.getParameter(gl.VERSION)。但 Proxy 的 get 对未知属性一律返回函数，
  // 若 Three 读到 gl.SOMETHING 作为枚举再传回 getParameter，就会拿到函数。
  // 因此这里显式列出枚举常量，并让 getParameter 只按枚举分派。
  const glStub = {
    VERSION: GL_VERSION,
    SHADING_LANGUAGE_VERSION: GL_SHADING_LANGUAGE_VERSION,
    VENDOR: GL_VENDOR,
    RENDERER: GL_RENDERER,
    MAX_TEXTURE_SIZE: GL_MAX_TEXTURE_SIZE,
    MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32,
    MAX_TEXTURE_IMAGE_UNITS: 16,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 16,
    MAX_VERTEX_ATTRIBS: 16,
    MAX_VERTEX_UNIFORM_VECTORS: 1024,
    MAX_VARYING_VECTORS: 30,
    MAX_FRAGMENT_UNIFORM_VECTORS: 1024,
    MAX_CUBE_MAP_TEXTURE_SIZE: 4096,
    MAX_RENDERBUFFER_SIZE: 4096,
    MAX_VIEWPORT_DIMS: new Int32Array([4096, 4096]),
    SCISSOR_BOX: new Int32Array([0, 0, 1, 1]),
    VIEWPORT: new Int32Array([0, 0, 1, 1]),
    getParameter(pname) {
      switch (pname) {
        case GL_VERSION:
          return 'WebGL 1.0 (stub)';
        case GL_SHADING_LANGUAGE_VERSION:
          return 'WebGL GLSL ES 1.0 (stub)';
        case GL_VENDOR:
          return 'stub-vendor';
        case GL_RENDERER:
          return 'stub-renderer';
        case GL_MAX_TEXTURE_SIZE:
          return 4096;
        default:
          return 0;
      }
    },
    getExtension() { return null; },
    getSupportedExtensions() { return []; },
    getShaderPrecisionFormat() { return { rangeMin: 127, rangeMax: 127, precision: 23 }; },
    getContextAttributes() { return { alpha: true, depth: true, stencil: true, antialias: true }; },
    canvas: c,
    drawingBufferWidth: 1,
    drawingBufferHeight: 1,
  };
  // 显式属性优先；未列出的 GL 方法一律返回 no-op 函数。
  // Three 的 WebGLState 会创建 texture/buffer/framebuffer 等一长串对象，
  // 逐个手写不现实，用 Proxy 兜底但保证「已显式定义的属性」不被覆盖。
  const gl = new Proxy(glStub, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => undefined;
    },
  });
  c.getContext = () => gl;
  return c;
};

globalThis.document = {
  getElementById: () => stubEl(),
  createElement: (tag) => (tag === 'canvas' ? stubCanvas() : stubEl()),
  createElementNS: (ns, tag) => (tag === 'canvas' ? stubCanvas() : stubEl()),
  addEventListener() {},
  exitPointerLock() {},
  pointerLockElement: null,
  querySelectorAll: () => [],
  querySelector: () => stubEl(),
};

globalThis.window = {
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener() {},
};

globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.requestAnimationFrame = () => 0;

let pass = 0, fail = 0;
function check(name, fn) {
  try {
    const r = fn();
    if (r === false) { console.log('  FAIL  ' + name); fail++; }
    else { console.log('  ok    ' + name); pass++; }
  } catch (e) {
    console.log('  FAIL  ' + name + '  -> ' + e.message);
    fail++;
  }
}

console.log('\n=== 1. 模块导入 ===');
const mapMod = await import('./map.js');
console.log('  ok    map.js');
const weaponsMod = await import('./weapons.js');
console.log('  ok    weapons.js');
const playerMod = await import('./player.js');
console.log('  ok    player.js');
const enemyMod = await import('./enemy.js');
console.log('  ok    enemy.js');
const hudMod = await import('./hud.js');
console.log('  ok    hud.js');

console.log('\n=== 2. 导出符号检查 ===');
check('map: scene/camera/colliders 存在', () => mapMod.scene && mapMod.camera && Array.isArray(mapMod.colliders));
check('map: 碰撞体已生成 (>20)', () => mapMod.colliders.length > 20);
check('map: SPAWN_CT / ENEMY_SPAWNS', () => mapMod.SPAWN_CT && mapMod.ENEMY_SPAWNS.length >= 6);
check('map: MAP_SIZE 导出', () => typeof mapMod.MAP_SIZE === 'number');
check('weapons: WEAPONS 表含 4 把枪', () => Object.keys(weaponsMod.WEAPONS).length === 4);
check('weapons: Weapon 类', () => typeof weaponsMod.Weapon === 'function');
check('player: Player 类', () => typeof playerMod.Player === 'function');
check('enemy: Enemy 类 + ENEMY_STATE', () => typeof enemyMod.Enemy === 'function' && enemyMod.ENEMY_STATE.ATTACK === 'attack');
check('enemy: rayAABBPublic 导出', () => typeof enemyMod.rayAABBPublic === 'function');
check('hud: drawMinimap / updateVitals 导出', () => typeof hudMod.drawMinimap === 'function' && typeof hudMod.updateVitals === 'function');
check('hud: showHitDirection 导出', () => typeof hudMod.showHitDirection === 'function');
check('hud: addKillFeed 导出', () => typeof hudMod.addKillFeed === 'function');

console.log('\n=== 3. 武器逻辑 ===');
const { Weapon, WEAPONS } = weaponsMod;
check('AK47 弹匣 30 发', () => WEAPONS.AK47.magSize === 30);
const w = new Weapon('AK47');
check('初始弹药 = 弹匣容量', () => w.ammo === 30);
check('开火后弹药 -1', () => { w.fire(0); return w.ammo === 29; });
check('开火产生后坐力', () => w.recoilPitch > 0);
check('冷却期内不能连射', () => w.canShoot(0) === false);
check('冷却结束后可射击', () => w.canShoot(1000) === true);
check('换弹后可继续', () => { w.ammo = 0; const ok = w.startReload(0); w.updateReload(3000); return ok && w.ammo === 30; });
check('散布随移动增大', () => w.currentSpread(true, false, false, false) > w.currentSpread(false, false, false, false));
check('空中散布最大', () => w.currentSpread(false, true, false, false) > w.currentSpread(true, false, false, false));
check('下蹲减小散布', () => w.currentSpread(true, false, true, false) < w.currentSpread(true, false, false, false));

console.log("\n=== 4. 玩家控制器 ===");
const { Player } = playerMod;
const cam = mapMod.camera;
const V3 = mapMod.SPAWN_CT.constructor;
const p = new Player(cam, mapMod.colliders);
p.spawn(mapMod.SPAWN_CT);
check("出生后满血", () => p.hp === 100 && p.armor === 100 && p.alive);
check("出生位置正确", () => Math.abs(p.position.x - mapMod.SPAWN_CT.x) < 0.01);
check("鼠标控制 yaw", () => { const y0 = p.yaw; p.handleMouse(100, 0); return p.yaw !== y0; });
check("pitch 被限制在 90 度内", () => { p.handleMouse(0, 100000); return Math.abs(p.pitch) <= Math.PI / 2; });
const noKeys = { w: false, a: false, s: false, d: false, shift: false, ctrl: false, space: false };
const wKeys = { ...noKeys, w: true };
check("按 W 会移动", () => {
  const z0 = p.position.z;
  for (let i = 0; i < 30; i++) p.update(1 / 60, wKeys, true);
  return Math.abs(p.position.z - z0) > 0.1;
});
check("重力使玩家落地", () => {
  for (let i = 0; i < 60; i++) p.update(1 / 60, noKeys, true);
  return Math.abs(p.position.y) < 0.5;
});
check("跳跃使玩家离地", () => {
  p.update(1 / 60, { ...noKeys, space: true }, true);
  return p.position.y > 0.05 || p.velocity.y > 0;
});
check("碰撞：不会穿出地图", () => {
  p.spawn(new V3(0, 0, 0));
  for (let i = 0; i < 400; i++) p.update(1 / 60, wKeys, true);
  const half = mapMod.MAP_SIZE / 2;
  return Math.abs(p.position.x) < half && Math.abs(p.position.z) < half;
});
check("受伤扣血", () => { p.spawn(mapMod.SPAWN_CT); p.takeDamage(30, false); return p.hp < 100; });
check("护甲吸收部分伤害", () => {
  const a = new Player(cam, mapMod.colliders); a.spawn(mapMod.SPAWN_CT); a.takeDamage(50, true);
  const b = new Player(cam, mapMod.colliders); b.spawn(mapMod.SPAWN_CT); b.takeDamage(50, false);
  return a.hp > b.hp;
});
check("血量归零判定死亡", () => { p.spawn(mapMod.SPAWN_CT); return p.takeDamage(500, false) === true && !p.alive; });
check("蹲伏降低视高", () => {
  p.spawn(mapMod.SPAWN_CT); p.crouching = true;
  return p.eyePosition.y < mapMod.PLAYER_EYE;
});
check("眼睛位置高于脚底", () => {
  p.spawn(mapMod.SPAWN_CT); p.crouching = false;
  return p.eyePosition.y > p.position.y + 1.0;
});

console.log("\n=== 5. 敌人 AI ===");
const { Enemy, ENEMY_STATE } = enemyMod;
const dummyPlayer = new Player(cam, mapMod.colliders);
dummyPlayer.spawn(mapMod.SPAWN_CT);
const e = new Enemy(new V3(30, 0, -30), [new V3(24, 0, -22), new V3(10, 0, -8)]);
mapMod.scene.add(e.mesh);
check("敌人初始满血存活", () => e.hp === 100 && e.alive);
check("初始状态为巡逻", () => e.state === ENEMY_STATE.PATROL);
check("受击掉血", () => { const r = e.takeDamage(30, "body"); return r.damage === 30 && e.hp === 70; });
check("爆头 4 倍伤害", () => {
  const e2 = new Enemy(new V3(30, 0, -30), []);
  return e2.takeDamage(30, "head").damage === 120;
});
check("腿部 0.75 倍伤害", () => {
  const e3 = new Enemy(new V3(30, 0, -30), []);
  return e3.takeDamage(40, "leg").damage === 30;
});
check("受击后进入警戒", () => {
  const e4 = new Enemy(new V3(30, 0, -30), []);
  e4.takeDamage(10, "body");
  return e4.state === ENEMY_STATE.ALERT;
});
check("击杀返回 killed=true", () => {
  const e5 = new Enemy(new V3(30, 0, -30), []);
  const r = e5.takeDamage(200, "body");
  return r.killed === true && !e5.alive;
});
check("敌人能持续更新而不报错", () => {
  const e6 = new Enemy(new V3(30, 0, -30), [new V3(20, 0, -20)]);
  mapMod.scene.add(e6.mesh);
  for (let i = 0; i < 120; i++) e6.update(1 / 60, dummyPlayer, () => {});
  return true;
});
check("敌人会巡逻移动", () => {
  const e7 = new Enemy(new V3(30, 0, -30), [new V3(10, 0, -30)]);
  const far = new Player(cam, mapMod.colliders);
  far.spawn(new V3(-40, 0, 40));
  const x0 = e7.position.x;
  for (let i = 0; i < 180; i++) e7.update(1 / 60, far, () => {});
  return Math.abs(e7.position.x - x0) > 0.5;
});
check("视线检测：近距正对可见", () => {
  const e8 = new Enemy(new V3(0, 0, 0), []);
  return e8.hasLineOfSight(new V3(0, 1.6, -3)) === true;
});
check("视线检测：穿墙被阻挡", () => {
  const e9 = new Enemy(new V3(0, 0, 0), []);
  return e9.hasLineOfSight(new V3(0, 1.6, -100)) === false;
});
check("射线-AABB 相交距离正确", () => {
  const box = { min: new V3(-1, -1, -5), max: new V3(1, 1, -3) };
  const t = enemyMod.rayAABBPublic(new V3(0, 0, 0), new V3(0, 0, -1), box, 100);
  return t !== null && Math.abs(t - 3) < 0.01;
});
check("射线-AABB 未命中返回 null", () => {
  const box = { min: new V3(5, 5, -5), max: new V3(6, 6, -3) };
  return enemyMod.rayAABBPublic(new V3(0, 0, 0), new V3(0, 0, -1), box, 100) === null;
});
check("听到枪声会警觉", () => {
  const e10 = new Enemy(new V3(30, 0, -30), []);
  e10.hearGunshot(new V3(28, 0, -28));
  return e10.state === ENEMY_STATE.CHASE;
});
check("远处枪声不影响", () => {
  const e11 = new Enemy(new V3(30, 0, -30), []);
  e11.hearGunshot(new V3(-30, 0, 30));
  return e11.state === ENEMY_STATE.PATROL;
});
check("死亡后倒地动画推进", () => {
  const e12 = new Enemy(new V3(30, 0, -30), []);
  mapMod.scene.add(e12.mesh);
  e12.takeDamage(500, "body");
  const r0 = e12.mesh.rotation.x;
  for (let i = 0; i < 30; i++) e12.update(1 / 60, dummyPlayer, () => {});
  return e12.mesh.rotation.x < r0;
});

console.log("\n=== 6. 地图完整性 ===");
check("碰撞体数量合理 (30-140)", () => mapMod.colliders.length >= 30 && mapMod.colliders.length <= 140);
check("所有碰撞体坐标有限", () => mapMod.colliders.every((c) =>
  Number.isFinite(c.min.x) && Number.isFinite(c.max.x) &&
  Number.isFinite(c.min.y) && Number.isFinite(c.max.y) &&
  Number.isFinite(c.min.z) && Number.isFinite(c.max.z)));
check("碰撞体 min < max", () => mapMod.colliders.every((c) => c.min.x < c.max.x && c.min.y < c.max.y && c.min.z < c.max.z));
check("外墙存在", () => mapMod.colliders.filter((c) => c.max.y >= 6).length >= 4);
check("CT 出生点畅通", () => {
  const s = mapMod.SPAWN_CT;
  return !mapMod.colliders.some((c) =>
    s.x > c.min.x - 0.5 && s.x < c.max.x + 0.5 &&
    s.z > c.min.z - 0.5 && s.z < c.max.z + 0.5 && c.max.y > 0.5);
});
check("T 出生点畅通", () => {
  const s = mapMod.SPAWN_T;
  return !mapMod.colliders.some((c) =>
    s.x > c.min.x - 0.5 && s.x < c.max.x + 0.5 &&
    s.z > c.min.z - 0.5 && s.z < c.max.z + 0.5 && c.max.y > 0.5);
});
check("敌人出生点畅通", () => mapMod.ENEMY_SPAWNS.every((s) =>
  !mapMod.colliders.some((c) =>
    s.x > c.min.x - 0.5 && s.x < c.max.x + 0.5 &&
    s.z > c.min.z - 0.5 && s.z < c.max.z + 0.5 && c.max.y > 0.5)));

console.log("\n=== 7. HUD 模块 ===");
check("updateVitals 可调用", () => { hudMod.updateVitals(p, w); return true; });
check("drawMinimap 可调用", () => { hudMod.drawMinimap(dummyPlayer, [e], mapMod.colliders); return true; });
check("updateCrosshair 可调用", () => { hudMod.updateCrosshair(dummyPlayer, w, 0.016); return true; });
check("updateScore 可调用", () => { hudMod.updateScore(); return true; });
check("showHitmarker 可调用", () => { hudMod.showHitmarker(true); return true; });
check("addKillFeed 可调用", () => { hudMod.addKillFeed("you", "T", true, true); return true; });
check("flashDamage 可调用", () => { hudMod.flashDamage(1); return true; });

console.log("\n" + "=".repeat(48));
console.log("  PASS " + pass + "   FAIL " + fail);
console.log("=".repeat(48) + "\n");
process.exit(fail > 0 ? 1 : 0);
