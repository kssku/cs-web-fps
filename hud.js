import { MAP_SIZE, state } from './map.js';

/* =========================================================================
   HUD — 血量/弹药、小地图雷达、计分板、击杀提示
   ========================================================================= */

const el = (id) => document.getElementById(id);

const ui = {
  hp: el('hp'),
  armor: el('armor'),
  ammo: el('ammo'),
  ammoReserve: el('ammo-reserve'),
  weaponName: el('weapon-name'),
  scoreCT: el('score-ct'),
  scoreT: el('score-t'),
  timer: el('timer'),
  killfeed: el('killfeed'),
  reloadHint: el('reload-hint'),
  damageFlash: el('damage-flash'),
  hitmarker: el('hitmarker'),
  hitDir: el('hit-dir'),
  crosshair: el('crosshair'),
  chT: el('ch-t'), chB: el('ch-b'), chL: el('ch-l'), chR: el('ch-r'),
};

const minimap = el('minimap');
const mmCtx = minimap.getContext('2d');
const MM_SIZE = minimap.width;      // 380
const MM_RANGE = 46;                // 雷达显示半径（世界单位）

// 准星散布动画
let crosshairSpread = 0;
let hitmarkerTimer = 0;
let damageFlashTimer = 0;

/* ---------------------------------------------------------- 数值更新 */

export function updateVitals(player, weapon) {
  ui.hp.textContent = Math.max(0, Math.round(player.hp));
  ui.hp.classList.toggle('low', player.hp <= 30);
  ui.armor.textContent = Math.max(0, Math.round(player.armor));

  ui.ammo.textContent = weapon.ammo;
  ui.ammoReserve.textContent = '/ ' + weapon.reserve;
  ui.weaponName.textContent = weapon.def.name;

  // 低弹药变红
  ui.ammo.style.color = weapon.ammo === 0 ? '#ff4d4d' : (weapon.ammo <= 5 ? '#ffcf6a' : '#fff');

  // 换弹提示
  if (weapon.reloading) {
    ui.reloadHint.textContent = '换弹中…';
    ui.reloadHint.style.opacity = '1';
  } else if (weapon.ammo === 0 && weapon.reserve > 0) {
    ui.reloadHint.textContent = '按 R 换弹';
    ui.reloadHint.style.opacity = '1';
  } else {
    ui.reloadHint.style.opacity = '0';
  }
}

export function updateScore() {
  ui.scoreCT.textContent = state.scoreCT;
  ui.scoreT.textContent = state.scoreT;
}

/* ---------------------------------------------------------- 准星 */

/**
 * 根据移动/射击状态动态撑开准星（CS 手感）
 */
export function updateCrosshair(player, weapon, dt) {
  const moving = player.isMoving && player.onGround;
  let target = 0;
  if (moving) target += 7;
  if (!player.onGround) target += 11;
  if (weapon.reloading) target += 5;
  // 连发累积
  target += Math.min(9, weapon.shotCount * 0.9);

  crosshairSpread += (target - crosshairSpread) * Math.min(1, dt * 12);

  const s = crosshairSpread;
  const base = 4;
  ui.chT.style.top = (-base - s - 8) + 'px';
  ui.chB.style.top = (base + s - 2) + 'px';
  ui.chL.style.left = (-base - s - 8) + 'px';
  ui.chR.style.left = (base + s - 2) + 'px';
}

/* ---------------------------------------------------------- 命中反馈 */

export function showHitmarker(killed) {
  hitmarkerTimer = killed ? 0.32 : 0.16;
  ui.hitmarker.style.opacity = '1';
  const bars = ui.hitmarker.querySelectorAll('div');
  bars.forEach((b) => {
    b.style.background = killed ? '#ff4444' : '#ffffff';
    b.style.width = killed ? '13px' : '10px';
  });
}

export function updateHitmarker(dt) {
  if (hitmarkerTimer > 0) {
    hitmarkerTimer -= dt;
    if (hitmarkerTimer <= 0) ui.hitmarker.style.opacity = '0';
  }
}

/** 受伤红屏 */
export function flashDamage(intensity = 1) {
  damageFlashTimer = 0.4;
  ui.damageFlash.style.opacity = String(Math.min(1, 0.35 + intensity * 0.5));
}

export function updateDamageFlash(dt) {
  if (damageFlashTimer > 0) {
    damageFlashTimer -= dt;
    if (damageFlashTimer <= 0) ui.damageFlash.style.opacity = '0';
  }
}

