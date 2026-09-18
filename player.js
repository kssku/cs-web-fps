import * as THREE from 'three';
import {
  PLAYER_EYE, PLAYER_CROUCH_EYE, PLAYER_RADIUS, GRAVITY, JUMP_SPEED,
  WALK_SPEED, RUN_SPEED, CROUCH_SPEED, AIR_ACCEL, GROUND_ACCEL,
  GROUND_FRICTION, MOUSE_SENS, MAX_PITCH,
} from './map.js';

/* =========================================================================
   玩家控制器 — 移动、碰撞、视角、蹲伏、后坐力应用
   ========================================================================= */

export class Player {
  constructor(camera, colliders) {
    this.camera = camera;
    this.colliders = colliders;

    this.position = new THREE.Vector3(0, 0, 0); // 脚底位置
    this.velocity = new THREE.Vector3();
    this.onGround = false;

    this.yaw = 0;
    this.pitch = 0;

    this.hp = 100;
    this.armor = 100;
    this.alive = true;

    this.crouching = false;
    this.walking = false;   // Shift 静步
    this.eyeHeight = PLAYER_EYE;
    this.bobPhase = 0;
    this.bobAmount = 0;

    // 后坐力偏移（由武器系统写入）
    this.recoilPitch = 0;
    this.recoilYaw = 0;

    this.height = 1.8;
    this.crouchHeight = 1.2;
  }

  spawn(pos) {
    this.position.copy(pos);
    this.position.y = 0;
    this.velocity.set(0, 0, 0);
    this.hp = 100;
    this.armor = 100;
    this.alive = true;
    this.yaw = Math.atan2(-pos.x, -pos.z);
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
  }

  get currentHeight() {
    return this.crouching ? this.crouchHeight : this.height;
  }

  /** 眼睛世界坐标 */
  get eyePosition() {
    const h = this.crouching ? PLAYER_CROUCH_EYE : PLAYER_EYE;
    return new THREE.Vector3(
      this.position.x,
      this.position.y + h + this.bobAmount,
      this.position.z
    );
  }

  /** 视线方向（含后坐力偏移） */
  getLookDirection() {
    const dir = new THREE.Vector3(0, 0, -1);
    const euler = new THREE.Euler(
      this.pitch + this.recoilPitch,
      this.yaw + this.recoilYaw,
      0,
      'YXZ'
    );
    dir.applyEuler(euler);
    return dir.normalize();
  }

  handleMouse(dx, dy) {
    if (!this.alive) return;
    this.yaw -= dx * MOUSE_SENS;
    this.pitch -= dy * MOUSE_SENS;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
  }

