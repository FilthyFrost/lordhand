/**
 * INSTANCED-PARTICLES.JS — 高性能实例化粒子系统
 *
 * 用InstancedMesh替代独立Mesh, 将数百个draw call压缩到5-6个
 * 每种粒子类型共享1个InstancedMesh, 通过矩阵变换更新每个实例的位置/旋转/缩放
 */

const THREE = window.THREE;

const _tempMatrix = new THREE.Matrix4();
const _tempPos = new THREE.Vector3();
const _tempQuat = new THREE.Quaternion();
const _tempScale = new THREE.Vector3();
const _zeroScale = new THREE.Vector3(0, 0, 0);

export class InstancedParticles {
    /**
     * @param {THREE.Scene} scene
     */
    constructor(scene) {
        this.scene = scene;

        // 粒子数据数组 (每个类型一个)
        this._pools = {};

        // 定义粒子类型
        this._initPool('cross', new THREE.BoxGeometry(0.07, 0.07, 1.1), 0xcc44ff, 80);
        this._initPool('crossH', new THREE.BoxGeometry(1.1, 0.07, 0.07), 0xcc44ff, 80); // 十字架横梁
        this._initPool('shard', new THREE.ConeGeometry(0.15, 1.4, 3), 0xcc44ff, 60);
        this._initPool('debris', new THREE.BoxGeometry(0.5, 0.5, 0.5), 0x8800ff, 50);
        this._initPool('debrisWhite', new THREE.BoxGeometry(0.6, 0.6, 0.6), 0xffffff, 50);
        this._initPool('ghost', new THREE.ConeGeometry(0.1, 1.5, 4), 0x6600aa, 30);
        this._initPool('needle', new THREE.BoxGeometry(0.08, 0.08, 0.6), 0xaa44ff, 40);
    }

    /**
     * 初始化一种粒子类型的InstancedMesh
     */
    _initPool(name, geometry, color, maxCount) {
        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
        });

        const instancedMesh = new THREE.InstancedMesh(geometry, material, maxCount);
        instancedMesh.frustumCulled = false; // 粒子不做视锥剔除(它们到处都是)

        // 初始化所有实例为scale=0 (隐藏)
        for (let i = 0; i < maxCount; i++) {
            _tempMatrix.compose(_tempPos.set(0,0,0), _tempQuat.identity(), _zeroScale);
            instancedMesh.setMatrixAt(i, _tempMatrix);
        }
        instancedMesh.instanceMatrix.needsUpdate = true;
        this.scene.add(instancedMesh);

        this._pools[name] = {
            mesh: instancedMesh,
            maxCount: maxCount,
            particles: [], // { index, pos, vel, life, maxLife, scale, spinX, spinY, spinZ }
            nextIndex: 0,
        };
    }

    /**
     * 发射粒子
     * @param {string} type - 粒子类型名
     * @param {THREE.Vector3} position
     * @param {THREE.Vector3} velocity
     * @param {number} life - 秒
     * @param {number} scale - 基础缩放
     * @param {number} spinX - X轴自旋速度 rad/s
     * @param {number} spinY - Y轴自旋速度 rad/s
     * @param {number} spinZ - Z轴自旋速度 rad/s
     */
    spawn(type, position, velocity, life, scale, spinX, spinY, spinZ) {
        const pool = this._pools[type];
        if (!pool) return;

        // 获取下一个可用slot (循环复用)
        const index = pool.nextIndex;
        pool.nextIndex = (pool.nextIndex + 1) % pool.maxCount;

        // 如果该slot已有活跃粒子, 移除它
        const existing = pool.particles.findIndex(p => p.index === index);
        if (existing >= 0) pool.particles.splice(existing, 1);

        pool.particles.push({
            index,
            pos: position.clone(),
            vel: velocity.clone(),
            life: life,
            maxLife: life,
            scale: scale,
            rotX: Math.random() * 6.28,
            rotY: Math.random() * 6.28,
            rotZ: Math.random() * 6.28,
            spinX: spinX || 0,
            spinY: spinY || 0,
            spinZ: spinZ || 0,
        });
    }

    /**
     * 批量发射 (高效: 一次push多个)
     */
    spawnBurst(type, origin, dir, count, spreadAngle, speedMin, speedMax, life, scaleMin, scaleMax) {
        for (let i = 0; i < count; i++) {
            const vel = dir.clone();
            vel.x += (Math.random() - 0.5) * spreadAngle * 2;
            vel.y += (Math.random() - 0.5) * spreadAngle * 2;
            vel.z += (Math.random() - 0.5) * spreadAngle * 2;
            vel.normalize().multiplyScalar(speedMin + Math.random() * (speedMax - speedMin));

            const scale = scaleMin + Math.random() * (scaleMax - scaleMin);
            const spin = 15 + Math.random() * 20;

            this.spawn(type, origin, vel, life, scale,
                (Math.random()-0.5) * spin,
                (Math.random()-0.5) * spin,
                (Math.random()-0.5) * spin
            );
        }
    }

    /**
     * 每帧更新所有粒子
     * @param {number} dt
     */
    update(dt) {
        for (const name in this._pools) {
            const pool = this._pools[name];
            let needsUpdate = false;

            for (let i = pool.particles.length - 1; i >= 0; i--) {
                const p = pool.particles[i];
                p.life -= dt;

                if (p.life <= 0) {
                    // 隐藏 (scale=0)
                    _tempMatrix.compose(_tempPos.set(0,0,0), _tempQuat.identity(), _zeroScale);
                    pool.mesh.setMatrixAt(p.index, _tempMatrix);
                    pool.particles.splice(i, 1);
                    needsUpdate = true;
                    continue;
                }

                // 物理更新
                p.vel.y -= 8 * dt; // 轻微重力
                p.pos.addScaledVector(p.vel, dt);

                // 旋转
                p.rotX += p.spinX * dt;
                p.rotY += p.spinY * dt;
                p.rotZ += p.spinZ * dt;

                // 缩放: 线性衰减
                const t = p.life / p.maxLife;
                const currentScale = p.scale * t;

                // 设置矩阵
                _tempQuat.setFromEuler(new THREE.Euler(p.rotX, p.rotY, p.rotZ));
                _tempScale.setScalar(currentScale);
                _tempMatrix.compose(p.pos, _tempQuat, _tempScale);
                pool.mesh.setMatrixAt(p.index, _tempMatrix);
                needsUpdate = true;
            }

            if (needsUpdate) {
                pool.mesh.instanceMatrix.needsUpdate = true;
            }
        }
    }

    /**
     * 获取当前活跃粒子总数 (debug)
     */
    getActiveCount() {
        let total = 0;
        for (const name in this._pools) {
            total += this._pools[name].particles.length;
        }
        return total;
    }
}