/** 显示子弹来向指示箭头 */
export function showHitDirection(originX, originZ, playerX, playerZ, playerYaw) {
  const dx = originX - playerX;
  const dz = originZ - playerZ;
  // 世界方向 → 相对于玩家朝向的角度
  const worldAngle = Math.atan2(dx, dz);
  const rel = worldAngle - playerYaw;
  const deg = (rel * 180) / Math.PI;

  const arrow = document.createElement('div');
  arrow.className = 'hit-arrow';
  arrow.textContent = '➤';
  const rad = (deg - 90) * (Math.PI / 180);
  const R = 150;
  arrow.style.transform = `translate(${Math.cos(rad) * R}px, ${Math.sin(rad) * R}px) rotate(${deg}deg)`;
  arrow.style.transformOrigin = 'center';
  ui.hitDir.appendChild(arrow);
  arrow.animate(
    [{ opacity: 0.9 }, { opacity: 0 }],
    { duration: 900, easing: 'ease-out' }
  ).onfinish = () => arrow.remove();
}

/* ---------------------------------------------------------- 击杀提示 */

export function addKillFeed(killer, victim, isHeadshot, killerIsPlayer) {
  const div = document.createElement('div');
  const kClass = killerIsPlayer ? 'k' : 'v';
  const vClass = killerIsPlayer ? 'v' : 'k';
  div.innerHTML = `<span class="${kClass}">${killer}</span> ${isHeadshot ? '💀 ' : '✚ '}<span class="${vClass}">${victim}</span>`;
  ui.killfeed.appendChild(div);
  setTimeout(() => {
    div.style.transition = 'opacity .5s';
    div.style.opacity = '0';
    setTimeout(() => div.remove(), 500);
  }, 4200);

  // 最多保留 5 条
  while (ui.killfeed.children.length > 5) ui.killfeed.removeChild(ui.killfeed.firstChild);
}

/* ---------------------------------------------------------- 小地图雷达 */

/**
 * 绘制雷达：以玩家为中心，显示墙体、敌人（仅可见/附近）、朝向
 */
