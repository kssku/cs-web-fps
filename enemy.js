import * as THREE from 'three';
import { GRAVITY, colliders } from './map.js';

/* =========================================================================
   AI 敌人 — 有限状态机：巡逻 / 警戒 / 追击 / 攻击 / 死亡
   带视线检测（LOS）、简易绕障、命中判定
   ========================================================================= */

export const ENEMY_STATE = {
  PATROL: 'patrol',
  ALERT: 'alert',
  CHASE: 'chase',
  ATTACK: 'attack',
  DEAD: 'dead',
};

const ENEMY_CFG = {
  hp: 100,
  speed: 3.4,
  chaseSpeed: 4.6,
  radius: 0.45,
  height: 1.8,
  sightRange: 48,
  attackRange: 34,
  damage: 11,
  fireInterval: 0.42,
  burstMin: 2,
  burstMax: 4,
  burstPause: 0.75,
  accuracy: 0.72,
  reactTime: 0.28,
};

export { ENEMY_CFG };

let enemyIdCounter = 0;

function buildEnemyMesh() {
  const g = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc07840, roughness: 0.8 });
  const vestMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.7 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xd9a878, roughness: 0.75 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.85 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.4, metalness: 0.6 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.36), bodyMat);
  torso.position.y = 1.24;
  torso.castShadow = true;
  torso.userData.hitZone = 'body';
  g.add(torso);

  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.44, 0.40), vestMat);
  vest.position.y = 1.30;
  vest.castShadow = true;
  vest.userData.hitZone = 'body';
  g.add(vest);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.30, 0.30), headMat);
  head.position.y = 1.76;
  head.castShadow = true;
  head.userData.hitZone = 'head';
  g.add(head);

  const helm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.34), vestMat);
  helm.position.y = 1.90;
  helm.castShadow = true;
  helm.userData.hitZone = 'head';
  g.add(helm);

  const legGeo = new THREE.BoxGeometry(0.22, 0.86, 0.24);
  const legL = new THREE.Mesh(legGeo, legMat);
  legL.position.set(-0.17, 0.43, 0);
  legL.castShadow = true;
  legL.userData.hitZone = 'leg';
  g.add(legL);

  const legR = new THREE.Mesh(legGeo, legMat);
  legR.position.set(0.17, 0.43, 0);
  legR.castShadow = true;
  legR.userData.hitZone = 'leg';
  g.add(legR);

  const armGeo = new THREE.BoxGeometry(0.17, 0.62, 0.17);
  const armL = new THREE.Mesh(armGeo, bodyMat);
  armL.position.set(-0.40, 1.32, 0);
  armL.castShadow = true;
  armL.userData.hitZone = 'body';
  g.add(armL);

  const armR = new THREE.Mesh(armGeo, bodyMat);
  armR.position.set(0.40, 1.32, 0);
  armR.castShadow = true;
  armR.userData.hitZone = 'body';
  g.add(armR);

  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.72), gunMat);
  gun.position.set(0.34, 1.30, -0.42);
  gun.castShadow = true;
  gun.userData.hitZone = 'body';
  g.add(gun);

  g.userData.legL = legL;
  g.userData.legR = legR;
  g.userData.parts = [torso, vest, head, helm, legL, legR, armL, armR, gun];
  return g;
}

export class Enemy {
  constructor(position, patrolPoints) {
    this.id = ++enemyIdCounter;
    this.mesh = buildEnemyMesh();
    this.mesh.position.copy(position);
    this.mesh.position.y = 0;

    this.position = this.mesh.position;
    this.velocity = new THREE.Vector3();
    this.onGround = true;

    this.hp = ENEMY_CFG.hp;
    this.maxHp = ENEMY_CFG.hp;
    this.alive = true;
    this.state = ENEMY_STATE.PATROL;

    this.patrolPoints = patrolPoints && patrolPoints.length ? patrolPoints : [position.clone()];
    this.patrolIndex = 0;
    this.waitTimer = 0;

    this.target = null;
    this.lastSeenPos = null;
    this.stateTimer = 0;
    this.reactTimer = 0;

    this.fireTimer = 0;
    this.burstLeft = 0;
    this.burstPauseTimer = 0;

    this.deathTimer = 0;
    this.hitFlash = 0;
    this.yaw = Math.random() * Math.PI * 2;

    this.strafeDir = Math.random() > 0.5 ? 1 : -1;
    this.strafeTimer = 0;
    this.stuckTimer = 0;
    this.lastPos = this.position.clone();

    this._emissiveApplied = false;
  }

  get eyePosition() {
    return new THREE.Vector3(this.position.x, this.position.y + 1.62, this.position.z);
  }

