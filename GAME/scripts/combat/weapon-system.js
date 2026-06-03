/**
 * WEAPON-SYSTEM.JS — 统一武器系统 (Hyper Demon风格)
 *
 * 4种释放模式 + 6根针资源管理:
 * - LMB点按: 散弹爆发 (0.5s CD)
 * - LMB长按: 持续十字架流
 * - RMB点按: 发射1根针
 * - RMB长按: 6针全亮→松开释放穿透hitscan大招
 *
 * 资源: 6根紫色针 (环绕手腕)
 * - 正常: 1根/秒自动恢复
 * - 大招后: 6秒CD后一次性恢复全部
 */

const THREE = window.THREE;
import { enhanceImpact } from '../vfx/particles.js';
import { InstancedParticles } from './instanced-particles.js';

// 十字架几何体 (小型)
const _crossGeo = new THREE.BufferGeometry();
const cv = 0.04, cl = 0.15;
_crossGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -cv, -cl, 0, cv, -cl, 0, cv, cl, 0, -cv, cl, 0, // 竖
    -cl, -cv, 0, cl, -cv, 0, cl, cv, 0, -cl, cv, 0, // 横
]), 3));
_crossGeo.setIndex([0,1,2, 0,2,3, 4,5,6, 4,6,7]);

// 针几何体 (飞行用)
const _needleGeo = new THREE.ConeGeometry(0.06, 1.2, 4);
_needleGeo.rotateX(Math.PI / 2);

export class WeaponSystem {
    constructor(scene, camera, audioCtx, compressor, projectileSystem, handModel, colliders, triggerShake, triggerFlash, setFovOffset) {
        this.scene = scene;
        this.camera = camera;
        this.audioCtx = audioCtx;
        this.compressor = compressor;
        this.projectileSystem = projectileSystem;
        this.handModel = handModel;
        this.colliders = colliders;
        this.triggerShake = triggerShake;
        this.demonRegistry = null; // 由外部设置
        this.triggerFlash = triggerFlash;
        this.setFovOffset = setFovOffset;

        // ==========================================
        // 资源系统: 6根针
        // ==========================================
        this.needles = 6;          // 当前针数
        this.maxNeedles = 6;
        this._regenTimer = 0;      // 恢复计时器
        this._regenInterval = 1.0; // 1秒恢复1根
        this._ultimateCooldown = 0;// 大招CD (6秒)
        this._isUltimateCooling = false;

        // ==========================================
        // 输入状态
        // ==========================================
        this._lmbDown = false;
        this._lmbDownTime = 0;
        this._lmbCooldown = 0;     // 散弹CD

        this._rmbDown = false;
        this._rmbDownTime = 0;
        this._rmbCharging = false; // 正在蓄力大招
        this._rmbChargeCount = 0;  // 已点亮的针数 (0-6)
        this._rmbChargeTimer = 0;  // 点亮计时器
        this._rmbChargeInterval = 0.3; // 每0.3秒亮一根

        // ==========================================
        // LMB长按 stream
        // ==========================================
        this._isStreaming = false;
        this._streamTimer = 0;
        this._streamInterval = 0.055; // 每55ms一个十字架 (18次/秒, 性能优化)

        // ==========================================
        // 飞行中的针 (RMB tap发射的)
        // ==========================================
        this._flyingNeedles = [];

        // ==========================================
        // 视觉: 手腕6针环 (3D meshes)
        // ==========================================
        this._needleMeshes = [];
        this._needleRingGroup = new THREE.Group();
        this._needleRotation = 0;
        this._initNeedleRing();

        // ==========================================
        // Stream视觉: 十字架粒子
        // ==========================================
        this._crossParticles = [];

        // 实例化粒子系统 (高性能)
        this._instParticles = new InstancedParticles(scene);

        // 性能限制: 同时活跃的动画数
        this._activeAnims = 0;

        // 音效
        this._noiseBuffer = this._createNoiseBuffer();
        this._streamOsc = null;
        this._streamGain = null;
    }

    // ==========================================
    // 公开接口
    // ==========================================

    onMouseDown(button) {
        if (button === 0) { // LMB
            this._lmbDown = true;
            this._lmbDownTime = performance.now();

            // 立即尝试散弹 (如果不在CD)
            if (this._lmbCooldown <= 0) {
                this._fireShotgun();
                this._lmbCooldown = 0.5;
            }
        } else if (button === 2) { // RMB
            this._rmbDown = true;
            this._rmbDownTime = performance.now();
            this._rmbFiredNeedle = false; // 追踪是否已发射单针
        }
    }

    onMouseUp(button) {
        if (button === 0) { // LMB
            this._lmbDown = false;
            if (this._isStreaming) {
                this._stopStream();
            }
        } else if (button === 2) { // RMB
            this._rmbDown = false;
            const holdDuration = performance.now() - this._rmbDownTime;

            if (this._rmbCharging && this._rmbChargeCount >= 6) {
                // 大招蓄力完成 → 释放
                this._fireUltimate();
            } else if (this._rmbCharging) {
                // 蓄力未完成就松手 → 取消
                this._rmbCharging = false;
                this._rmbChargeCount = 0;
            } else if (!this._rmbFiredNeedle && holdDuration < 200 && this.needles > 0) {
                // 轻点RMB (< 200ms且未进入蓄力) → 发射单针
                this._fireSingleNeedle();
            }

            this._rmbCharging = false;
            this._rmbChargeCount = 0;
        }
    }

