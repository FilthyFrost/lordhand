/**
 * PROJECTILE-SYSTEM.JS — 弹丸物理与射线碰撞检测
 *
 * 职责:
 * - 管理所有飞行弹丸的生命周期
 * - 弹丸移动 + AABB碰撞检测(复用主场景colliders)
 * - 归巢弹丸的转向逻辑
 * - 每帧返回命中事件数组供impact-fx消费
 */

const THREE = window.THREE;

/**
 * @typedef {Object} ProjectileConfig
 * @property {number} speed - 弹丸速度 (units/sec)
 * @property {number} lifetime - 最大存活时间 (秒)
 * @property {number} spread - 散射角度 (弧度), 0=精准
 * @property {number} count - 一次发射数量
 * @property {boolean} homing - 是否归巢
 * @property {THREE.Vector3|null} homingTarget - 归巢目标位置
 * @property {number} homingStrength - 归巢转向力度 (0-1)
 * @property {string} type - 'dagger'|'laser_bolt'|'pulse'
 * @property {number} damage - 伤害值 (预留)
 * @property {number} size - 弹丸视觉大小
 * @property {number} color - 弹丸颜色 hex
 */

/**
 * @typedef {Object} HitResult
 * @property {THREE.Vector3} position - 命中位置
 * @property {THREE.Vector3} normal - 命中面法线
 * @property {Object} collider - 命中的collider对象
 * @property {string} projectileType - 弹丸类型
 * @property {number} speed - 命中时速度
 */

// 弹丸几何体缓存 (避免重复创建)
const _geoCache = {};

function getProjectileGeo(type) {
    if (!_geoCache[type]) {
        switch (type) {
            case 'dagger':
                // 细长菱形 - 匕首 (放大2.5x)
                _geoCache[type] = new THREE.ConeGeometry(0.12, 1.0, 4);
                _geoCache[type].rotateX(Math.PI / 2);
                break;
            case 'laser_bolt':
                // 短圆柱 - 激光弹 (放大3x)
                _geoCache[type] = new THREE.CylinderGeometry(0.08, 0.08, 1.5, 4);
                _geoCache[type].rotateX(Math.PI / 2);
                break;
            case 'pulse':
                // 球形 - 脉冲 (放大2.5x)
                _geoCache[type] = new THREE.IcosahedronGeometry(0.35, 0);
                break;
            default:
                _geoCache[type] = new THREE.BoxGeometry(0.25, 0.25, 0.8);
                break;
        }
    }
    return _geoCache[type];
}

// 材质缓存
const _matCache = {};

function getProjectileMat(color) {
    const key = color.toString(16);
    if (!_matCache[key]) {
        _matCache[key] = new THREE.MeshBasicMaterial({ color: color });
    }
    return _matCache[key];
}

export class ProjectileSystem {
    /**
     * @param {THREE.Scene} scene
     * @param {Array} colliders - 主场景的AABB碰撞体数组
     */
    constructor(scene, colliders) {
        this.scene = scene;
        this.colliders = colliders;
        this.demonRegistry = null; // 由外部设置
        this._frameColliders = colliders; // 默认值
        this.projectiles = [];

        // 每帧命中结果 (外部在update后读取)
        this.hitResults = [];

        // 对象池上限
        this.MAX_PROJECTILES = 300;

        // 临时向量 (避免GC)
        this._tempVec = new THREE.Vector3();
        this._tempDir = new THREE.Vector3();
        this._prevPos = new THREE.Vector3();
    }

    /**
     * 发射弹丸
     * @param {THREE.Vector3} origin - 发射起点
     * @param {THREE.Vector3} direction - 发射方向 (normalized)
     * @param {ProjectileConfig} config
     */
    spawn(origin, direction, config) {
        // 性能保护: 超过80个活跃弹丸时不再生成新的
        if (this.projectiles.length >= 80) return;
        const count = config.count || 1;
        const spread = config.spread || 0;
        const speed = config.speed || 80;
        const lifetime = config.lifetime || 2.0;
        const type = config.type || 'dagger';
        const size = config.size || 1.0;
        const color = config.color || 0xffffff;
        const homing = config.homing || false;
        const homingTarget = config.homingTarget || null;
        const homingStrength = config.homingStrength || 0.05;
        const damage = config.damage || 1;

        for (let i = 0; i < count; i++) {
            // 超出上限则移除最老的
            if (this.projectiles.length >= this.MAX_PROJECTILES) {
                this._removeProjectile(0);
            }

            // 计算散射方向
            const dir = direction.clone();
            if (spread > 0) {
                // 在cone内随机偏转
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.random() * spread;
                const sinPhi = Math.sin(phi);

                // 构建正交基
                const up = Math.abs(dir.y) < 0.99
                    ? new THREE.Vector3(0, 1, 0)
                    : new THREE.Vector3(1, 0, 0);
                const right = new THREE.Vector3().crossVectors(dir, up).normalize();
                const trueUp = new THREE.Vector3().crossVectors(right, dir).normalize();

                dir.addScaledVector(right, sinPhi * Math.cos(theta));
                dir.addScaledVector(trueUp, sinPhi * Math.sin(theta));
                dir.normalize();
            }

            // 创建mesh
            const geo = getProjectileGeo(type);
            const mat = getProjectileMat(color);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(origin);
            mesh.scale.setScalar(size);

            // 朝向飞行方向
            if (dir.lengthSq() > 0.001) {
                mesh.quaternion.setFromUnitVectors(
                    new THREE.Vector3(0, 0, 1),
                    dir
                );
            }

            this.scene.add(mesh);

            this.projectiles.push({
                mesh: mesh,
                vel: dir.multiplyScalar(speed),
                life: lifetime,
                type: type,
                damage: damage,
                homing: homing,
                homingTarget: homingTarget ? homingTarget.clone() : null,
                homingStrength: homingStrength,
                speed: speed,
            });
        }
    }

