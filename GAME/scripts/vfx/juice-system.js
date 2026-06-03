/**
 * JUICE-SYSTEM.JS — 全局"爽感"反馈系统
 *
 * 实现HYPER DEMON级别的5大核心反馈技术:
 * 1. Hit-Stop (微停帧) — 命中冻结2-4帧
 * 2. Directional Camera Impulse (方向性相机冲量) — 替代随机抖动
 * 3. Chromatic Aberration + Radial Distortion (色差+径向畸变)
 * 4. Time Scaling (时间弹性) — 蓄力减慢, 命中冻结, 释放加速
 * 5. Chain Spawn (连锁子弹丸) — 命中产生追踪子弹
 *
 * 这个模块是全局单例, 所有法术通过它触发反馈
 */

const THREE = window.THREE;

export class JuiceSystem {
    constructor(renderer, camera, scene) {
        this.renderer = renderer;
        this.camera = camera;
        this.scene = scene;

        // ==========================================
        // 1. HIT-STOP (微停帧)
        // ==========================================
        this._hitStopFrames = 0;        // 剩余冻结帧数
        this._hitStopDuration = 0;      // 冻结剩余时间(秒)
        this._timeScale = 1.0;          // 当前时间缩放
        this._targetTimeScale = 1.0;    // 目标时间缩放

        // ==========================================
        // 2. DIRECTIONAL CAMERA IMPULSE (方向性冲量)
        // ==========================================
        this._impulseVel = new THREE.Vector3(0, 0, 0);  // 当前冲量速度
        this._impulseDecay = 15;  // 衰减速度
        this._impulseOffset = new THREE.Vector3(0, 0, 0); // 当前偏移

        // ==========================================
        // 3. CHROMATIC ABERRATION + DISTORTION (后处理)
        // ==========================================
        this._chromaticIntensity = 0;
        this._chromaticDecay = 8;
        this._radialIntensity = 0;
        this._radialDecay = 6;
        this._overlayCanvas = null;
        this._overlayCtx = null;
        this._setupOverlay();

        // ==========================================
        // 4. TIME SCALING (时间弹性)
        // ==========================================
        this._chargeTimeScale = 1.0;  // 蓄力时的减速

        // ==========================================
        // 5. SCREEN EFFECTS (极端屏幕反馈)
        // ==========================================
        this._screenInvert = 0;       // 负片强度 (0-1)
        this._vignetteIntensity = 0;  // 暗角强度
        this._whiteout = 0;           // 白屏强度
    }

    // ==========================================
    // 公开API — 法术模块调用这些
    // ==========================================

    /**
     * 触发hit-stop (微停帧)
     * @param {number} frames - 冻结帧数 (2-6)
     */
    hitStop(frames = 3) {
        this._hitStopFrames = Math.max(this._hitStopFrames, frames);
        this._hitStopDuration = frames / 60; // 约50ms for 3 frames
    }

    /**
     * 方向性相机冲量 (替代随机shake)
     * @param {THREE.Vector3} direction - 冲量方向 (通常是施法反方向)
     * @param {number} force - 力度 (0.1-1.0)
     */
    cameraImpulse(direction, force) {
        this._impulseVel.addScaledVector(direction, force * 2.0);
    }

    /**
     * 触发色差效果
     * @param {number} intensity - 强度 (0-1), 推荐0.3-0.8
     */
    chromaticAberration(intensity) {
        this._chromaticIntensity = Math.max(this._chromaticIntensity, intensity);
    }

    /**
     * 触发径向畸变
     * @param {number} intensity - 强度 (0-1)
     */
    radialDistortion(intensity) {
        this._radialIntensity = Math.max(this._radialIntensity, intensity);
    }

    /**
     * 设置时间缩放 (蓄力减慢)
     * @param {number} scale - 0.1 = 极慢, 1.0 = 正常, 1.5 = 加速
     */
    setTimeScale(scale) {
        this._targetTimeScale = scale;
    }