  hasLineOfSight(targetPos) {
    const origin = this.eyePosition;
    const dir = new THREE.Vector3().subVectors(targetPos, origin);
    const dist = dir.length();
    if (dist < 0.001) return true;
    dir.divideScalar(dist);

    for (const c of colliders) {
      if (c.max.y < 0.65) continue;
      const t = rayAABB(origin, dir, c, dist);
      if (t !== null && t < dist - 0.35) return false;
    }
    return true;
  }

  update(dt, player, onShoot) {
    if (!this.alive) {
      this.deathTimer += dt;
      if (this.mesh.rotation.x > -Math.PI / 2) {
        this.mesh.rotation.x = Math.max(-Math.PI / 2, this.mesh.rotation.x - dt * 3.2);
        this.mesh.position.y = Math.max(0.25, this.mesh.position.y - dt * 0.9);
      }
      return;
    }

    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      if (this.hitFlash <= 0) this.clearEmissive();
    }

    this.stateTimer += dt;
    this.target = player;

    const toPlayer = new THREE.Vector3().subVectors(player.eyePosition, this.eyePosition);
    const distToPlayer = toPlayer.length();
    const canSee = player.alive && distToPlayer < ENEMY_CFG.sightRange && this.hasLineOfSight(player.eyePosition);

    const shouldFacePlayer = canSee || this.state === ENEMY_STATE.CHASE || this.state === ENEMY_STATE.ATTACK;

    switch (this.state) {
      case ENEMY_STATE.PATROL:
        if (canSee) this.enterAlert();
        else this.doPatrol(dt);
        break;

      case ENEMY_STATE.ALERT:
        if (canSee) {
          this.reactTimer -= dt;
          if (this.reactTimer <= 0) this.enterChase();
        } else if (this.stateTimer > 2.2) {
          this.enterPatrol();
        }
        break;

      case ENEMY_STATE.CHASE:
        if (canSee) {
          this.lastSeenPos = player.position.clone();
          if (distToPlayer <= ENEMY_CFG.attackRange) this.enterAttack();
          else this.moveToward(player.position, ENEMY_CFG.chaseSpeed, dt, true);
        } else {
          if (this.lastSeenPos) {
            const d = this.position.distanceTo(this.lastSeenPos);
            if (d < 1.6) this.enterPatrol();
            else this.moveToward(this.lastSeenPos, ENEMY_CFG.chaseSpeed, dt, true);
          } else {
            this.enterPatrol();
          }
          if (this.stateTimer > 9) this.enterPatrol();
        }
        break;

      case ENEMY_STATE.ATTACK:
        if (!canSee) this.enterChase();
        else this.doAttack(dt, player, distToPlayer, onShoot);
        break;
    }

    if (shouldFacePlayer) {
      const desiredYaw = Math.atan2(toPlayer.x, toPlayer.z);
      this.yaw = lerpAngle(this.yaw, desiredYaw, Math.min(1, dt * 9));
    } else if (this.state === ENEMY_STATE.PATROL) {
      const tp = this.currentPatrolTarget();
      if (tp) {
        const d = new THREE.Vector3().subVectors(tp, this.position);
        if (d.lengthSq() > 0.04) {
          this.yaw = lerpAngle(this.yaw, Math.atan2(d.x, d.z), Math.min(1, dt * 6));
        }
      }
    }
    this.mesh.rotation.y = this.yaw;

    this.velocity.y -= GRAVITY * dt;
    this.onGround = false;
    this.moveAxis('x', this.velocity.x * dt);
    this.moveAxis('z', this.velocity.z * dt);
    this.moveAxis('y', this.velocity.y * dt);