export function drawMinimap(player, enemies, colliders) {
  const S = MM_SIZE;
  const scale = (S / 2) / MM_RANGE;   // 世界单位 → 像素
  const cx = S / 2;
  const cy = S / 2;

  mmCtx.clearRect(0, 0, S, S);

  // 背景
  mmCtx.fillStyle = 'rgba(10,18,14,0.85)';
  mmCtx.fillRect(0, 0, S, S);

  mmCtx.save();
  mmCtx.translate(cx, cy);
  // 让雷达跟随玩家朝向旋转（CS 风格：始终朝上）
  mmCtx.rotate(player.yaw);

  const px = player.position.x;
  const pz = player.position.z;

  // ---- 地图边界
  const half = MAP_SIZE / 2;
  mmCtx.strokeStyle = 'rgba(53,255,106,0.5)';
  mmCtx.lineWidth = 2;
  mmCtx.strokeRect(
    (-half - px) * scale,
    (-half - pz) * scale,
    MAP_SIZE * scale,
    MAP_SIZE * scale
  );

  // ---- 碰撞体（墙体/箱子）
  mmCtx.fillStyle = 'rgba(120,150,130,0.42)';
  for (const c of colliders) {
    if (c.max.y < 0.4) continue;
    const wx = (c.min.x + c.max.x) / 2 - px;
    const wz = (c.min.z + c.max.z) / 2 - pz;
    // 视锥外裁剪
    const dist = Math.hypot(wx, wz);
    if (dist > MM_RANGE + 8) continue;
    const w = (c.max.x - c.min.x) * scale;
    const h = (c.max.z - c.min.z) * scale;
    mmCtx.fillRect(wx * scale - w / 2, wz * scale - h / 2, w, h);
  }

  // ---- 敌人
  for (const e of enemies) {
    if (!e.alive) continue;
    const wx = e.position.x - px;
    const wz = e.position.z - pz;
    const dist = Math.hypot(wx, wz);
    if (dist > MM_RANGE) continue;

    // 是否在玩家视野内（用雷达旋转后的坐标判断更简单：只判断距离与视线）
    const visible = e.state === 'attack' || e.state === 'chase' || dist < 22;
    mmCtx.fillStyle = visible ? '#ff4d4d' : 'rgba(255,120,120,0.35)';
    mmCtx.beginPath();
    mmCtx.arc(wx * scale, wz * scale, visible ? 5.5 : 4, 0, Math.PI * 2);
    mmCtx.fill();

    // 敌人朝向短线
    if (visible) {
      mmCtx.strokeStyle = '#ff8080';
      mmCtx.lineWidth = 2;
      mmCtx.beginPath();
      mmCtx.moveTo(wx * scale, wz * scale);
      mmCtx.lineTo(
        wx * scale + Math.sin(e.yaw) * 9,
        wz * scale + Math.cos(e.yaw) * 9
      );
      mmCtx.stroke();
    }
  }

  mmCtx.restore();

  // ---- 玩家（固定在中心，朝上）
  mmCtx.save();
  mmCtx.translate(cx, cy);
  mmCtx.fillStyle = '#35ff6a';
  mmCtx.beginPath();
  mmCtx.moveTo(0, -9);
  mmCtx.lineTo(-6.5, 7);
  mmCtx.lineTo(0, 4);
  mmCtx.lineTo(6.5, 7);
  mmCtx.closePath();
  mmCtx.fill();

  // 视野扇形
  const grad = mmCtx.createRadialGradient(0, 0, 0, 0, 0, 70);
  grad.addColorStop(0, 'rgba(53,255,106,0.22)');
  grad.addColorStop(1, 'rgba(53,255,106,0)');
  mmCtx.fillStyle = grad;
  mmCtx.beginPath();
  mmCtx.moveTo(0, 0);
  mmCtx.arc(0, 0, 70, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
  mmCtx.closePath();
  mmCtx.fill();
  mmCtx.restore();

  // ---- 雷达边框刻度
  mmCtx.strokeStyle = 'rgba(53,255,106,0.25)';
  mmCtx.lineWidth = 1;
  mmCtx.beginPath();
  mmCtx.moveTo(cx, 0); mmCtx.lineTo(cx, 12);
  mmCtx.moveTo(cx, S); mmCtx.lineTo(cx, S - 12);
  mmCtx.moveTo(0, cy); mmCtx.lineTo(12, cy);
  mmCtx.moveTo(S, cy); mmCtx.lineTo(S - 12, cy);
  mmCtx.stroke();
}

/* ---------------------------------------------------------- 计分板 */

let scoreboardEl = null;

export function toggleScoreboard(show) {
  if (!scoreboardEl) {
    scoreboardEl = document.createElement('div');
    scoreboardEl.id = 'scoreboard';
    scoreboardEl.style.cssText = `
      position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
      background:rgba(6,12,9,.93); border:1px solid rgba(53,255,106,.4);
      border-radius:6px; padding:24px 34px; z-index:20; pointer-events:none;
      font-size:15px; min-width:400px;
    `;
    document.getElementById('hud').appendChild(scoreboardEl);
  }
  if (!show) {
    scoreboardEl.style.display = 'none';
    return;
  }
  scoreboardEl.style.display = 'block';

  const aliveEnemies = document.querySelectorAll('canvas'); // 占位，实际由参数传入
  scoreboardEl.innerHTML = `
    <div style="text-align:center;font-size:19px;letter-spacing:3px;color:#35ff6a;margin-bottom:16px">计 分 板</div>
    <table style="width:100%;border-collapse:collapse">
      <tr style="color:#8a9;font-size:12px;letter-spacing:1px">
        <td style="padding:6px 0">队伍</td>
        <td style="text-align:center">击杀</td>
        <td style="text-align:center">回合分</td>
      </tr>
      <tr style="border-top:1px solid #2a3a30">
        <td style="padding:9px 0;color:#7ec8ff">CT（你）</td>
        <td style="text-align:center;color:#fff;font-weight:700">${state.playerKills}</td>
        <td style="text-align:center;color:#7ec8ff;font-weight:700">${state.scoreCT}</td>
      </tr>
      <tr style="border-top:1px solid #2a3a30">
        <td style="padding:9px 0;color:#ffcf6a">T（敌人）</td>
        <td style="text-align:center;color:#fff;font-weight:700">${state.enemyKills || 0}</td>
        <td style="text-align:center;color:#ffcf6a;font-weight:700">${state.scoreT}</td>
      </tr>
    </table>
    <div style="margin-top:14px;font-size:12px;color:#8a9;text-align:center">
      存活敌人：<b style="color:#ff8080">${state.enemiesAlive}</b>
      &nbsp;·&nbsp; 回合 <b style="color:#fff">${state.round}</b>
      &nbsp;·&nbsp; 死亡 <b style="color:#fff">${state.playerDeaths}</b>
    </div>
  `;
}

export { ui };