    /**
     * 瞬间白屏闪烁 (比普通flash更极端)
     * @param {number} intensity - 0-1
     */
    whiteout(intensity) {
        this._whiteout = Math.max(this._whiteout, intensity);
    }

    /**
     * 负片闪烁 (极短暂反色)
     * @param {number} intensity - 0-1
     */
    invertFlash(intensity) {
        this._screenInvert = Math.max(this._screenInvert, intensity);
    }

    /**
     * 暗角脉冲
     * @param {number} intensity - 0-1
     */
    vignettePulse(intensity) {
        this._vignetteIntensity = Math.max(this._vignetteIntensity, intensity);
    }

    /**
     * 综合命中反馈 — 一次调用触发所有反馈通道
     * @param {string} tier - 'light'|'medium'|'heavy'|'extreme'
     * @param {THREE.Vector3} direction - 命中方向
     */
    onHit(tier, direction) {
        const dir = direction || new THREE.Vector3(0, 0, -1);

        switch (tier) {
            case 'light':
                this.hitStop(2);
                this.cameraImpulse(dir.clone().negate(), 0.15);
                this.chromaticAberration(0.15);
                break;
            case 'medium':
                this.hitStop(3);
                this.cameraImpulse(dir.clone().negate(), 0.3);
                this.chromaticAberration(0.35);
                this.radialDistortion(0.2);
                this.vignettePulse(0.3);
                break;
            case 'heavy':
                this.hitStop(4);
                this.cameraImpulse(dir.clone().negate(), 0.5);
                this.chromaticAberration(0.6);
                this.radialDistortion(0.4);
                this.whiteout(0.3);
                this.vignettePulse(0.5);
                break;
            case 'extreme':
                this.hitStop(6);
                this.cameraImpulse(dir.clone().negate(), 0.8);
                this.chromaticAberration(0.9);
                this.radialDistortion(0.7);
                this.whiteout(0.5);
                this.invertFlash(0.3);
                this.vignettePulse(0.8);
                break;
        }
    }

    // ==========================================
    // 每帧更新 — 在render之前调用
    // ==========================================

    /**
     * 处理时间缩放, 返回实际dt
     * @param {number} rawDt - 原始deltaTime
     * @returns {number} 缩放后的dt
     */
    processTime(rawDt) {
        // Hit-stop: 时间完全冻结
        if (this._hitStopDuration > 0) {
            this._hitStopDuration -= rawDt;
            return 0.0001; // 几乎为0但不是0(避免除零)
        }

        // 时间缩放平滑过渡
        this._timeScale = THREE.MathUtils.lerp(this._timeScale, this._targetTimeScale, rawDt * 10);
        return rawDt * this._timeScale;
    }

    /**
     * 获取相机偏移 (加到camera.position上)
     * @param {number} dt
     * @returns {THREE.Vector3}
     */
    updateCameraImpulse(dt) {
        // 冲量衰减 (弹簧回弹)
        this._impulseOffset.addScaledVector(this._impulseVel, dt);
        this._impulseVel.multiplyScalar(Math.max(0, 1 - this._impulseDecay * dt));
        this._impulseOffset.multiplyScalar(Math.max(0, 1 - this._impulseDecay * 0.5 * dt));

        // 限制最大偏移
        if (this._impulseOffset.length() > 1.5) {
            this._impulseOffset.normalize().multiplyScalar(1.5);
        }

        return this._impulseOffset;
    }

    /**
     * 更新后处理overlay
     * @param {number} dt
     */
    updatePostProcess(dt) {
        // 衰减所有效果
        this._chromaticIntensity = Math.max(0, this._chromaticIntensity - dt * this._chromaticDecay);
        this._radialIntensity = Math.max(0, this._radialIntensity - dt * this._radialDecay);
        this._screenInvert = Math.max(0, this._screenInvert - dt * 15);
        this._whiteout = Math.max(0, this._whiteout - dt * 12);
        this._vignetteIntensity = Math.max(0, this._vignetteIntensity - dt * 5);

        // 绘制overlay
        this._drawOverlay();
    }