    this.stuckTimer += dt;
    if (this.stuckTimer > 0.8) {
      const moved = this.position.distanceTo(this.lastPos);
      if (moved < 0.25 && this.state === ENEMY_STATE.CHASE) {
        this.strafeDir *= -1;
        this.strafeTimer = 0.9;
      }
      this.lastPos.copy(this.position);
      this.stuckTimer = 0;
    }

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const swing = Math.sin(performance.now() * 0.011) * Math.min(0.5, speed * 0.14);
    if (this.mesh.userData.legL) {
      this.mesh.userData.legL.rotation.x = swing;
      this.mesh.userData.legR.rotation.x = -swing;
    }
  }

  currentPatrolTarget() {
    return this.patrolPoints[this.patrolIndex] || null;
  }

  doPatrol(dt) {
    const tp = this.currentPatrolTarget();
    if (!tp) return;
    if (this.waitTimer > 0) {
      this.waitTimer -= dt;
      this.velocity.x *= Math.max(0, 1 - 10 * dt);
      this.velocity.z *= Math.max(0, 1 - 10 * dt);
      return;
    }
    if (this.position.distanceTo(tp) < 1.4) {
      this.patrolIndex = (this.patrolIndex + 1) % this.patrolPoints.length;
      this.waitTimer = 0.6 + Math.random() * 1.4;
    } else {
      this.moveToward(tp, ENEMY_CFG.speed, dt, false);
    }
  }

  enterPatrol() {
    this.state = ENEMY_STATE.PATROL;
    this.stateTimer = 0;
    this.lastSeenPos = null;
    this.fireTimer = 0;
    this.burstLeft = 0;
    this.burstPauseTimer = 0;
  }

  enterAlert() {
    if (this.state === ENEMY_STATE.ALERT) return;
    this.state = ENEMY_STATE.ALERT;
    this.stateTimer = 0;
    this.reactTimer = ENEMY_CFG.reactTime;
    this.velocity.x *= 0.2;
    this.velocity.z *= 0.2;
  }

  enterChase() {
    this.state = ENEMY_STATE.CHASE;
    this.stateTimer = 0;
    this.burstPauseTimer = 0;
  }

  enterAttack() {
    if (this.state !== ENEMY_STATE.ATTACK) {
      this.state = ENEMY_STATE.ATTACK;
      this.stateTimer = 0;
      this.fireTimer = 0.12;
      this.burstLeft = 0;
      this.burstPauseTimer = 0;
    }
  }

  doAttack(dt, player, distToPlayer, onShoot) {
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeDir *= Math.random() > 0.35 ? 1 : -1;
      this.strafeTimer = 0.7 + Math.random() * 1.1;
    }

    const toP = new THREE.Vector3().subVectors(player.position, this.position);
    toP.y = 0;
    const len = toP.length() || 1;
    toP.divideScalar(len);
    const side = new THREE.Vector3(-toP.z, 0, toP.x).multiplyScalar(this.strafeDir);

    let forward;
    if (distToPlayer < 9) forward = -0.75;
    else if (distToPlayer > 24) forward = 0.8;
    else forward = 0.12;

    const wish = new THREE.Vector3()
      .addScaledVector(toP, forward)
      .addScaledVector(side, 0.72)
      .normalize();

    const spd = ENEMY_CFG.speed * 0.85;
    const k = Math.min(1, dt * 9);
    this.velocity.x += (wish.x * spd - this.velocity.x) * k;
    this.velocity.z += (wish.z * spd - this.velocity.z) * k;

    this.fireTimer -= dt;
    if (this.burstPauseTimer > 0) {
      this.burstPauseTimer -= dt;
      return;
    }

    if (this.fireTimer <= 0) {
      if (this.burstLeft <= 0) {
        this.burstLeft = ENEMY_CFG.burstMin + Math.floor(Math.random() * (ENEMY_CFG.burstMax - ENEMY_CFG.burstMin + 1));
      }
      this.fireAtPlayer(player, distToPlayer, onShoot);
      this.burstLeft--;
      this.fireTimer = ENEMY_CFG.fireInterval;
      if (this.burstLeft <= 0) {
        this.burstPauseTimer = ENEMY_CFG.burstPause * (0.7 + Math.random() * 0.8);
      }
    }
  }

  fireAtPlayer(player, dist, onShoot) {
    const playerMoving = Math.hypot(player.velocity.x, player.velocity.z) > 1.2;
    let acc = ENEMY_CFG.accuracy;
    acc *= 1 - Math.min(0.45, dist / 90);
    if (playerMoving) acc *= 0.78;
    if (player.crouching) acc *= 0.94;

    const hit = Math.random() < acc;
    const origin = this.eyePosition;
    const aim = player.eyePosition.clone();

    if (!hit) {
      const off = 0.55 + Math.random() * 1.1;
      const a = Math.random() * Math.PI * 2;
      aim.x += Math.cos(a) * off;
      aim.y += (Math.random() - 0.4) * off;
      aim.z += Math.sin(a) * off;
    }

    if (onShoot) onShoot(origin, aim, hit, this);
  }

  moveToward(targetPos, speed, dt, isChase) {
    const dir = new THREE.Vector3().subVectors(targetPos, this.position);
    dir.y = 0;
    const dist = dir.length();
    if (dist < 0.001) return;
    dir.divideScalar(dist);

    const probeDist = 2.0;
    const probe = new THREE.Vector3(
      this.position.x + dir.x * probeDist,
      this.position.y + 0.9,
      this.position.z + dir.z * probeDist
    );

    if (this.pointBlocked(probe)) {
      const left = new THREE.Vector3(-dir.z, 0, dir.x);
      const right = new THREE.Vector3(dir.z, 0, -dir.x);
      const lp = new THREE.Vector3(this.position.x + left.x * probeDist, this.position.y + 0.9, this.position.z + left.z * probeDist);
      const rp = new THREE.Vector3(this.position.x + right.x * probeDist, this.position.y + 0.9, this.position.z + right.z * probeDist);
      const lBlocked = this.pointBlocked(lp);
      const rBlocked = this.pointBlocked(rp);
      if (lBlocked && !rBlocked) dir.copy(right).normalize();
      else if (!lBlocked && rBlocked) dir.copy(left).normalize();
      else dir.copy(this.strafeDir > 0 ? left : right).normalize();
    }

    if (isChase) {
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeDir *= -1;
        this.strafeTimer = 1.0 + Math.random() * 1.2;
      }
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(this.strafeDir * 0.25);
      dir.add(side).normalize();
    }

    const k = Math.min(1, dt * 7);
    this.velocity.x += (dir.x * speed - this.velocity.x) * k;
    this.velocity.z += (dir.z * speed - this.velocity.z) * k;
  }

  pointBlocked(p) {
    const r = ENEMY_CFG.radius;
    for (const c of colliders) {
      if (p.x + r > c.min.x && p.x - r < c.max.x &&
          p.y > c.min.y && p.y < c.max.y &&
          p.z + r > c.min.z && p.z - r < c.max.z) return true;
    }
    return false;
  }

  moveAxis(axis, delta) {
    if (delta === 0) return;
    const p = this.position;
    p[axis] += delta;
    const r = ENEMY_CFG.radius;
    const h = ENEMY_CFG.height;
    const minX = p.x - r, maxX = p.x + r;
    const minY = p.y, maxY = p.y + h;
    const minZ = p.z - r, maxZ = p.z + r;

    for (const c of colliders) {
      if (!(minX < c.max.x && maxX > c.min.x &&
            minY < c.max.y && maxY > c.min.y &&
            minZ < c.max.z && maxZ > c.min.z)) continue;

      if (axis === 'y') {
        if (delta > 0) {
          p.y = c.min.y - h - 0.001;
        } else {
          p.y = c.max.y;
          if (this.velocity.y < 0) this.velocity.y = 0;
          this.onGround = true;
        }
      } else if (axis === 'x') {
        p.x = delta > 0 ? c.min.x - r - 0.001 : c.max.x + r + 0.001;
        this.velocity.x = 0;
      } else {
        p.z = delta > 0 ? c.min.z - r - 0.001 : c.max.z + r + 0.001;
        this.velocity.z = 0;
      }
    }
  }

  setHitFlash() {
    for (const o of this.mesh.userData.parts) {
      if (o.material && o.material.emissive) {
        o.material.emissive.setHex(0xff2222);
        o.material.emissiveIntensity = 0.6;
      }
    }
  }

  clearEmissive() {
    for (const o of this.mesh.userData.parts) {
      if (o.material && o.material.emissive) {
        o.material.emissive.setHex(0x000000);
        o.material.emissiveIntensity = 1;
      }
    }
  }

  takeDamage(baseDamage, zone) {
    if (!this.alive) return { killed: false, damage: 0, zone };
    let dmg = baseDamage;
    if (zone === 'head') dmg *= 4.0;
    else if (zone === 'leg') dmg *= 0.75;
    dmg = Math.round(dmg);
    this.hp -= dmg;

    this.hitFlash = 0.08;
    this.setHitFlash();

    if (this.state === ENEMY_STATE.PATROL) {
      this.enterAlert();
      this.reactTimer = 0.05;
    }

    if (this.hp <= 0) {
      this.alive = false;
      this.state = ENEMY_STATE.DEAD;
      this.velocity.set(0, 0, 0);
      this.clearEmissive();
      return { killed: true, damage: dmg, zone };
    }
    return { killed: false, damage: dmg, zone };
  }

  hearGunshot(sourcePos) {
    if (!this.alive) return;
    if (this.state === ENEMY_STATE.CHASE || this.state === ENEMY_STATE.ATTACK) return;
    const d = this.position.distanceTo(sourcePos);
    if (d < 26) {
      this.lastSeenPos = sourcePos.clone();
      if (this.state === ENEMY_STATE.PATROL) this.enterChase();
    }
  }
}

/* ---------------------------------------------------------------- 工具 */

function rayAABB(origin, dir, box, maxDist) {
  let tmin = 0, tmax = maxDist;
  for (const ax of ['x', 'y', 'z']) {
    const o = origin[ax], d = dir[ax];
    const mn = box.min[ax], mx = box.max[ax];
    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return null;
    } else {
      const inv = 1 / d;
      let t1 = (mn - o) * inv;
      let t2 = (mx - o) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

export function rayAABBPublic(origin, dir, box, maxDist) {
  return rayAABB(origin, dir, box, maxDist);
}

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