  /** 由键盘输入驱动的水平移动 */
  update(dt, keys, sprintAllowed) {
    if (!this.alive) return;

    // ---- 蹲伏
    const wantCrouch = keys.ctrl;
    if (wantCrouch !== this.crouching) {
      // 起身需要检查头顶空间
      if (!wantCrouch) {
        if (!this.blockedAbove()) this.crouching = false;
      } else {
        this.crouching = true;
      }
    }
    this.walking = keys.shift;

    // ---- 期望移动方向（相机相对）
    let fx = 0, fz = 0;
    if (keys.w) fz -= 1;
    if (keys.s) fz += 1;
    if (keys.a) fx -= 1;
    if (keys.d) fx += 1;
    const hasInput = fx !== 0 || fz !== 0;
    if (hasInput) {
      const len = Math.hypot(fx, fz);
      fx /= len; fz /= len;
    }

    // 将输入旋转到世界坐标（相机朝 -Z，yaw 绕 Y 轴）
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = fx * cos + fz * sin;
    const wz = -fx * sin + fz * cos;

    // ---- 目标速度
    let speed = RUN_SPEED;
    if (this.crouching) speed = CROUCH_SPEED;
    else if (this.walking) speed = WALK_SPEED;
    else if (!sprintAllowed) speed = WALK_SPEED;

    const wishX = wx * speed;
    const wishZ = wz * speed;

    // ---- 加速 / 摩擦
    if (this.onGround) {
      const accel = GROUND_ACCEL * dt;
      this.velocity.x += (wishX - this.velocity.x) * Math.min(1, accel / speed * 1.6);
      this.velocity.z += (wishZ - this.velocity.z) * Math.min(1, accel / speed * 1.6);
      if (!hasInput) {
        const f = Math.max(0, 1 - GROUND_FRICTION * dt);
        this.velocity.x *= f;
        this.velocity.z *= f;
        if (Math.abs(this.velocity.x) < 0.02) this.velocity.x = 0;
        if (Math.abs(this.velocity.z) < 0.02) this.velocity.z = 0;
      }
    } else {
      // 空中控制受限
      const accel = AIR_ACCEL * dt;
      this.velocity.x += (wishX - this.velocity.x) * accel;
      this.velocity.z += (wishZ - this.velocity.z) * accel;
    }

    // ---- 跳跃
    if (keys.space && this.onGround) {
      this.velocity.y = JUMP_SPEED;
      this.onGround = false;
    }

    // ---- 重力
    this.velocity.y -= GRAVITY * dt;
    if (this.velocity.y < -55) this.velocity.y = -55;

    // ---- 分轴移动 + 碰撞解算
    this.moveAxis('x', this.velocity.x * dt);
    this.moveAxis('z', this.velocity.z * dt);
    this.moveAxis('y', this.velocity.y * dt);

    // ---- 头部晃动
    const hspeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.onGround && hspeed > 0.4) {
      this.bobPhase += dt * hspeed * 2.3;
      const target = Math.sin(this.bobPhase) * 0.032 * Math.min(1, hspeed / RUN_SPEED);
      this.bobAmount += (target - this.bobAmount) * Math.min(1, dt * 12);
    } else {
      this.bobAmount += (0 - this.bobAmount) * Math.min(1, dt * 10);
    }
  }

  /** 单轴移动并处理碰撞 */
  moveAxis(axis, delta) {
    if (delta === 0) return;
    const p = this.position;
    p[axis] += delta;

    const h = this.currentHeight;
    const minX = p.x - PLAYER_RADIUS, maxX = p.x + PLAYER_RADIUS;
    const minY = p.y, maxY = p.y + h;
    const minZ = p.z - PLAYER_RADIUS, maxZ = p.z + PLAYER_RADIUS;

    for (const c of this.colliders) {
      const overlapX = minX < c.max.x && maxX > c.min.x;
      const overlapY = minY < c.max.y && maxY > c.min.y;
      const overlapZ = minZ < c.max.z && maxZ > c.min.z;
      if (!(overlapX && overlapY && overlapZ)) continue;

      if (axis === 'y') {
        if (delta > 0) {
          // 撞头
          p.y = c.min.y - h - 0.001;
        } else {
          // 落地
          p.y = c.max.y;
          if (this.velocity.y < 0) this.velocity.y = 0;
          this.onGround = true;
        }
      } else if (axis === 'x') {
        p.x = delta > 0 ? c.min.x - PLAYER_RADIUS - 0.001 : c.max.x + PLAYER_RADIUS + 0.001;
        this.velocity.x = 0;
      } else {
        p.z = delta > 0 ? c.min.z - PLAYER_RADIUS - 0.001 : c.max.z + PLAYER_RADIUS + 0.001;
        this.velocity.z = 0;
      }
    }

    // 掉出地图保护
    if (p.y < -20) {
      p.y = 5;
      this.velocity.set(0, 0, 0);
    }
  }

  /** 检测起身是否被阻挡 */
  blockedAbove() {
    const p = this.position;
    const minX = p.x - PLAYER_RADIUS, maxX = p.x + PLAYER_RADIUS;
    const minZ = p.z - PLAYER_RADIUS, maxZ = p.z + PLAYER_RADIUS;
    const minY = p.y + this.crouchHeight, maxY = p.y + this.height;
    for (const c of this.colliders) {
      if (minX < c.max.x && maxX > c.min.x &&
          minY < c.max.y && maxY > c.min.y &&
          minZ < c.max.z && maxZ > c.min.z) return true;
    }
    return false;
  }

  /** 是否在地面且几乎静止（用于判定精度） */
  get isMoving() {
    return Math.hypot(this.velocity.x, this.velocity.z) > 0.35;
  }

  /** 受伤，返回是否死亡 */
  takeDamage(amount, hasArmor) {
    if (!this.alive) return false;
    let dmg = amount;
    if (hasArmor && this.armor > 0) {
      // 护甲吸收约一半伤害
      const absorbed = dmg * 0.5;
      this.armor = Math.max(0, this.armor - absorbed * 0.9);
      dmg -= absorbed;
    }
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      return true;
    }
    return false;
  }
}
