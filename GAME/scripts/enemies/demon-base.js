/**
 * DEMON-BASE.JS — 恶魔基类
 *
 * 所有恶魔继承此类，提供:
 * - HP系统 (受击、死亡)
 * - AABB碰撞体 (用于被弹丸命中)
 * - AI状态机 (idle, chase, attack, stagger, dead)
 * - 死亡VFX (爆炸碎片)
 * - 生命周期管理 (spawn, update, dispose)
 */

const THREE = window.THREE;

export const DemonState = {
    IDLE: 'idle',
    CHASE: 'chase',
    ATTACK: 'attack',
    STAGGER: 'stagger',
    DEAD: 'dead',
};

export class DemonBase {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Vector3} position - 生成位置
     * @param {object} config - { hp, speed, size, attackRange, attackDamage, name }
     */
    constructor(scene, position, config = {}) {
        this.scene = scene;
        this._colliders = config.colliders || null;
        this.id = Math.random().toString(36).substr(2, 9);

        // 属性
        this.hp = config.hp || 10;
        this.maxHp = this.hp;
        this.speed = config.speed || 5;
        this.attackRange = config.attackRange || 3;
        this.attackDamage = config.attackDamage || 1;
        this.name = config.name || 'DEMON';

        // 碰撞体尺寸 (AABB半宽)
        this.size = config.size || new THREE.Vector3(1, 1.5, 1);

        // 状态
        this.state = DemonState.IDLE;
        this.staggerTimer = 0;
        this.attackCooldown = 0;
        this.age = 0;

        // 位置
        this.position = position.clone();
        this.velocity = new THREE.Vector3();

        // 3D模型 (子类在buildModel中创建)
        this.group = new THREE.Group();
        this.group.position.copy(this.position);
        this.scene.add(this.group);

        // 死亡碎片
        this._deathParticles = [];

        // 受击高亮系统
        this._flashTimer = 0;
        this._meshRefs = [];    // 缓存的mesh引用 [{mesh, origColor}]
        this._meshRefsCached = false;

        // 子类需实现 buildModel()
        this.buildModel();
    }

    /**
     * 子类重写: 构建3D模型, 添加到this.group
     */
    buildModel() {
        // 默认: 一个红色方块占位
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(this.size.x * 2, this.size.y * 2, this.size.z * 2),
            new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true })
        );
        this.group.add(mesh);
    }

    /**
     * 子类可重写: 自定义动画
     */
    updateAnimation(dt) {
        // 默认: 轻微浮动
        this.group.position.y = this.position.y + Math.sin(this.age * 2) * 0.2;
    }

    /**
     * 默认AI: 纯直冲玩家 (吸血鬼幸存者式)
     */
    updateAI(dt, playerPos) {
        const toPlayer = playerPos.clone().sub(this.position);
        toPlayer.normalize();
        this.velocity.lerp(toPlayer.multiplyScalar(this.speed), dt * 5);
    }

    /**
     * 每帧更新 (由registry调用)
     * @param {number} dt
     * @param {THREE.Vector3} playerPos
     */
    update(dt, playerPos) {
        if (this.state === DemonState.DEAD) {
            this._updateDeathParticles(dt);
            return;
        }

        this.age += dt;

        // 受击高亮 (变白/恢复)
        if (this._flashTimer > 0) {
            this._flashTimer -= dt;

            // 首次缓存所有mesh引用 + 原色
            if (!this._meshRefsCached) {
                this._meshRefsCached = true;
                this._meshRefs = [];
                this.group.traverse((child) => {
                    if (child.isMesh && child.material && child.material.color) {
                        this._meshRefs.push({
                            mesh: child,
                            origColor: child.material.color.getHex()
                        });
                    }
                });
            }

            // timer > 0: 设白
            for (const ref of this._meshRefs) {
                ref.mesh.material.color.setHex(0xffffff);
            }
        } else if (this._meshRefsCached && this._meshRefs.length > 0) {
            // timer <= 0: 恢复原色
            for (const ref of this._meshRefs) {
                ref.mesh.material.color.setHex(ref.origColor);
            }
        }

        // 硬直
        if (this.state === DemonState.STAGGER) {
            this.staggerTimer -= dt;
            if (this.staggerTimer <= 0) {
                this.state = DemonState.CHASE;
            }
            return;
        }

        // 攻击冷却
        if (this.attackCooldown > 0) {
            this.attackCooldown -= dt;
        }

        // AI
        this.updateAI(dt, playerPos);

        // 移动 (带碰撞检测)
        const newPos = this.position.clone().addScaledVector(this.velocity, dt);

        // 检测是否会进入墙体
        if (this._colliders) {
            const hw = this.size.x, hh = this.size.y, hd = this.size.z;
            let blocked = false;
            for (const c of this._colliders) {
                if (newPos.x + hw > c.minX && newPos.x - hw < c.maxX &&
                    newPos.y + hh > c.minY && newPos.y - hh < c.maxY &&
                    newPos.z + hd > c.minZ && newPos.z - hd < c.maxZ) {
                    blocked = true;
                    break;
                }
            }
            if (!blocked) {
                this.position.copy(newPos);
            } else {
                // 碰墙: 反弹速度
                this.velocity.multiplyScalar(-0.3);
            }
        } else {
            this.position.copy(newPos);
        }

        this.velocity.multiplyScalar(0.98);
        this.group.position.copy(this.position);

        // 始终面朝玩家
        const toPlayer = playerPos.clone().sub(this.position);
        if (toPlayer.lengthSq() > 1) {
            if (this._keepUpright && this._keepUpright()) {
                // 直立型怪物: 只在Y轴旋转, 保持头朝上
                const flatDir = toPlayer.clone();
                flatDir.y = 0;
                if (flatDir.lengthSq() > 0.01) {
                    flatDir.normalize();
                    const angle = Math.atan2(flatDir.x, flatDir.z);
                    const targetQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
                    this.group.quaternion.slerp(targetQuat, dt * 3);
                }
            } else {
                // 浮空型怪物: 完全朝向玩家(含上下)
                toPlayer.normalize();
                const targetQuat = new THREE.Quaternion().setFromUnitVectors(
                    new THREE.Vector3(0, 0, 1), toPlayer
                );
                this.group.quaternion.slerp(targetQuat, dt * 3);
            }
        }

        // 动画
        this.updateAnimation(dt);
    }

    /**
     * 获取AABB碰撞体 (供弹丸系统检测)
     */
    getAABB() {
        // 使用group的实际世界位置 (包含浮动动画偏移)
        const worldPos = this.group.position;
        // 碰撞体稍微放大1.5倍 — 防止高速弹丸跳帧
        const sx = this.size.x * 1.5;
        const sy = this.size.y * 1.5;
        const sz = this.size.z * 1.5;
        return {
            minX: worldPos.x - sx,
            maxX: worldPos.x + sx,
            minY: worldPos.y - sy,
            maxY: worldPos.y + sy,
            minZ: worldPos.z - sz,
            maxZ: worldPos.z + sz,
            type: 'enemy',
            demon: this,
        };
    }

    /**
     * 受击
     * @param {number} damage
     * @param {THREE.Vector3} hitDir - 命中方向
     */
    takeDamage(damage, hitDir) {
        if (this.state === DemonState.DEAD) return;

        this.hp -= damage;
        this._flashTimer = 0.04; // 极短变白

        // 击退
        if (hitDir) {
            this.velocity.addScaledVector(hitDir, 8);
        }

        // 硬直 (只有大伤害才硬直)
        if (damage >= 5) {
            this.state = DemonState.STAGGER;
            this.staggerTimer = 0.15;
        }

        if (this.hp <= 0) {
            this.die();
        }
    }

    /**
     * 死亡
     */
    die() {
        this.state = DemonState.DEAD;
        this.group.visible = false;

        // 死亡爆炸: 把模型碎成碎片
        this._spawnDeathExplosion();
    }

    /**
     * 死亡爆炸VFX
     */
    _spawnDeathExplosion() {
        const pos = this.position;
        const colors = [0xff2200, 0xff6600, 0x880000, 0xffaa00, 0x440000];

        for (let i = 0; i < 20; i++) {
            const geo = new THREE.BoxGeometry(
                0.3 + Math.random() * 0.5,
                0.3 + Math.random() * 0.5,
                0.3 + Math.random() * 0.5
            );
            const mat = new THREE.MeshBasicMaterial({ color: colors[i % colors.length] });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(pos);
            mesh.position.x += (Math.random() - 0.5) * this.size.x;
            mesh.position.y += (Math.random() - 0.5) * this.size.y;
            mesh.position.z += (Math.random() - 0.5) * this.size.z;
            this.scene.add(mesh);

            this._deathParticles.push({
                mesh, mat,
                vel: new THREE.Vector3(
                    (Math.random() - 0.5) * 15,
                    Math.random() * 10 + 5,
                    (Math.random() - 0.5) * 15
                ),
                life: 1.0 + Math.random() * 0.5,
                spin: new THREE.Vector3(
                    (Math.random() - 0.5) * 10,
                    (Math.random() - 0.5) * 10,
                    (Math.random() - 0.5) * 10
                ),
            });
        }
    }

    _updateDeathParticles(dt) {
        for (let i = this._deathParticles.length - 1; i >= 0; i--) {
            const p = this._deathParticles[i];
            p.life -= dt;
            if (p.life <= 0) {
                this.scene.remove(p.mesh);
                p.mat.dispose();
                this._deathParticles.splice(i, 1);
                continue;
            }
            p.vel.y -= 20 * dt;
            p.mesh.position.addScaledVector(p.vel, dt);
            p.mesh.rotation.x += p.spin.x * dt;
            p.mesh.rotation.y += p.spin.y * dt;
            p.mesh.scale.setScalar(p.life * 0.8);
        }
    }

    /**
     * 是否已完全消失 (死亡动画结束)
     */
    isFullyDead() {
        return this.state === DemonState.DEAD && this._deathParticles.length === 0;
    }

    /**
     * 清理
     */
    dispose() {
        this.scene.remove(this.group);
        for (const p of this._deathParticles) {
            this.scene.remove(p.mesh);
            p.mat.dispose();
        }
        this._deathParticles = [];
    }
}
