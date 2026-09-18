import * as THREE from 'three';
import {
  scene, camera, renderer, colliders, state,
  SPAWN_CT, ENEMY_SPAWNS, MAP_SIZE,
} from './map.js';
import { Player } from './player.js';
import { Enemy, ENEMY_STATE, rayAABBPublic } from './enemy.js';
import {
  Weapon, initMuzzle, flashMuzzle, updateMuzzle,
  initViewModel, updateViewModel, playReloadAnim,
} from './weapons.js';
import {
  updateVitals, updateScore, updateCrosshair, showHitmarker, updateHitmarker,
  flashDamage, updateDamageFlash, addKillFeed, drawMinimap, toggleScoreboard,
  showHitDirection, ui,
} from './hud.js';

/* =========================================================================
   主入口 — 游戏循环、输入、射击判定、回合管理、音效
   ========================================================================= */

// ------------------------------------------------------------------ 输入
const keys = { w: false, a: false, s: false, d: false, shift: false, ctrl: false, space: false };
let mouseDown = false;
let pointerLocked = false;

// ------------------------------------------------------------------ 实体
const player = new Player(camera, colliders);
let weapon = new Weapon('AK47');
let enemies = [];
const tracers = [];          // 弹道拖尾
const impactMarks = [];      // 弹孔
let gameTime = 0;
let roundActive = false;

initMuzzle(scene, camera);

// 第一人称武器视图模型（挂到相机下）
scene.add(camera);                 // 视图模型是 camera 的子节点，需确保相机在场景图中
initViewModel(camera, 'AK47');

// ------------------------------------------------------------------ 音效（WebAudio 程序化生成，无需资源文件）
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

/**
 * 合成枪声。分四层叠加，模拟真实枪械的瞬态与空间感：
 *   1. 爆音主体（带通噪声，快速衰减）
 *   2. 高频"啪"瞬态（开火瞬间的脆响，无它则发闷）
 *   3. 低频胸腔冲击（正弦下滑）
 *   4. 尾音/回声（低通噪声慢衰减，模拟环境反射）
 * 敌人枪声做去高频 + 加长尾音处理，听感更"远"。
 */
function playGunshot(isEnemy = false) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;

  // ---- 1. 爆音主体
  const dur = isEnemy ? 0.16 : 0.13;
  const buf = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * dur), audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    // 前 3% 保持满幅，之后指数衰减——保留真实的起爆瞬态
    const x = i / data.length;
    const decay = x < 0.03 ? 1 : Math.pow(1 - x, 2.2);
    data[i] = (Math.random() * 2 - 1) * decay;
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buf;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = isEnemy ? 800 : 1500;
  filter.Q.value = isEnemy ? 0.7 : 0.9;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(isEnemy ? 0.17 : 0.32, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

  src.connect(filter).connect(gain).connect(audioCtx.destination);
  src.start(t);
  src.stop(t + dur);

  // ---- 2. 高频瞬态脆响（AK 特有的"啪"）
  const crackDur = 0.028;
  const cbuf = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * crackDur), audioCtx.sampleRate);
  const cdata = cbuf.getChannelData(0);
  for (let i = 0; i < cdata.length; i++) {
    cdata[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / cdata.length, 1.2);
  }
  const csrc = audioCtx.createBufferSource();
  csrc.buffer = cbuf;
  const cfilter = audioCtx.createBiquadFilter();
  cfilter.type = 'highpass';
  cfilter.frequency.value = isEnemy ? 2200 : 3200;
  const cgain = audioCtx.createGain();
  cgain.gain.setValueAtTime(isEnemy ? 0.07 : 0.16, t);
  cgain.gain.exponentialRampToValueAtTime(0.001, t + crackDur);
  csrc.connect(cfilter).connect(cgain).connect(audioCtx.destination);
  csrc.start(t);
  csrc.stop(t + crackDur);

  // ---- 3. 低频胸腔冲击
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(isEnemy ? 100 : 175, t);
  osc.frequency.exponentialRampToValueAtTime(42, t + 0.1);
  const og = audioCtx.createGain();
  og.gain.setValueAtTime(isEnemy ? 0.1 : 0.22, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc.connect(og).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.13);

  // ---- 4. 尾音 / 环境回声
  const tailDur = isEnemy ? 0.32 : 0.24;
  const tbuf = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * tailDur), audioCtx.sampleRate);
  const tdata = tbuf.getChannelData(0);
  for (let i = 0; i < tdata.length; i++) {
    const x = i / tdata.length;
    tdata[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, 3.4);
  }
  const tsrc = audioCtx.createBufferSource();
  tsrc.buffer = tbuf;
  const tfilter = audioCtx.createBiquadFilter();
  tfilter.type = 'lowpass';
  tfilter.frequency.setValueAtTime(1800, t);
  tfilter.frequency.exponentialRampToValueAtTime(420, t + tailDur);
  const tgain = audioCtx.createGain();
  tgain.gain.setValueAtTime(0.0001, t);
  tgain.gain.linearRampToValueAtTime(isEnemy ? 0.035 : 0.06, t + 0.012);
  tgain.gain.exponentialRampToValueAtTime(0.001, t + tailDur);
  tsrc.connect(tfilter).connect(tgain).connect(audioCtx.destination);
  tsrc.start(t);
  tsrc.stop(t + tailDur);
}