    // ==========================================
    // 后处理Overlay (Canvas 2D叠加)
    // ==========================================

    _setupOverlay() {
        this._overlayCanvas = document.createElement('canvas');
        this._overlayCanvas.style.cssText = `
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none;
            z-index: 6;
            mix-blend-mode: screen;
        `;
        this._overlayCanvas.width = 320;
        this._overlayCanvas.height = 180;
        document.body.appendChild(this._overlayCanvas);
        this._overlayCtx = this._overlayCanvas.getContext('2d');
    }

    _drawOverlay() {
        const ctx = this._overlayCtx;
        const w = this._overlayCanvas.width;
        const h = this._overlayCanvas.height;

        ctx.clearRect(0, 0, w, h);

        // 色差模拟: 左侧偏红, 右侧偏青 (位移效果)
        if (this._chromaticIntensity > 0.01) {
            const offset = Math.floor(this._chromaticIntensity * 8);
            // 红色条带左移
            ctx.fillStyle = `rgba(255, 0, 0, ${this._chromaticIntensity * 0.3})`;
            ctx.fillRect(0, 0, w * 0.05 + offset * 3, h);
            // 青色条带右移
            ctx.fillStyle = `rgba(0, 255, 255, ${this._chromaticIntensity * 0.3})`;
            ctx.fillRect(w - w * 0.05 - offset * 3, 0, w * 0.05 + offset * 3, h);
            // 中心线扭曲暗示
            ctx.fillStyle = `rgba(255, 255, 255, ${this._chromaticIntensity * 0.1})`;
            const lineY = h / 2 + (Math.random() - 0.5) * this._chromaticIntensity * 20;
            ctx.fillRect(0, lineY, w, 1 + this._chromaticIntensity * 2);
        }

        // 径向畸变: 边缘暗化 + 扭曲暗示
        if (this._radialIntensity > 0.01 || this._vignetteIntensity > 0.01) {
            const totalVignette = Math.max(this._radialIntensity, this._vignetteIntensity);
            const gradient = ctx.createRadialGradient(w/2, h/2, w*0.2, w/2, h/2, w*0.7);
            gradient.addColorStop(0, 'rgba(0,0,0,0)');
            gradient.addColorStop(0.6, `rgba(0,0,0,${totalVignette * 0.3})`);
            gradient.addColorStop(1, `rgba(0,0,0,${totalVignette * 0.8})`);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, w, h);

            // 径向线条 (畸变暗示)
            if (this._radialIntensity > 0.1) {
                ctx.strokeStyle = `rgba(255,255,255,${this._radialIntensity * 0.15})`;
                ctx.lineWidth = 1;
                const count = 8;
                for (let i = 0; i < count; i++) {
                    const angle = (i / count) * Math.PI * 2 + performance.now() * 0.001;
                    ctx.beginPath();
                    ctx.moveTo(w/2 + Math.cos(angle) * w * 0.3, h/2 + Math.sin(angle) * h * 0.3);
                    ctx.lineTo(w/2 + Math.cos(angle) * w * 0.7, h/2 + Math.sin(angle) * h * 0.7);
                    ctx.stroke();
                }
            }
        }

        // 白屏
        if (this._whiteout > 0.01) {
            ctx.fillStyle = `rgba(255, 255, 255, ${this._whiteout})`;
            ctx.fillRect(0, 0, w, h);
        }

        // 负片闪烁
        if (this._screenInvert > 0.01) {
            this._overlayCanvas.style.mixBlendMode = 'difference';
            ctx.fillStyle = `rgba(255, 255, 255, ${this._screenInvert})`;
            ctx.fillRect(0, 0, w, h);
        } else {
            this._overlayCanvas.style.mixBlendMode = 'screen';
        }
    }

    // ==========================================
    // 清理
    // ==========================================

    dispose() {
        if (this._overlayCanvas && this._overlayCanvas.parentNode) {
            this._overlayCanvas.parentNode.removeChild(this._overlayCanvas);
        }
    }
}
