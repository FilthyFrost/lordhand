/**
 * HAND-MODEL.JS — 程序化3D骨骼手
 *
 * 职责:
 * - 程序化构建低多边形chrome骨骼手 (< 200 triangles)
 * - 附着在camera子对象上 (FPS视角)
 * - 根据法术状态播放程序化动画
 * - 切换法术时改变手部发光色
 *
 * 结构:
 * - 手掌: 扁平六边形
 * - 5根手指, 每根3段 (掌骨/指骨/指尖)
 * - 掌心: 六边形"魔力核心"发光体
 * - 指尖: 小锥体作为"匕首发射口"
 *
 * 美术风格:
 * - Liquid chrome / molten metallic
 * - 骨骼感, 细长, 锋利
 * - MeshBasicMaterial only (0xcccccc chrome白)
 */

const THREE = window.THREE;

// 手指骨骼定义
const FINGER_DEFS = [
    { name: 'thumb',  basePos: [-0.12, -0.02, -0.05], angles: [0.4, 0.3, 0.2], lengths: [0.06, 0.05, 0.04], spread: -0.5 },
    { name: 'index',  basePos: [-0.06, 0.04, -0.08],  angles: [0.1, 0.1, 0.05], lengths: [0.08, 0.06, 0.05], spread: -0.15 },
    { name: 'middle', basePos: [0.0, 0.05, -0.09],    angles: [0.05, 0.05, 0.03], lengths: [0.09, 0.07, 0.05], spread: 0 },
    { name: 'ring',   basePos: [0.06, 0.04, -0.08],   angles: [0.1, 0.1, 0.05], lengths: [0.08, 0.06, 0.05], spread: 0.12 },
    { name: 'pinky',  basePos: [0.11, 0.02, -0.06],   angles: [0.15, 0.15, 0.1], lengths: [0.06, 0.05, 0.04], spread: 0.25 },
];

// 动画状态目标值
const ANIM_TARGETS = {
    idle:    { curl: 0.3, spread: 0, coreGlow: 0.3, recoil: 0, tremble: 0 },
    fire:    { curl: 0.0, spread: 0.4, coreGlow: 1.0, recoil: 0.08, tremble: 0 },
    stream:  { curl: 0.1, spread: 0.3, coreGlow: 0.7, tremble: 0.003, recoil: 0 },
    charge:  { curl: 0.8, spread: -0.1, coreGlow: 0, recoil: -0.02, tremble: 0 },
    release: { curl: 0.0, spread: 0.6, coreGlow: 1.5, recoil: 0.12, tremble: 0.005 },
};

export class HandModel {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     */
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;

        // 手的根Group, 作为camera的子对象
        this.handGroup = new THREE.Group();
        // 手的基础位置 (右手, 屏幕中央偏右下)
        this.handGroup.position.set(0.15, -0.2, -0.4);
        this.handGroup.rotation.set(0.1, -0.1, 0);
        this.camera.add(this.handGroup);
        this.scene.add(this.camera); // 确保camera在scene中(需要children渲染)

        // 手指骨骼引用 (用于动画)
        this.fingers = []; // [{segments: [mesh, mesh, mesh], joints: [group, group, group]}]

        // 魔力核心
        this.core = null;
        this.coreMat = null;

        // 当前动画状态
        this._animState = {
            curl: 0.3,
            spread: 0,
            coreGlow: 0.3,
            recoil: 0,
            tremble: 0,
        };
        this._targetState = 'idle';

        // 充能进度 (0-1)
        this._chargeProgress = 0;

        // 当前法术颜色
        this._spellColor = 0x00ffff;