    /**
     * 每帧更新 - 移动弹丸, 检测碰撞
     * @param {number} dt
     * @returns {HitResult[]} 本帧所有命中事件
     */
    update(dt) {
        this.hitResults = [];

        // 每帧构建完整碰撞体列表 (恶魔优先! 放在前面先检测)
        this._frameColliders = [];
        if (this.demonRegistry && this.demonRegistry.demons) {
            for (const demon of this.demonRegistry.demons) {
                if (demon.state === 'dead') continue;
                this._frameColliders.push(demon.getAABB());
            }
        }
        // 墙壁放后面
        for (let i = 0; i < this.colliders.length; i++) {
            this._frameColliders.push(this.colliders[i]);
        }

        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];

            // 生命衰减
            p.life -= dt;
            if (p.life <= 0) {
                this._removeProjectile(i);
                continue;
            }

            // 归巢转向
            if (p.homing && p.homingTarget) {
                this._tempDir.copy(p.homingTarget).sub(p.mesh.position).normalize();
                p.vel.lerp(this._tempDir.multiplyScalar(p.speed), p.homingStrength);
                // 保持恒速
                p.vel.normalize().multiplyScalar(p.speed);
            }

            // 记录上一帧位置 (用于连续碰撞检测)
            this._prevPos.copy(p.mesh.position);

            // 移动
            p.mesh.position.addScaledVector(p.vel, dt);

            // 更新朝向
            if (p.vel.lengthSq() > 0.1) {
                this._tempDir.copy(p.vel).normalize();
                p.mesh.quaternion.setFromUnitVectors(
                    new THREE.Vector3(0, 0, 1),
                    this._tempDir
                );
            }

            // AABB碰撞检测 (墙壁 + 恶魔, 使用_frameColliders)
            const hit = this._checkCollision(this._prevPos, p.mesh.position, p);
            if (hit) {
                // 如果命中的是恶魔, 造成伤害
                if (hit.collider && hit.collider.type === 'enemy' && hit.collider.demon) {
                    hit.collider.demon.takeDamage(p.damage || 1, p.vel.clone().normalize());
                }
                this.hitResults.push(hit);
                this._removeProjectile(i);
            }
        }

        return this.hitResults;
    }

    /**
     * AABB碰撞检测
     * 对弹丸当前位置做点包含测试, 并计算命中法线
     */
    _checkCollision(prevPos, currPos, projectile) {
        // 扫描检测: 在prevPos和currPos之间取多个采样点
        // 防止高速弹丸跳帧穿过目标
        const steps = 3; // 每帧检测3个点 (起点, 中点, 终点)

        for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const px = prevPos.x + (currPos.x - prevPos.x) * t;
            const py = prevPos.y + (currPos.y - prevPos.y) * t;
            const pz = prevPos.z + (currPos.z - prevPos.z) * t;

            for (let c of this._frameColliders) {
                if (px > c.minX && px < c.maxX &&
                    py > c.minY && py < c.maxY &&
                    pz > c.minZ && pz < c.maxZ) {

                    const hitPos = new THREE.Vector3(px, py, pz);
                    const normal = this._calcHitNormal(prevPos, hitPos, c);

                    return {
                        position: hitPos,
                        normal: normal,
                        collider: c,
                        projectileType: projectile.type,
                        speed: projectile.speed
                    };
                }
            }
        }
        return null;
    }

    /**
     * 根据弹丸进入方向计算命中面法线
     */
    _calcHitNormal(prevPos, currPos, collider) {
        const normal = new THREE.Vector3(0, 0, 0);
        const dx = currPos.x - prevPos.x;
        const dy = currPos.y - prevPos.y;
        const dz = currPos.z - prevPos.z;

        // 找到穿越的面 (哪个轴上一帧在外面)
        if (prevPos.x <= collider.minX && dx > 0) normal.x = -1;
        else if (prevPos.x >= collider.maxX && dx < 0) normal.x = 1;
        else if (prevPos.y <= collider.minY && dy > 0) normal.y = -1;
        else if (prevPos.y >= collider.maxY && dy < 0) normal.y = 1;
        else if (prevPos.z <= collider.minZ && dz > 0) normal.z = -1;
        else if (prevPos.z >= collider.maxZ && dz < 0) normal.z = 1;
        else {
            // fallback: 用速度反方向
            normal.copy(new THREE.Vector3(-dx, -dy, -dz)).normalize();
        }

        if (normal.lengthSq() === 0) {
            normal.set(0, 1, 0); // 安全fallback
        }
        return normal.normalize();
    }

    /**
     * 移除弹丸
     */
    _removeProjectile(index) {
        const p = this.projectiles[index];
        const before = this.scene.children.length;
        this.scene.remove(p.mesh);
        const after = this.scene.children.length;
        if (before === after) {
            console.error('[PROJECTILE LEAK] scene.remove FAILED! mesh.parent=', p.mesh.parent === this.scene ? 'scene' : p.mesh.parent, 'type=', p.mesh.geometry?.type);
        }
        this.projectiles.splice(index, 1);
    }

    /**
     * 清理所有弹丸
     */
    dispose() {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            this._removeProjectile(i);
        }
    }

    /**
     * 获取当前弹丸数量 (debug用)
     */
    getCount() {
        return this.projectiles.length;
    }
}
