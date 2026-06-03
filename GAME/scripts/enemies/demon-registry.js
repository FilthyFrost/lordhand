/**
 * DEMON-REGISTRY.JS — 恶魔注册表与生成系统
 *
 * 职责:
 * - 注册恶魔类型 (名称 → 构造函数)
 * - 管理所有活跃恶魔实例
 * - 提供spawn/despawn接口
 * - 每帧更新所有恶魔 (AI + 动画)
 * - 提供碰撞体列表供弹丸系统检测
 * - 处理弹丸命中恶魔的逻辑
 */

const THREE = window.THREE;

export class DemonRegistry {
    /**
     * @param {THREE.Scene} scene
     */
    constructor(scene) {
        this.scene = scene;

        // 注册表: { typeName: DemonClass }
        this._types = {};

        // 活跃恶魔实例
        this.demons = [];

        // 性能限制
        this.MAX_DEMONS = 30;
    }

    /**
     * 注册一种恶魔类型
     * @param {string} name - 类型名 (如 'skull', 'squid', 'centipede')
     * @param {class} DemonClass - 继承DemonBase的类
     */
    register(name, DemonClass) {
        this._types[name] = DemonClass;
    }

    /**
     * 生成一只恶魔
     * @param {string} type - 已注册的类型名
     * @param {THREE.Vector3} position - 生成位置
     * @param {object} configOverride - 可选: 覆盖默认config
     * @returns {DemonBase|null}
     */
    /**
     * 设置场景碰撞体 (所有恶魔共享)
     */
    setColliders(colliders) {
        this._colliders = colliders;
    }

    spawn(type, position, configOverride = {}) {
        if (this.demons.length >= this.MAX_DEMONS) return null;

        const DemonClass = this._types[type];
        if (!DemonClass) {
            console.warn(`Demon type "${type}" not registered`);
            return null;
        }

        // 传入碰撞体
        configOverride.colliders = this._colliders || null;
        const demon = new DemonClass(this.scene, position, configOverride);
        this.demons.push(demon);
        return demon;
    }

    /**
     * 每帧更新所有恶魔
     * @param {number} dt
     * @param {THREE.Vector3} playerPos
     */
    update(dt, playerPos) {
        for (let i = this.demons.length - 1; i >= 0; i--) {
            const demon = this.demons[i];
            demon.update(dt, playerPos);

            // 清理已完全死亡的恶魔
            if (demon.isFullyDead()) {
                demon.dispose();
                this.demons.splice(i, 1);
            }
        }
    }

    /**
     * 获取所有活跃恶魔的AABB碰撞体 (供弹丸系统使用)
     * @returns {Array}
     */
    getColliders() {
        const colliders = [];
        for (const demon of this.demons) {
            if (demon.state !== 'dead') {
                colliders.push(demon.getAABB());
            }
        }
        return colliders;
    }

    /**
     * 检测弹丸命中恶魔
     * @param {Array} hitResults - projectileSystem.hitResults
     * @param {Function} onDemonHit - (demon, hitResult) => void 回调
     */
    processHits(hitResults, onDemonHit) {
        for (const hit of hitResults) {
            // 检查每个活跃恶魔
            for (const demon of this.demons) {
                if (demon.state === 'dead') continue;

                const aabb = demon.getAABB();
                const p = hit.position;
                if (p.x > aabb.minX && p.x < aabb.maxX &&
                    p.y > aabb.minY && p.y < aabb.maxY &&
                    p.z > aabb.minZ && p.z < aabb.maxZ) {
                    // 命中!
                    const damage = hit.speed > 100 ? 3 : hit.speed > 50 ? 2 : 1;
                    const hitDir = hit.normal ? hit.normal.clone().negate() : new THREE.Vector3(0, 0, -1);
                    demon.takeDamage(damage, hitDir);

                    if (onDemonHit) onDemonHit(demon, hit);
                    break; // 一个弹丸只命中一个恶魔
                }
            }
        }
    }

    /**
     * 获取活跃恶魔数量
     */
    getCount() {
        return this.demons.length;
    }

    /**
     * 获取已注册的类型列表
     */
    getTypes() {
        return Object.keys(this._types);
    }

    /**
     * 清除所有恶魔
     */
    clearAll() {
        for (const demon of this.demons) {
            demon.dispose();
        }
        this.demons = [];
    }
}