        // 构建几何体
        this._buildHand();
    }

    /**
     * 构建手部几何体
     */
    _buildHand() {
        // 手掌 - 扁平的不规则六边形
        const palmGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.015, 6);
        palmGeo.rotateX(Math.PI / 2);
        const palmMat = new THREE.MeshBasicMaterial({ color: 0xcccccc });
        const palm = new THREE.Mesh(palmGeo, palmMat);
        palm.position.set(0, 0, 0);
        this.handGroup.add(palm);

        // 手腕连接 - 窄骨
        const wristGeo = new THREE.BoxGeometry(0.06, 0.012, 0.08);
        const wristMat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa });
        const wrist = new THREE.Mesh(wristGeo, wristMat);
        wrist.position.set(0, 0, 0.06);
        this.handGroup.add(wrist);

        // 掌心魔力核心
        const coreGeo = new THREE.OctahedronGeometry(0.025, 0);
        this.coreMat = new THREE.MeshBasicMaterial({ color: this._spellColor });
        this.core = new THREE.Mesh(coreGeo, this.coreMat);
        this.core.position.set(0, 0.015, -0.01);
        this.handGroup.add(this.core);

        // 构建5根手指
        for (const def of FINGER_DEFS) {
            this._buildFinger(def);
        }

        // 边缘线 (增强lowpoly感)
        this._addEdgeLines(palm, palmGeo);
    }

    /**
     * 构建单根手指 (3段骨骼链)
     */
    _buildFinger(def) {
        const finger = { segments: [], joints: [] };

        let parent = this.handGroup;
        let prevPos = new THREE.Vector3(...def.basePos);

        for (let i = 0; i < 3; i++) {
            const length = def.lengths[i];
            const width = 0.015 - i * 0.003; // 越往指尖越细

            // 关节Group (用于旋转)
            const joint = new THREE.Group();
            joint.position.copy(prevPos);
            parent.add(joint);

            // 骨骼段Mesh
            const segGeo = new THREE.BoxGeometry(width, width * 0.8, length);
            const segMat = new THREE.MeshBasicMaterial({
                color: i === 2 ? 0xdddddd : 0xbbbbbb
            });
            const seg = new THREE.Mesh(segGeo, segMat);
            seg.position.set(0, 0, -length / 2);
            joint.add(seg);

            // 指尖锥体 (最后一段)
            if (i === 2) {
                const tipGeo = new THREE.ConeGeometry(0.008, 0.03, 4);
                tipGeo.rotateX(-Math.PI / 2);
                const tipMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
                const tip = new THREE.Mesh(tipGeo, tipMat);
                tip.position.set(0, 0, -length / 2 - 0.015);
                joint.add(tip);
            }

            // 边缘线
            this._addEdgeLines(seg, segGeo);

            finger.segments.push(seg);
            finger.joints.push(joint);

            // 下一段的起点是这一段的末端
            prevPos = new THREE.Vector3(0, 0, -length);
            parent = joint;
        }

        this.fingers.push(finger);
    }

    /**
     * 添加边缘线
     */
    _addEdgeLines(mesh, geo) {
        const edges = new THREE.EdgesGeometry(geo);
        const line = new THREE.LineSegments(edges,
            new THREE.LineBasicMaterial({ color: 0x333333 })
        );
        mesh.add(line);
    }

    /**
     * 每帧更新
     * @param {number} dt
     * @param {string} spellState - 'idle'|'fire'|'stream'|'charge'|'release'
     */
    update(dt, spellState) {
        this._targetState = spellState || 'idle';
        const target = ANIM_TARGETS[this._targetState] || ANIM_TARGETS.idle;

        // 平滑插值到目标状态
        const lerpSpeed = this._targetState === 'fire' ? 25 : 8;
        this._animState.curl = THREE.MathUtils.lerp(this._animState.curl, target.curl, dt * lerpSpeed);
        this._animState.spread = THREE.MathUtils.lerp(this._animState.spread, target.spread, dt * lerpSpeed);
        this._animState.coreGlow = THREE.MathUtils.lerp(this._animState.coreGlow, target.coreGlow, dt * lerpSpeed);
        this._animState.recoil = THREE.MathUtils.lerp(this._animState.recoil, target.recoil, dt * 15);
        this._animState.tremble = THREE.MathUtils.lerp(this._animState.tremble, target.tremble, dt * 10);

        // 充能进度
        if (this._targetState === 'charge') {
            this._chargeProgress = Math.min(this._chargeProgress + dt * 0.8, 1.0);
        } else {
            this._chargeProgress = Math.max(this._chargeProgress - dt * 3, 0);
        }

        // 应用手指动画
        this._animateFingers(dt);

        // 应用核心发光
        this._animateCore(dt);

        // 应用后坐力
        this._applyRecoil(dt);

        // 应用呼吸/颤抖
        this._applyTremble(dt);
    }

    /**
     * 手指弯曲动画
     */
    _animateFingers(dt) {
        const curl = this._animState.curl;
        const spread = this._animState.spread;

        for (let f = 0; f < this.fingers.length; f++) {
            const finger = this.fingers[f];
            const def = FINGER_DEFS[f];

            for (let j = 0; j < finger.joints.length; j++) {
                const joint = finger.joints[j];

                // 弯曲: 每段旋转X轴
                const baseCurl = def.angles[j];
                const targetRot = baseCurl + curl * (0.8 + j * 0.4);
                joint.rotation.x = THREE.MathUtils.lerp(joint.rotation.x, targetRot, dt * 12);

                // 展开: 根关节旋转Y轴
                if (j === 0) {
                    const targetSpread = def.spread + spread * def.spread * 2;
                    joint.rotation.y = THREE.MathUtils.lerp(joint.rotation.y, targetSpread, dt * 10);
                }
            }
        }
    }

    /**
     * 核心发光动画
     */
    _animateCore(dt) {
        const glow = this._animState.coreGlow;

        // 缩放呼吸
        const baseScale = 0.8 + glow * 0.8;
        const pulse = Math.sin(performance.now() * 0.008) * 0.1 * glow;
        this.core.scale.setScalar(baseScale + pulse);

        // 充能时核心颜色变亮 (白色混合)
        if (this._chargeProgress > 0) {
            const c = new THREE.Color(this._spellColor);
            c.lerp(new THREE.Color(0xffffff), this._chargeProgress * 0.6);
            this.coreMat.color.copy(c);
        } else {
            this.coreMat.color.setHex(this._spellColor);
        }

        // 旋转核心
        this.core.rotation.y += dt * (2 + glow * 5);
        this.core.rotation.x += dt * 1.5;
    }

    /**
     * 后坐力
     */
    _applyRecoil(dt) {
        const recoil = this._animState.recoil;
        // 手向后/向上弹
        this.handGroup.position.z = -0.4 + recoil;
        this.handGroup.position.y = -0.2 + recoil * 0.3;
        // 手腕旋转
        this.handGroup.rotation.x = 0.1 - recoil * 2;
    }

    /**
     * 颤抖效果 (stream/release时)
     */
    _applyTremble(dt) {
        const tremble = this._animState.tremble;
        if (tremble > 0.0001) {
            this.handGroup.position.x = 0.15 + (Math.random() - 0.5) * tremble;
            this.handGroup.position.y += (Math.random() - 0.5) * tremble;
        }
    }

    /**
     * 外部触发后坐力 (spell模块调用)
     * @param {number} intensity - 0-1
     */
    recoil(intensity) {
        this._animState.recoil = intensity * 0.12;
    }

    /**
     * 切换法术时改变发光颜色
     * @param {number} colorHex
     */
    setSpellColor(colorHex) {
        this._spellColor = colorHex;
        this.coreMat.color.setHex(colorHex);
    }

    /**
     * 获取指尖发射位置 (世界坐标)
     * 用于弹丸发射起点
     */
    getFireOrigin() {
        // 中指尖端的世界位置
        if (this.fingers[2] && this.fingers[2].joints[2]) {
            const tip = this.fingers[2].joints[2];
            const worldPos = new THREE.Vector3();
            tip.getWorldPosition(worldPos);
            return worldPos;
        }
        // fallback: camera前方
        const pos = this.camera.position.clone();
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        return pos.addScaledVector(dir, 0.5);
    }

    /**
     * 获取发射方向 (camera前方)
     */
    getFireDirection() {
        const dir = new THREE.Vector3(0, 0, -1);
        dir.applyQuaternion(this.camera.quaternion);
        return dir.normalize();
    }

    /**
     * 销毁
     */
    dispose() {
        this.camera.remove(this.handGroup);
    }
}