function playHitSound(headshot) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(headshot ? 1500 : 950, t);
  osc.frequency.exponentialRampToValueAtTime(headshot ? 900 : 600, t + 0.07);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.14, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.09);
}

/**
 * 换弹音：三段机械动作
 *   退弹匣（低沉"咔"）→ 插入新弹匣（金属撞击）→ 拉机柄（清脆金属滑动）
 * @param {number} durationSec 换弹总时长（用于把三段铺开到整段动画上）
 */
function playReloadSound(durationSec = 2.5) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;

  // 金属"咔哒"：短促带通噪声 + 高频正弦泛音
  const clack = (delay, freq, vol, decay = 0.06) => {
    const dur = decay;
    const buf = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * dur), audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.4);
    }
    const s = audioCtx.createBufferSource();
    s.buffer = buf;
    const f = audioCtx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.6;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(vol, t + delay);
    g.gain.exponentialRampToValueAtTime(0.001, t + delay + dur);
    s.connect(f).connect(g).connect(audioCtx.destination);
    s.start(t + delay);
    s.stop(t + delay + dur);

    // 叠加一个高频泛音，让"金属感"更突出
    const o = audioCtx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq * 1.7, t + delay);
    o.frequency.exponentialRampToValueAtTime(freq * 0.9, t + delay + dur);
    const og = audioCtx.createGain();
    og.gain.setValueAtTime(vol * 0.45, t + delay);
    og.gain.exponentialRampToValueAtTime(0.001, t + delay + dur);
    o.connect(og).connect(audioCtx.destination);
    o.start(t + delay);
    o.stop(t + delay + dur);
  };

  // 按换弹时长铺开三段动作（长枪约 2.5s，短枪更快）
  const s1 = durationSec * 0.10;   // 按弹匣释放钮
  const s2 = durationSec * 0.45;   // 插入新弹匣
  const s3 = durationSec * 0.78;   // 拉机柄上膛

  clack(s1, 520, 0.09, 0.05);
  clack(s2, 300, 0.13, 0.07);
  clack(s3, 1500, 0.11, 0.05);
  // 拉机柄的滑动摩擦尾音
  clack(s3 + 0.04, 900, 0.06, 0.09);
}

function playPlayerHurt() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(90, t + 0.18);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.13, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.21);
}

// ------------------------------------------------------------------ 弹道可视

function spawnTracer(from, to) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(0.014, 0.014, len, 5, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffe08a, transparent: true, opacity: 0.75, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  scene.add(mesh);
  tracers.push({ mesh, life: 0.06, maxLife: 0.06 });
}