    update(dt) {
        // LMB CD
        if (this._lmbCooldown > 0) this._lmbCooldown -= dt;

        // LMB长按 → stream (150ms后开始)
        if (this._lmbDown && !this._isStreaming) {
            if (performance.now() - this._lmbDownTime > 150) {
                this._startStream();
            }
        }

        // Stream持续发射
        if (this._isStreaming) {
            this._streamTimer += dt;
            if (this._streamTimer >= this._streamInterval) {
                this._streamTimer -= this._streamInterval;
                this._fireStreamCross();
            }
        }

        // RMB长按检测: 200ms后进入大招蓄力 (需6针)
        if (this._rmbDown && !this._rmbCharging && !this._rmbFiredNeedle) {
            if (performance.now() - this._rmbDownTime > 200) {
                if (this.needles >= 6 && !this._isUltimateCooling) {
                    this._rmbCharging = true;
                    this._rmbChargeCount = 0;
                    this._rmbChargeTimer = 0;
                }
            }
        }

        // RMB大招蓄力: 每0.3秒点亮一根针
        if (this._rmbCharging) {
            this._rmbChargeTimer += dt;
            if (this._rmbChargeTimer >= this._rmbChargeInterval && this._rmbChargeCount < 6) {
                this._rmbChargeTimer -= this._rmbChargeInterval;
                this._rmbChargeCount++;
                this._onNeedleLitUp(this._rmbChargeCount);
            }
        }

        // 针恢复
        if (!this._isUltimateCooling) {
            if (this.needles < this.maxNeedles) {
                this._regenTimer += dt;
                if (this._regenTimer >= this._regenInterval) {
                    this._regenTimer -= this._regenInterval;
                    this.needles = Math.min(this.needles + 1, this.maxNeedles);
                }
            }
        } else {
            // 大招冷却
            this._ultimateCooldown -= dt;
            if (this._ultimateCooldown <= 0) {
                this._isUltimateCooling = false;
                this.needles = this.maxNeedles; // 一次性恢复全部
            }
        }

        // 更新视觉
        this._updateNeedleRing(dt);
        this._updateFlyingNeedles(dt);
        this._updateCrossParticles(dt);
        this._instParticles.update(dt);
    }

    getHandState() {
        if (this._rmbCharging) return 'charge';
        if (this._isStreaming) return 'stream';
        return 'idle';
    }

    isCharging() {
        return this._rmbCharging;
    }

    // ==========================================
    // LMB: 散弹
    // ==========================================