function spawnImpact(point, normal) {
  const geo = new THREE.CircleGeometry(0.05, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.85, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(point);
  if (normal) {
    m.lookAt(point.clone().add(normal));
  }
  m.position.addScaledVector(normal || new THREE.Vector3(0, 0, 0), 0.012);
  scene.add(m);
  impactMarks.push({ mesh: m, life: 12 });
  if (impactMarks.length > 60) {
    const old = impactMarks.shift();
    scene.remove(old.mesh);
    old.mesh.geometry.dispose();
    old.mesh.material.dispose();
  }
}

function spawnParticles(point, color) {
  const count = 5;
  for (let i = 0; i < count; i++) {
    const geo = new THREE.SphereGeometry(0.028, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(point);
    scene.add(m);
    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * 3,
      Math.random() * 2.4,
      (Math.random() - 0.5) * 3
    );
    tracers.push({
      mesh: m, life: 0.42, maxLife: 0.42, gravity: true, vel,
    });
  }
}

// ------------------------------------------------------------------ 射线命中

/**
 * 从相机发射一条射线，返回最近的命中（世界几何或敌人）
 */
function raycastShot(origin, dir, maxDist) {
  // ---- 1. 世界几何
  let wallT = maxDist;
  let wallNormal = null;
  for (const c of colliders) {
    const t = rayAABBPublic(origin, dir, c, maxDist);
    if (t !== null && t < wallT) {
      wallT = t;
      // 计算命中面法线
      const p = origin.clone().addScaledVector(dir, t);
      const eps = 1e-4;
      const dmin = Math.min(
        Math.abs(p.x - c.min.x), Math.abs(p.x - c.max.x),
        Math.abs(p.y - c.min.y), Math.abs(p.y - c.max.y),
        Math.abs(p.z - c.min.z), Math.abs(p.z - c.max.z)
      );
      if (dmin === Math.abs(p.x - c.min.x)) wallNormal = new THREE.Vector3(-1, 0, 0);
      else if (dmin === Math.abs(p.x - c.max.x)) wallNormal = new THREE.Vector3(1, 0, 0);
      else if (dmin === Math.abs(p.y - c.min.y)) wallNormal = new THREE.Vector3(0, -1, 0);
      else if (dmin === Math.abs(p.y - c.max.y)) wallNormal = new THREE.Vector3(0, 1, 0);
      else if (dmin === Math.abs(p.z - c.min.z)) wallNormal = new THREE.Vector3(0, 0, -1);
      else wallNormal = new THREE.Vector3(0, 0, 1);
    }
  }

  // ---- 2. 敌人（用每个部件的 AABB 做检测）
  let best = null;
  const raycaster = new THREE.Raycaster(origin, dir, 0.05, Math.min(wallT, maxDist));

  for (const e of enemies) {
    if (!e.alive) continue;
    // 快速距离剔除
    if (e.position.distanceTo(origin) > maxDist + 2) continue;

    const hits = raycaster.intersectObject(e.mesh, true);
    for (const h of hits) {
      if (h.distance >= wallT) continue;
      const zone = h.object.userData.hitZone || 'body';
      if (!best || h.distance < best.distance) {
        best = { distance: h.distance, point: h.point.clone(), enemy: e, zone };
      }
      break; // 该敌人的最近命中已足够
    }
  }

  if (best) return { type: 'enemy', ...best };
  if (wallNormal) {
    return {
      type: 'wall',
      distance: wallT,
      point: origin.clone().addScaledVector(dir, wallT),
      normal: wallNormal,
    };
  }
  return { type: 'none', distance: maxDist, point: origin.clone().addScaledVector(dir, maxDist) };
}

// ------------------------------------------------------------------ 玩家射击

function playerShoot() {
  if (!player.alive || !roundActive) return;
  const now = performance.now();
  if (!weapon.canShoot(now)) return;

  ensureAudio();
  weapon.fire(now);

  // 后坐力应用到玩家视角
  player.recoilPitch += weapon.recoilPitch * 0.9;
  player.recoilYaw += weapon.recoilYaw * 0.9;
  weapon.recoilPitch = 0;
  weapon.recoilYaw = 0;

  flashMuzzle(camera);
  playGunshot(false);

  // ---- 计算弹道方向（含散布）
  const spread = weapon.currentSpread(player.isMoving, !player.onGround, player.crouching, player.walking);
  const dir = new THREE.Vector3(0, 0, -1);
  const euler = new THREE.Euler(
    player.pitch + player.recoilPitch + (Math.random() - 0.5) * spread * 2,
    player.yaw + player.recoilYaw + (Math.random() - 0.5) * spread * 2,
    0, 'YXZ'
  );
  dir.applyEuler(euler).normalize();

  const origin = player.eyePosition;
  const hit = raycastShot(origin, dir, weapon.def.range);

  // ---- 弹道拖尾
  spawnTracer(
    origin.clone().addScaledVector(dir, 0.55).add(new THREE.Vector3(0, -0.12, 0)),
    hit.point
  );

  if (hit.type === 'enemy') {
    const res = hit.enemy.takeDamage(weapon.def.damage, hit.zone);
    spawnParticles(hit.point, 0xcc2222);
    playHitSound(hit.zone === 'head');
    showHitmarker(res.killed);

    if (res.killed) {
      state.playerKills++;
      const headshot = hit.zone === 'head';
      addKillFeed('你', 'T-敌人', headshot, true);
      updateScoreboardSoon();
    }
  } else if (hit.type === 'wall') {
    spawnImpact(hit.point, hit.normal);
    spawnParticles(hit.point, 0xbbbbbb);
  }

  // ---- 枪声吸引附近敌人
  for (const e of enemies) e.hearGunshot(player.position);
}

// ------------------------------------------------------------------ 敌人射击回调

const enemyShootPos = new THREE.Vector3();

function onEnemyShoot(origin, aim, willHit, enemy) {
  ensureAudio();
  playGunshot(true);

  // 视觉弹道
  const dir = new THREE.Vector3().subVectors(aim, origin).normalize();
  const maxD = origin.distanceTo(aim);
  const hit = raycastShot(origin, dir, maxD + 4);
  spawnTracer(origin, hit.point);

  if (hit.type === 'wall') {
    spawnImpact(hit.point, hit.normal);
  }

  // 实际伤害判定：只有 willHit 且玩家在弹道附近才命中
  if (willHit && player.alive) {
    const dmg = 9 + Math.random() * 8;
    const died = player.takeDamage(dmg, player.armor > 0);
    flashDamage(1);
    playPlayerHurt();
    showHitDirection(origin.x, origin.z, player.position.x, player.position.z, player.yaw);

    if (died) onPlayerDeath();
  }
}

// ------------------------------------------------------------------ 回合管理

function spawnEnemies(count) {
  for (const e of enemies) scene.remove(e.mesh);
  enemies = [];

  const patrolSets = [
    // 每组巡逻点
    [new THREE.Vector3(24, 0, -22), new THREE.Vector3(10, 0, -8), new THREE.Vector3(0, 0, 0), new THREE.Vector3(-14, 0, -14)],
    [new THREE.Vector3(30, 0, -26), new THREE.Vector3(20, 0, -10), new THREE.Vector3(8, 0, 4), new THREE.Vector3(-6, 0, -6)],
    [new THREE.Vector3(-24, 0, -18), new THREE.Vector3(-10, 0, -10), new THREE.Vector3(4, 0, -2), new THREE.Vector3(18, 0, -16)],
    [new THREE.Vector3(26, 0, -28), new THREE.Vector3(14, 0, 8), new THREE.Vector3(-4, 0, 14), new THREE.Vector3(-18, 0, 4)],
    [new THREE.Vector3(32, 0, -20), new THREE.Vector3(16, 0, -4), new THREE.Vector3(0, 0, 10), new THREE.Vector3(-12, 0, 18)],
    [new THREE.Vector3(22, 0, -32), new THREE.Vector3(6, 0, -14), new THREE.Vector3(-8, 0, 2), new THREE.Vector3(-20, 0, -8)],
  ];

  for (let i = 0; i < count; i++) {
    const sp = ENEMY_SPAWNS[i % ENEMY_SPAWNS.length].clone();
    sp.x += (Math.random() - 0.5) * 4;
    sp.z += (Math.random() - 0.5) * 4;
    sp.y = 0;
    const e = new Enemy(sp, patrolSets[i % patrolSets.length]);
    scene.add(e.mesh);
    enemies.push(e);
  }
  state.enemiesAlive = enemies.length;
}

function startRound() {
  state.round = state.round || 1;
  player.spawn(SPAWN_CT);
  weapon = new Weapon('AK47');
  spawnEnemies(Math.min(6, 3 + Math.floor(state.round / 2)));
  roundActive = true;
  state.dead = false;
  hideAllOverlays();
  requestPointerLock();
  updateScore();
}

function onPlayerDeath() {
  roundActive = false;
  state.playerDeaths++;
  state.scoreT++;
  updateScore();

  document.getElementById('death-stats').innerHTML = `
    本回合击杀：<b>${state.playerKills}</b><br>
    总死亡次数：<b>${state.playerDeaths}</b><br>
    当前比分：<b>CT ${state.scoreCT} : ${state.scoreT} T</b>
  `;
  showOverlay('death-screen');
  exitPointerLock();
}

function onRoundWin() {
  roundActive = false;
  state.scoreCT++;
  updateScore();

  document.getElementById('win-stats').innerHTML = `
    回合 <b>${state.round}</b> 清剿完成<br>
    累计击杀：<b>${state.playerKills}</b><br>
    当前比分：<b>CT ${state.scoreCT} : ${state.scoreT} T</b>
  `;
  showOverlay('win-screen');
  exitPointerLock();
}

function checkRoundState() {
  if (!roundActive) return;
  const alive = enemies.filter((e) => e.alive).length;
  state.enemiesAlive = alive;
  if (alive === 0) onRoundWin();
}

function updateScoreboardSoon() {
  // 计分板打开时实时刷新
  if (scoreboardOpen) toggleScoreboard(true);
}

let scoreboardOpen = false;

// ------------------------------------------------------------------ 覆盖层控制

function showOverlay(id) {
  document.getElementById(id).classList.remove('hidden');
}

function hideAllOverlays() {
  for (const id of ['start-screen', 'pause-screen', 'death-screen', 'win-screen']) {
    document.getElementById(id).classList.add('hidden');
  }
}

// ------------------------------------------------------------------ 指针锁定

function requestPointerLock() {
  const canvas = renderer.domElement;
  if (canvas.requestPointerLock) canvas.requestPointerLock();
}

function exitPointerLock() {
  if (document.exitPointerLock) document.exitPointerLock();
}

// ------------------------------------------------------------------ 事件绑定

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w') keys.w = true;
  if (k === 'a') keys.a = true;
  if (k === 's') keys.s = true;
  if (k === 'd') keys.d = true;
  if (k === 'shift') keys.shift = true;
  if (k === 'control') keys.ctrl = true;
  if (k === ' ') { keys.space = true; e.preventDefault(); }

  if (k === 'r') {
    if (player.alive && roundActive && weapon.startReload(performance.now())) {
      // 传入本枪的实际换弹时长，让三段机械音与动画同步
      playReloadSound(weapon.def.reloadTime);
      playReloadAnim(weapon.def.reloadTime);
    }
  }

  if (k === 'tab') {
    e.preventDefault();
    scoreboardOpen = true;
    toggleScoreboard(true);
  }

  if (k === 'escape') {
    // 浏览器会自动退出指针锁定，pause 在 pointerlockchange 里处理
  }
});

window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w') keys.w = false;
  if (k === 'a') keys.a = false;
  if (k === 's') keys.s = false;
  if (k === 'd') keys.d = false;
  if (k === 'shift') keys.shift = false;
  if (k === 'control') keys.ctrl = false;
  if (k === ' ') keys.space = false;
  if (k === 'tab') {
    scoreboardOpen = false;
    toggleScoreboard(false);
  }
});

window.addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    mouseDown = true;
    if (pointerLocked) playerShoot();
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
});

window.addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  player.handleMouse(e.movementX || 0, e.movementY || 0);
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
  if (!pointerLocked && roundActive && player.alive) {
    state.paused = true;
    showOverlay('pause-screen');
  } else if (pointerLocked) {
    state.paused = false;
    hideAllOverlays();
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- 按钮
const btnStart = document.getElementById('btn-start');
btnStart.addEventListener('click', () => {
  ensureAudio();
  state.round = 1;
  state.scoreCT = 0;
  state.scoreT = 0;
  state.playerKills = 0;
  state.playerDeaths = 0;
  startRound();
});

document.getElementById('btn-resume').addEventListener('click', () => requestPointerLock());
document.getElementById('btn-restart-1').addEventListener('click', () => {
  state.round = 1;
  state.scoreCT = 0;
  state.scoreT = 0;
  state.playerKills = 0;
  state.playerDeaths = 0;
  startRound();
});
document.getElementById('btn-respawn').addEventListener('click', () => {
  startRound();
});
document.getElementById('btn-next').addEventListener('click', () => {
  state.round++;
  startRound();
});

// ------------------------------------------------------------------ 游戏循环

let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.1) dt = 0.1;   // 防止切标签页后大跳
  gameTime += dt;

  const active = roundActive && !state.paused && player.alive;

  // ---- 玩家
  if (active) {
    player.update(dt, keys, true);
    weapon.updateReload(now);
    weapon.recoverRecoil(dt, mouseDown);

    // 连发
    if (mouseDown && weapon.def.auto && weapon.canShoot(now)) {
      playerShoot();
    }

    // 后坐力回正（把武器累积的后坐力平滑回移到视角）
    if (!mouseDown) {
      const rec = Math.min(1, dt * 8);
      player.recoilPitch += (0 - player.recoilPitch) * rec;
      player.recoilYaw += (0 - player.recoilYaw) * rec;
      if (Math.abs(player.recoilPitch) < 1e-4) player.recoilPitch = 0;
      if (Math.abs(player.recoilYaw) < 1e-4) player.recoilYaw = 0;
    }
  }

  // ---- 相机
  const eye = player.eyePosition;
  camera.position.copy(eye);
  camera.rotation.set(
    player.pitch + player.recoilPitch,
    player.yaw + player.recoilYaw,
    0,
    'YXZ'
  );

  // 后坐力让镜头轻微上抬的额外视觉（枪口跳动）
  camera.position.y += Math.sin(gameTime * 30) * 0.002 * (mouseDown ? 1 : 0);

  // ---- 第一人称视图模型（呼吸/摆动/后坐/换弹动画）
  const hspeed = Math.hypot(player.velocity.x, player.velocity.z);
  updateViewModel(
    dt,
    active && player.isMoving,
    hspeed,
    weapon.reloading
  );

  // ---- 敌人
  if (roundActive) {
    for (const e of enemies) {
      e.update(dt, player, onEnemyShoot);
    }
    checkRoundState();
  }

  // ---- 拖尾 / 粒子
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    const a = Math.max(0, t.life / t.maxLife);
    if (t.mesh.material) t.mesh.material.opacity = a * (t.gravity ? 0.9 : 0.75);
    if (t.gravity) {
      t.vel.y -= 18 * dt;
      t.mesh.position.addScaledVector(t.vel, dt);
    }
    if (t.life <= 0) {
      scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
      tracers.splice(i, 1);
    }
  }

  // ---- 弹孔渐隐
  for (let i = impactMarks.length - 1; i >= 0; i--) {
    const m = impactMarks[i];
    m.life -= dt;
    if (m.life < 1.5) m.mesh.material.opacity = Math.max(0, m.life / 1.5) * 0.85;
    if (m.life <= 0) {
      scene.remove(m.mesh);
      m.mesh.geometry.dispose();
      m.mesh.material.dispose();
      impactMarks.splice(i, 1);
    }
  }

  updateMuzzle(dt);

  // ---- HUD
  updateVitals(player, weapon);
  updateCrosshair(player, weapon, dt);
  updateHitmarker(dt);
  updateDamageFlash(dt);
  drawMinimap(player, enemies, colliders);

  // 太阳跟随玩家，保证阴影范围
  sunFollow();

  renderer.render(scene, camera);
}

function sunFollow() {
  // 让阳光目标跟随玩家，保持阴影贴图集中在玩家周围
  const p = player.position;
  const sunLight = scene.children.find((c) => c.isDirectionalLight);
  if (sunLight) {
    sunLight.position.set(p.x + 45, 70, p.z + 30);
    sunLight.target.position.set(p.x, 0, p.z);
    sunLight.target.updateMatrixWorld();
  }
}

// ------------------------------------------------------------------ 启动

document.getElementById('timer').textContent = '点击开始进入战场';

drawMinimap(player, [], colliders);
updateVitals(player, weapon);
updateScore();
animate();

// 暴露到全局便于调试
window.__game = { player, enemies, state, weapon: () => weapon };