    _fireShotgun() {
        const origin = this.handModel.getFireOrigin();
        const dir = this.handModel.getFireDirection();

        // 1. 50发密集散弹 (紫色匕首雨 — 吞噬一切)
        this.projectileSystem.spawn(origin, dir, {
            speed: 130, lifetime: 2.0, spread: 0.5, count: 50,
            homing: false, type: 'dagger', size: 3.5, color: 0xcc44ff, damage: 1,
        });

        // 2. 20个密集十字架 (用InstancedMesh — 高性能)
        this._instParticles.spawnBurst('cross', origin, dir, 20, 0.9, 60, 120, 0.35, 1.5, 3.0);
        this._instParticles.spawnBurst('crossH', origin, dir, 20, 0.9, 60, 120, 0.35, 1.5, 3.0);

        // 3. 掌心爆发闪电弧 (12条紫色短弧 — 吞噬感的来源)
        for (let a = 0; a < 12; a++) {
            const arcPts = [];
            const arcDir = dir.clone().add(new THREE.Vector3((Math.random()-0.5)*3,(Math.random()-0.5)*3,(Math.random()-0.5)*3)).normalize();
            for (let t = 0; t < 6; t++) {
                arcPts.push(origin.clone().addScaledVector(arcDir, t * 0.25 + Math.random()*0.1).add(
                    new THREE.Vector3((Math.random()-0.5)*0.12,(Math.random()-0.5)*0.12,(Math.random()-0.5)*0.12)
                ));
            }
            const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
            const arcLine = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: a % 3 === 0 ? 0x88ffff : 0xaa44ff, transparent: true, opacity: 0.9 }));
            this.scene.add(arcLine);
            setTimeout(() => { this.scene.remove(arcLine); arcGeo.dispose(); }, 80);
        }


        // 5. 发射瞬间 "吸入碎片" (用instanced — 从周围飞向中心)
        for (let i = 0; i < 8; i++) {
            const offset = new THREE.Vector3((Math.random()-0.5)*3, (Math.random()-0.5)*3, (Math.random()-0.5)*2);
            const startPos = origin.clone().add(offset);
            const toCenter = origin.clone().sub(startPos).normalize().multiplyScalar(50);
            this._instParticles.spawn('debris', startPos, toCenter, 0.15, 0.5 + Math.random()*0.4, 10, 8, 12);
        }

        // 6. 极端反馈
        this.handModel.recoil(1.3);
        this.triggerShake(0.8, 0.15);
        this.triggerFlash('rgba(180, 0, 255, 0.5)', 1, 0.1);
        if (window.__juice) {
            window.__juice.hitStop(3);
            window.__juice.cameraImpulse(dir.clone().negate(), 0.7);
            window.__juice.chromaticAberration(0.4);
            window.__juice.whiteout(0.2);
            window.__juice.radialDistortion(0.2);
        }

        // 散弹音效
        if (window._playShotgunBlast) window._playShotgunBlast();
    }

    // ==========================================
    // LMB长按: 十字架流
    // ==========================================

    _startStream() {
        this._isStreaming = true;
        this._streamTimer = 0;
        // 不再播放持续嗡鸣音 — 命中时由主HTML播放撞击音效
    }

    _stopStream() {
        this._isStreaming = false;
    }

    _fireStreamCross() {
        const origin = this.handModel.getFireOrigin();
        const dir = this.handModel.getFireDirection();

        // 4发弹丸 (增加命中率)
        this.projectileSystem.spawn(origin, dir, {
            speed: 130, lifetime: 1.0, spread: 0.12, count: 4,
            homing: false, type: 'pulse', size: 1.2, color: 0xcc88ff, damage: 1,
        });

        // 3个十字架 (用instanced — 高性能, 不再用独立Mesh)
        this._instParticles.spawnBurst('cross', origin, dir, 3, 0.3, 60, 90, 0.25, 1.5, 2.5);
        this._instParticles.spawnBurst('crossH', origin, dir, 3, 0.3, 60, 90, 0.25, 1.5, 2.5);

        // muzzle flash: 用instanced needle代替独立Mesh+setTimeout
        this._instParticles.spawnBurst('needle', origin, dir, 3, 1.0, 40, 70, 0.06, 0.8, 1.2);

        this.handModel.recoil(0.08);
        this.triggerShake(0.06, 0.02);
    }

    _updateCrossParticles(dt) {
        for (let i = this._crossParticles.length - 1; i >= 0; i--) {
            const p = this._crossParticles[i];
            p.life -= dt;
            if (p.life <= 0) {
                p.mesh.traverse(c => { if(c.geometry) c.geometry.dispose(); if(c.material) c.material.dispose(); });
                this.scene.remove(p.mesh);
                this._crossParticles.splice(i, 1);
                continue;
            }
            p.mesh.position.addScaledVector(p.vel, dt);
            p.mesh.rotation.x += p.spinX * dt;
            p.mesh.rotation.y += p.spinY * dt;
            p.mesh.scale.setScalar(1.5 * (p.life / 0.8));
            p.mat.opacity = p.life;
        }
    }

    // ==========================================
    // RMB点按: 发射单根针
    // ==========================================

    _fireSingleNeedle() {
        if (this.needles <= 0) return;
        this.needles--;

        const origin = this.handModel.getFireOrigin();
        const dir = this.handModel.getFireDirection();

        // 巨型法术刺: 核心紫 + 白光外层 + 环绕电弧装饰
        const group = new THREE.Group();
        const core = new THREE.Mesh(
            new THREE.ConeGeometry(0.12, 2.5, 6),
            new THREE.MeshBasicMaterial({ color: 0x9900ff })
        );
        core.rotation.x = Math.PI / 2;
        const glow = new THREE.Mesh(
            new THREE.ConeGeometry(0.18, 2.6, 6),
            new THREE.MeshBasicMaterial({ color: 0xcc88ff, transparent: true, opacity: 0.35 })
        );
        glow.rotation.x = Math.PI / 2;
        // 内核极亮白线
        const innerCore = new THREE.Mesh(
            new THREE.ConeGeometry(0.04, 2.3, 4),
            new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        innerCore.rotation.x = Math.PI / 2;
        group.add(core, glow, innerCore);
        group.scale.setScalar(2.2);
        group.position.copy(origin);
        group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
        this.scene.add(group);

        // 发射瞬间: 掌心紫色闪电爆发 (8条短弧)
        for (let a = 0; a < 8; a++) {
            const arcPts = [];
            const arcDir = new THREE.Vector3((Math.random()-0.5)*2, (Math.random()-0.5)*2, (Math.random()-0.5)*2).normalize();
            for (let t = 0; t < 5; t++) {
                arcPts.push(origin.clone().addScaledVector(arcDir, t * 0.15).add(
                    new THREE.Vector3((Math.random()-0.5)*0.08, (Math.random()-0.5)*0.08, (Math.random()-0.5)*0.08)
                ));
            }
            const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
            const arcLine = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: 0xaa66ff, transparent: true, opacity: 0.9 }));
            this.scene.add(arcLine);
            setTimeout(() => { this.scene.remove(arcLine); arcGeo.dispose(); }, 60);
        }

        // 发射瞬间: 速度线 (6条紫色向后延伸)
        for (let s = 0; s < 6; s++) {
            const linePts = [origin.clone(), origin.clone().addScaledVector(dir, -1.5 - Math.random())];
            const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
            const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xcc44ff }));
            this.scene.add(line);
            setTimeout(() => { this.scene.remove(line); lineGeo.dispose(); }, 50);
        }

        this._flyingNeedles.push({
            mesh: group, mat: core.material,
            vel: dir.clone().multiplyScalar(150), // 极快!
            life: 2.5,
            dir: dir.clone(),
            trailTimer: 0,
            lightningTimer: 0,
        });

        this.handModel.recoil(0.8);
        this.triggerShake(0.4, 0.1);
        this.triggerFlash('rgba(160, 0, 255, 0.5)', 1, 0.08);

        if (window.__juice) {
            window.__juice.hitStop(2);
            window.__juice.cameraImpulse(dir.clone().negate(), 0.4);
            window.__juice.chromaticAberration(0.25);
        }

        this._playNeedleSound();
    }

    _updateFlyingNeedles(dt) {
        for (let i = this._flyingNeedles.length - 1; i >= 0; i--) {
            const n = this._flyingNeedles[i];
            n.life -= dt;
            if (n.life <= 0) {
                this.scene.remove(n.mesh); if(n.mesh.geometry) n.mesh.geometry.dispose(); if(n.mesh.material) n.mesh.material.dispose();
                this._flyingNeedles.splice(i, 1);
                continue;
            }

            n.mesh.position.addScaledVector(n.vel, dt);

            // 飞行中环绕紫色雷电拖尾 (每0.03秒生成一条短弧)
            n.lightningTimer += dt;
            if (n.lightningTimer > 0.03) {
                n.lightningTimer = 0;
                const pos = n.mesh.position.clone();
                // 2条极短的锯齿弧围绕针体
                for (let a = 0; a < 2; a++) {
                    const pts = [];
                    const perpDir = new THREE.Vector3((Math.random()-0.5), (Math.random()-0.5), (Math.random()-0.5)).normalize();
                    for (let t = 0; t < 4; t++) {
                        pts.push(pos.clone()
                            .addScaledVector(n.dir, (t - 2) * 0.3)
                            .addScaledVector(perpDir, (Math.random()-0.5) * 0.4)
                        );
                    }
                    const arcGeo = new THREE.BufferGeometry().setFromPoints(pts);
                    const arcMat = new THREE.LineBasicMaterial({ color: Math.random() > 0.5 ? 0xaa44ff : 0x88ffff, transparent: true, opacity: 0.8 });
                    const arc = new THREE.Line(arcGeo, arcMat);
                    this.scene.add(arc);
                    // 极短存活 — 闪烁感
                    const arcStart = performance.now();
                    const fadeArc = () => {
                        if (performance.now() - arcStart > 50) { this.scene.remove(arc); arcGeo.dispose(); arcMat.dispose(); return; }
                        arc.visible = Math.random() > 0.3;
                        requestAnimationFrame(fadeArc);
                    };
                    fadeArc();
                }
            }

            // 飞行拖尾: 紫色ghost每0.04秒
            n.trailTimer += dt;
            if (n.trailTimer > 0.04) {
                n.trailTimer = 0;
                const ghost = new THREE.Mesh(
                    new THREE.ConeGeometry(0.1, 1.5, 4),
                    new THREE.MeshBasicMaterial({ color: 0x6600aa, transparent: true, opacity: 0.4 })
                );
                ghost.rotation.x = Math.PI / 2;
                ghost.position.copy(n.mesh.position);
                ghost.quaternion.copy(n.mesh.quaternion);
                ghost.scale.setScalar(1.8);
                this.scene.add(ghost);
                const gStart = performance.now();
                const fadeGhost = () => {
                    const age = (performance.now() - gStart) / 120;
                    if (age > 1) { this.scene.remove(ghost); ghost.geometry.dispose(); ghost.material.dispose(); return; }
                    ghost.scale.setScalar(1.8 * (1 - age));
                    ghost.material.opacity = 0.4 * (1 - age);
                    requestAnimationFrame(fadeGhost);
                };
                fadeGhost();
            }

            // 碰撞检测: 先检测恶魔(伤害10), 再检测墙壁
            const pos = n.mesh.position;
            let hit = false;

            // 检测恶魔命中
            if (this.demonRegistry) {
                for (const demon of this.demonRegistry.demons) {
                    if (demon.state === 'dead') continue;
                    const aabb = demon.getAABB();
                    if (pos.x > aabb.minX && pos.x < aabb.maxX &&
                        pos.y > aabb.minY && pos.y < aabb.maxY &&
                        pos.z > aabb.minZ && pos.z < aabb.maxZ) {
                        demon.takeDamage(10, n.dir.clone());
                        this._onNeedleHit(pos.clone(), n.dir);
                        this.scene.remove(n.mesh); if(n.mesh.geometry) n.mesh.geometry.dispose(); if(n.mesh.material) n.mesh.material.dispose();
                        this._flyingNeedles.splice(i, 1);
                        hit = true;
                        break;
                    }
                }
            }
            if (hit) continue;

            // 检测墙壁
            for (const c of this.colliders) {
                if (pos.x > c.minX && pos.x < c.maxX &&
                    pos.y > c.minY && pos.y < c.maxY &&
                    pos.z > c.minZ && pos.z < c.maxZ) {
                    this._onNeedleHit(pos.clone(), n.dir);
                    this.scene.remove(n.mesh); if(n.mesh.geometry) n.mesh.geometry.dispose(); if(n.mesh.material) n.mesh.material.dispose();
                    this._flyingNeedles.splice(i, 1);
                    hit = true;
                    break;
                }
            }
            if (hit) continue;
        }
    }

    _onNeedleHit(pos, dir) {
        // 15个大型碎片爆射 (instanced — 高性能)
        const normal = dir ? dir.clone().negate() : new THREE.Vector3(0,1,0);
        this._instParticles.spawnBurst('debris', pos, normal, 8, 1.5, 15, 40, 0.35, 0.3, 0.6);
        this._instParticles.spawnBurst('debrisWhite', pos, normal, 7, 1.5, 15, 40, 0.35, 0.3, 0.6);


        this.triggerShake(0.35, 0.12);
        this.triggerFlash('rgba(136, 0, 255, 0.3)', 1, 0.08);
        if (window.__juice) {
            window.__juice.hitStop(3);
            window.__juice.chromaticAberration(0.3);
            window.__juice.cameraImpulse(dir.clone().negate(), 0.2);
        }
    }

    // ==========================================
    // RMB长按: 大招 (6针hitscan穿透)
    // ==========================================

    _onNeedleLitUp(count) {
        // 每根针点亮时的视觉/音效反馈
        this.triggerShake(0.05, 0.03);
        this._playChargeTickSound(count);

        // 手上对应的针变亮 (在_updateNeedleRing中处理)
    }

    _fireUltimate() {
        // 消耗全部6针
        this.needles = 0;
        this._isUltimateCooling = true;
        this._ultimateCooldown = 6.0;

        const origin = this.handModel.getFireOrigin();
        const dir = this.handModel.getFireDirection();
        const endpoint = origin.clone().addScaledVector(dir, 200);

        // 1. 五层巨型光束 (更粗! 更多层! 更疯狂!)
        const beamContainer = new THREE.Group();
        const layers = [
            { r: 0.5, color: 0xffffff, op: 1.0 },    // 核心 - 粗
            { r: 0.9, color: 0xcc44ff, op: 0.7 },    // 紫色强光层
            { r: 1.5, color: 0x8800ff, op: 0.4 },    // 紫色扩散层
            { r: 2.2, color: 0x440088, op: 0.2 },    // 暗紫外层
            { r: 3.0, color: 0x110022, op: 0.08 },   // 极暗最外 - 超大范围
        ];
        layers.forEach(layer => {
            const geo = new THREE.CylinderGeometry(layer.r, layer.r * 0.8, 200, 8);
            const mat = new THREE.MeshBasicMaterial({ color: layer.color, transparent: true, opacity: layer.op, depthWrite: false });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(0, 100, 0);
            beamContainer.add(mesh);
        });
        beamContainer.position.copy(origin);
        beamContainer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        this.scene.add(beamContainer);

        // 2. 沿路径5个冲击波环
        for (let i = 1; i <= 5; i++) {
            const pos = origin.clone().lerp(endpoint, i * 0.2);
            const wave = new THREE.Mesh(
                new THREE.RingGeometry(0.5, 0.7, 8),
                new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 1 })
            );
            wave.position.copy(pos);
            wave.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), dir);
            this.scene.add(wave);
            const start = performance.now();
            const updateWave = () => {
                const t = (performance.now() - start) / 400;
                if (t > 1) { this.scene.remove(wave); wave.geometry.dispose(); wave.material.dispose(); return; }
                wave.scale.setScalar(t * 12);
                wave.material.opacity = 1 - t;
                requestAnimationFrame(updateWave);
            };
            updateWave();
        }

        // 3. 35个巨型碎片沿光束路径 (instanced — 高性能)
        for (let i = 0; i < 35; i++) {
            const pos = origin.clone().lerp(endpoint, Math.random());
            const radialDir = new THREE.Vector3((Math.random()-0.5),(Math.random()-0.5),(Math.random()-0.5)).normalize();
            const vel = radialDir.multiplyScalar(Math.random() * 30 + 20);
            const type = Math.random() > 0.5 ? 'debrisWhite' : 'debris';
            this._instParticles.spawn(type, pos, vel, 0.5, 0.4 + Math.random() * 0.6, (Math.random()-0.5)*20, (Math.random()-0.5)*20, (Math.random()-0.5)*20);
        }

        // 4. 沿途碰撞检测 → 穿透爆炸 + 恶魔伤害(50)
        const step = 2.0;
        const pos = origin.clone();
        const pierced = new Set();
        const damagedDemons = new Set();

        // 先检测恶魔 (大招穿透所有恶魔, 每个受50伤)
        if (this.demonRegistry) {
            for (const demon of this.demonRegistry.demons) {
                if (demon.state === 'dead') continue;
                // 检测光束是否穿过恶魔AABB (简化: 沿射线步进检测)
                const testPos = origin.clone();
                for (let s = 0; s < 100; s++) {
                    testPos.addScaledVector(dir, step);
                    const aabb = demon.getAABB();
                    if (testPos.x > aabb.minX && testPos.x < aabb.maxX &&
                        testPos.y > aabb.minY && testPos.y < aabb.maxY &&
                        testPos.z > aabb.minZ && testPos.z < aabb.maxZ) {
                        if (!damagedDemons.has(demon.id)) {
                            damagedDemons.add(demon.id);
                            demon.takeDamage(50, dir.clone());
                        }
                        break;
                    }
                }
            }
        }

        let impactCount = 0;
        const maxImpacts = 5; // 限制最多5次穿透爆炸 (性能保护)
        for (let i = 0; i < 100; i++) {
            pos.addScaledVector(dir, step);
            if (impactCount >= maxImpacts) continue;
            for (const c of this.colliders) {
                const key = `${c.minX},${c.minY},${c.minZ}`;
                if (pierced.has(key)) continue;
                if (pos.x > c.minX && pos.x < c.maxX && pos.y > c.minY && pos.y < c.maxY && pos.z > c.minZ && pos.z < c.maxZ) {
                    pierced.add(key);
                    enhanceImpact(this.scene, pos.clone(), dir.clone().negate(), 'laser_bolt', 400);
                    impactCount++;
                    break; // 每步最多1次命中
                }
            }
        }

        // 5. 环绕螺旋雷电 (6条粗壮螺旋弧 — 极密集缠绕)
        for (let arc = 0; arc < 4; arc++) {
            const arcPoints = [];
            const arcOffset = arc * (Math.PI * 2 / 6);
            const spiralTightness = 12 + arc * 2; // 每条不同螺旋密度
            const baseRadius = 0.8 + arc * 0.3; // 每条不同半径 = 层次感
            for (let t = 0; t < 1; t += 0.015) { // 更密集的点 = 更长的弧
                const spiralAngle = t * Math.PI * spiralTightness + arcOffset;
                const radius = baseRadius + Math.sin(t * 20) * 0.3; // 半径波动 = 不规则
                const px = Math.cos(spiralAngle) * radius + (Math.random() - 0.5) * 0.2;
                const py = Math.sin(spiralAngle) * radius + (Math.random() - 0.5) * 0.2;
                const pz = t * 200;
                arcPoints.push(new THREE.Vector3(px, py, pz));
            }
            const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPoints);
            const arcColors = [0x88ffff, 0xffffff, 0xcc88ff, 0x44ffff, 0xffaaff, 0xaaeeff];
            const arcMat = new THREE.LineBasicMaterial({ color: arcColors[arc], transparent: true, opacity: 1.0 });
            const arcLine = new THREE.Line(arcGeo, arcMat);
            arcLine.position.copy(origin);
            arcLine.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
            this.scene.add(arcLine);

            // 雷电闪烁+抖动+消失
            const arcStart = performance.now();
            const updateArc = () => {
                const age = (performance.now() - arcStart) / 500; // 持续更久
                if (age > 1) { this.scene.remove(arcLine); arcGeo.dispose(); arcMat.dispose(); return; }
                arcLine.visible = Math.random() > 0.2; // 80%可见
                arcMat.opacity = (1 - age);
                // 每帧顶点剧烈抖动 (让雷电活着)
                const positions = arcGeo.attributes.position.array;
                for (let j = 0; j < positions.length; j += 3) {
                    positions[j] += (Math.random() - 0.5) * 0.15;
                    positions[j+1] += (Math.random() - 0.5) * 0.15;
                }
                arcGeo.attributes.position.needsUpdate = true;
                requestAnimationFrame(updateArc);
            };
            updateArc();
        }

        // 5.5 额外: 粗壮的内层雷电管道 (用Mesh模拟粗雷电)
        // 性能优化: 共享单一几何体和材质, 避免60次独立分配
        const _tubeSegGeo = new THREE.CylinderGeometry(0.08, 0.08, 1, 4); // 单位长度, 用scale.y缩放
        const _tubeSegMat = new THREE.MeshBasicMaterial({ color: 0x88ffff, transparent: true, opacity: 0.6 });
        for (let tube = 0; tube < 3; tube++) {
            const tubePoints = [];
            const tubeOffset = tube * (Math.PI * 2 / 3);
            for (let t = 0; t <= 1; t += 0.05) {
                const angle = t * Math.PI * 10 + tubeOffset;
                const r = 1.0 + Math.sin(t * 15) * 0.4;
                tubePoints.push(new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, t * 200));
            }
            // 用多段柱体连接点 (共享几何+材质)
            for (let p = 0; p < tubePoints.length - 1; p++) {
                const segLen = tubePoints[p].distanceTo(tubePoints[p+1]);
                const seg = new THREE.Mesh(_tubeSegGeo, _tubeSegMat);
                seg.scale.y = segLen;
                const mid = tubePoints[p].clone().add(tubePoints[p+1]).multiplyScalar(0.5);
                seg.position.copy(mid);
                seg.lookAt(tubePoints[p+1]);
                seg.rotateX(Math.PI / 2);
                beamContainer.add(seg);
            }
        }


        // 7. 径向十字架爆射 (instanced — 高性能)
        this._instParticles.spawnBurst('cross', origin, new THREE.Vector3(0,1,0), 15, 2.0, 30, 60, 0.4, 1.5, 3.0);
        this._instParticles.spawnBurst('crossH', origin, new THREE.Vector3(0,1,0), 15, 2.0, 30, 60, 0.4, 1.5, 3.0);

        // 8. 手部能量球 (发射点脉动球体 0.4秒)
        const orbGeo = new THREE.IcosahedronGeometry(0.4, 1);
        const orbMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
        const orb = new THREE.Mesh(orbGeo, orbMat);
        orb.position.copy(origin);
        this.scene.add(orb);
        const orbStart = performance.now();
        const updateOrb = () => {
            const age = (performance.now() - orbStart) / 400;
            if (age > 1) { this.scene.remove(orb); orb.geometry.dispose(); orbMat.dispose(); return; }
            const pulse = 1 + Math.sin(age * 30) * 0.3;
            orb.scale.setScalar(pulse * (1 - age) * 2);
            orbMat.opacity = (1 - age) * 0.8;
            orb.rotation.x += 0.2;
            orb.rotation.y += 0.3;
            requestAnimationFrame(updateOrb);
        };
        updateOrb();

        // 9. 光束抖动+淡出 (0.4秒)
        const startTime = performance.now();
        const updateBeam = () => {
            const t = (performance.now() - startTime) / 400;
            if (t > 1) { beamContainer.traverse(c => { if(c.geometry) c.geometry.dispose(); if(c.material) c.material.dispose(); }); this.scene.remove(beamContainer); return; }
            beamContainer.position.copy(origin).add(new THREE.Vector3((Math.random()-0.5)*0.3,(Math.random()-0.5)*0.3,(Math.random()-0.5)*0.3));
            beamContainer.scale.x = (1 - t) * (1 + Math.sin(performance.now() * 0.05) * 0.2);
            beamContainer.scale.z = beamContainer.scale.x;
            requestAnimationFrame(updateBeam);
        };
        updateBeam();

        // 6. 最极端反馈
        this.handModel.recoil(1.5);
        this.triggerShake(1.5, 0.5);
        this.triggerFlash('rgba(160, 0, 255, 0.8)', 1, 0.4);
        if (this.setFovOffset) this.setFovOffset(60);
        if (window.__juice) {
            window.__juice.hitStop(8);
            window.__juice.cameraImpulse(dir.clone().negate(), 1.2);
            window.__juice.whiteout(0.7);
            window.__juice.chromaticAberration(0.9);
            window.__juice.radialDistortion(0.8);
            window.__juice.invertFlash(0.5);
        }

        this._playUltimateSound();
    }

    // ==========================================
    // 视觉: 6针环
    // ==========================================

    _initNeedleRing() {
        // 扁平剑刃形法术刺 (像参考图: 清晰的2D blade silhouette)
        // 关键: 扁平! 宽但薄, 像一把匕首/短剑
        const bladeGeo = new THREE.BufferGeometry();
        const v = new Float32Array([
            // 极尖前端
            0, 0, -0.9,           // 0: 尖端
            // 刀刃展开 (扁平, x方向宽, y方向极薄)
            -0.04, 0.005, -0.5,   // 1: 左刃上
            0.04, 0.005, -0.5,    // 2: 右刃上
            -0.04, -0.005, -0.5,  // 3: 左刃下
            0.04, -0.005, -0.5,   // 4: 右刃下
            // 最宽处 (中段)
            -0.055, 0.005, -0.25, // 5: 左最宽上
            0.055, 0.005, -0.25,  // 6: 右最宽上
            -0.055, -0.005, -0.25,// 7: 左最宽下
            0.055, -0.005, -0.25, // 8: 右最宽下
            // 收束到握柄
            -0.02, 0.005, 0.05,   // 9: 左收束上
            0.02, 0.005, 0.05,    // 10: 右收束上
            -0.02, -0.005, 0.05,  // 11: 左收束下
            0.02, -0.005, 0.05,   // 12: 右收束下
            // 尾端
            0, 0, 0.15,           // 13: 尾尖
        ]);
        const idx = [
            // 尖端到刀刃 (上面)
            0,1,2,
            // 尖端到刀刃 (下面)
            0,4,3,
            // 刀刃到中段 (上面)
            1,5,6, 1,6,2,
            // 刀刃到中段 (下面)
            3,8,7, 3,4,8,
            // 侧面连接 (左)
            1,7,5, 1,3,7,
            // 侧面连接 (右)
            2,6,8, 2,8,4,
            // 中段到收束 (上)
            5,9,10, 5,10,6,
            // 中段到收束 (下)
            7,12,11, 7,8,12,
            // 侧面 (左)
            5,11,9, 5,7,11,
            // 侧面 (右)
            6,10,12, 6,12,8,
            // 收束到尾 (上)
            9,13,10,
            // 收束到尾 (下)
            11,10,13, 11,13,12,
            // 补面
            9,11,13, 10,13,12,
        ];
        bladeGeo.setAttribute('position', new THREE.BufferAttribute(v, 3));
        bladeGeo.setIndex(idx);
        bladeGeo.computeVertexNormals();

        // 无底座环 — 只有刺 + 底部小圆环装饰
        this._baseRing = null;
        this._innerRing = null;

        for (let i = 0; i < 6; i++) {
            const group = new THREE.Group();

            // 主刀刃体 (亮紫/洋红)
            const mat = new THREE.MeshBasicMaterial({ color: 0xcc44ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
            const blade = new THREE.Mesh(bladeGeo, mat);
            group.add(blade);

            // 边缘线 (暗紫轮廓)
            const edges = new THREE.EdgesGeometry(bladeGeo);
            const edgeLine = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x6600aa, transparent: true, opacity: 0.7 }));
            group.add(edgeLine);

            // 底部圆形符文装饰 (每根刺底部一个小金环)
            const dotGeo = new THREE.RingGeometry(0.025, 0.035, 12);
            const dotMat = new THREE.MeshBasicMaterial({ color: 0xaa8833, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
            const dot = new THREE.Mesh(dotGeo, dotMat);
            dot.position.z = 0.15;
            group.add(dot);

            this._needleMeshes.push({ group, mat });
            this._needleRingGroup.add(group);
        }

        // 挂在手腕上
        this._needleRingGroup.position.set(0, 0, 0.1);
        this.handModel.handGroup.add(this._needleRingGroup);
    }

    _updateNeedleRing(dt) {
        this._needleRotation += dt * 0.8; // 缓慢顺时针旋转

        const radius = 0.14;
        for (let i = 0; i < 6; i++) {
            const angle = this._needleRotation + (i / 6) * Math.PI * 2;
            const { group, mat } = this._needleMeshes[i];

            // 环形排列
            group.position.set(
                Math.cos(angle) * radius,
                Math.sin(angle) * radius,
                0
            );

            // 统一朝前上方倾斜 (像展开的翅膀/扇形)
            group.rotation.set(-0.4, 0, 0);

            // 可见性
            group.visible = i < this.needles;

            // 蓄力点亮
            if (this._rmbCharging && i < this._rmbChargeCount) {
                mat.color.setHex(0xffffff);
                mat.opacity = 1.0;
                group.scale.set(0.75, 0.75, 0.85);
            } else if (i < this.needles) {
                mat.color.setHex(0xcc44ff);
                mat.opacity = 0.85 + Math.sin(performance.now() * 0.003 + i * 1.2) * 0.1;
                group.scale.set(0.6, 0.6, 0.6);
            }
        }
    }

    // ==========================================
    // 音效
    // ==========================================

    _createNoiseBuffer() {
        const size = 44100;
        const buffer = this.audioCtx.createBuffer(1, size, this.audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
        return buffer;
    }

    _playShotgunSound() {
        if (this.audioCtx.state === 'suspended') return;
        const t = this.audioCtx.currentTime;

        const osc = this.audioCtx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(600, t);
        osc.frequency.exponentialRampToValueAtTime(80, t + 0.1);
        const g = this.audioCtx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.9, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.12);
        osc.connect(g); g.connect(this.compressor);
        osc.start(t); osc.stop(t + 0.15);

        const noise = this.audioCtx.createBufferSource();
        noise.buffer = this._noiseBuffer;
        const nf = this.audioCtx.createBiquadFilter();
        nf.type = 'bandpass'; nf.frequency.value = 3000; nf.Q.value = 2;
        const ng = this.audioCtx.createGain();
        ng.gain.setValueAtTime(0.6, t);
        ng.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
        noise.connect(nf); nf.connect(ng); ng.connect(this.compressor);
        noise.start(t); noise.stop(t + 0.1);
    }

    _playNeedleSound() {
        if (this.audioCtx.state === 'suspended') return;
        const t = this.audioCtx.currentTime;
        const osc = this.audioCtx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1500, t);
        osc.frequency.exponentialRampToValueAtTime(400, t + 0.08);
        const g = this.audioCtx.createGain();
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
        osc.connect(g); g.connect(this.compressor);
        osc.start(t); osc.stop(t + 0.12);
    }

    _playChargeTickSound(count) {
        if (this.audioCtx.state === 'suspended') return;
        const t = this.audioCtx.currentTime;
        const osc = this.audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 300 + count * 100; // 越亮越高
        const g = this.audioCtx.createGain();
        g.gain.setValueAtTime(0.3, t);
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
        osc.connect(g); g.connect(this.compressor);
        osc.start(t); osc.stop(t + 0.06);
    }

    _playUltimateSound() {
        if (this.audioCtx.state === 'suspended') return;
        const t = this.audioCtx.currentTime;

        // 极低频boom
        const sub = this.audioCtx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(50, t);
        sub.frequency.exponentialRampToValueAtTime(15, t + 0.5);
        const sg = this.audioCtx.createGain();
        sg.gain.setValueAtTime(0, t);
        sg.gain.linearRampToValueAtTime(2.0, t + 0.01);
        sg.gain.exponentialRampToValueAtTime(0.01, t + 0.6);
        sub.connect(sg); sg.connect(this.compressor);
        sub.start(t); sub.stop(t + 0.7);

        // 高频crack
        const noise = this.audioCtx.createBufferSource();
        noise.buffer = this._noiseBuffer;
        const ng = this.audioCtx.createGain();
        ng.gain.setValueAtTime(1.0, t);
        ng.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
        noise.connect(ng); ng.connect(this.compressor);
        noise.start(t); noise.stop(t + 0.1);

        // 中频sustain
        const mid = this.audioCtx.createOscillator();
        mid.type = 'sawtooth';
        mid.frequency.setValueAtTime(200, t);
        mid.frequency.exponentialRampToValueAtTime(60, t + 0.3);
        const mg = this.audioCtx.createGain();
        mg.gain.setValueAtTime(0.6, t);
        mg.gain.exponentialRampToValueAtTime(0.01, t + 0.35);
        mid.connect(mg); mg.connect(this.compressor);
        mid.start(t); mid.stop(t + 0.4);
    }

    _startStreamSound() {
        if (this.audioCtx.state === 'suspended') return;
        if (this._streamOsc) return;
        const t = this.audioCtx.currentTime;

        this._streamOsc = this.audioCtx.createOscillator();
        this._streamOsc.type = 'sawtooth';
        this._streamOsc.frequency.value = 180;

        const lfo = this.audioCtx.createOscillator();
        lfo.type = 'sine'; lfo.frequency.value = 12;
        const lg = this.audioCtx.createGain(); lg.gain.value = 25;
        lfo.connect(lg); lg.connect(this._streamOsc.frequency);
        lfo.start(t);
        this._streamLfo = lfo;

        this._streamGain = this.audioCtx.createGain();
        this._streamGain.gain.setValueAtTime(0, t);
        this._streamGain.gain.linearRampToValueAtTime(0.2, t + 0.1);

        this._streamOsc.connect(this._streamGain);
        this._streamGain.connect(this.compressor);
        this._streamOsc.start(t);
    }

    _stopStreamSound() {
        if (!this._streamOsc) return;
        const t = this.audioCtx.currentTime;
        this._streamGain.gain.linearRampToValueAtTime(0, t + 0.05);
        this._streamOsc.stop(t + 0.1);
        this._streamLfo.stop(t + 0.1);
        this._streamOsc = null;
        this._streamGain = null;
        this._streamLfo = null;
    }

    dispose() {
        this._stopStreamSound();
        for (const n of this._flyingNeedles) this.scene.remove(n.mesh); if(n.mesh.geometry) n.mesh.geometry.dispose(); if(n.mesh.material) n.mesh.material.dispose();
        for (const p of this._crossParticles) this.scene.remove(p.mesh); if(p.mesh.geometry) p.mesh.geometry.dispose();
        this.scene.remove(this._needleRingGroup);
    }
}
