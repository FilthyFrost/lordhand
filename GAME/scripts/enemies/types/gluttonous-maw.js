/**
 * GLUTTONOUS MAW — 暴食巨口
 * 简化版: 纯直冲玩家, 只保留模型+嘴动画
 */

const THREE = window.THREE;
import { DemonBase, DemonState } from '../demon-base.js';

export class DemonGluttonousMaw extends DemonBase {
    constructor(scene, position, config = {}) {
        super(scene, position, {
            hp: config.hp || 160,
            speed: config.speed || 18,
            size: new THREE.Vector3(3.5, 3, 3.5),
            attackRange: 2,
            attackDamage: 4,
            name: 'GLUTTONOUS MAW',
            colliders: null, // 浮空
            ...config,
        });
        this._time = Math.random() * 100;
    }

    buildModel() {
        const matGum = new THREE.MeshBasicMaterial({ color: 0x881111, side: THREE.DoubleSide });
        const matTooth = new THREE.MeshBasicMaterial({ color: 0xddcc99 });
        const matToothRoot = new THREE.MeshBasicMaterial({ color: 0x775533 });
        const matThroat = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide });
        const matGlow = new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.5 });

        this._topJaw = this._buildJaw(true, matGum, matTooth, matToothRoot, matThroat);
        this.group.add(this._topJaw);
        this._bottomJaw = this._buildJaw(false, matGum, matTooth, matToothRoot, matThroat);
        this.group.add(this._bottomJaw);

        const glow = new THREE.Mesh(new THREE.SphereGeometry(1.5, 6, 6), matGlow);
        glow.position.set(0, 0, -2.5);
        glow.scale.set(1.2, 0.6, 1);
        this.group.add(glow);

        this.group.scale.set(0.7, 0.7, 0.7);
    }

    _buildJaw(isTop, matGum, matTooth, matToothRoot, matThroat) {
        const jawGroup = new THREE.Group();
        const sign = isTop ? 1 : -1;
        const jawRadius = 4.0;

        const gumSegs = 30;
        for (let i = 0; i <= gumSegs; i++) {
            const angle = (i / gumSegs) * Math.PI;
            const thickness = 1.0 + Math.sin(angle) * 0.5 + Math.sin(angle * 15) * 0.2;
            const g = new THREE.Mesh(new THREE.SphereGeometry(1, 5, 5), matGum);
            g.scale.set(thickness, 0.7, thickness);
            g.position.set(Math.cos(angle) * jawRadius, sign * 0.2, -Math.sin(angle) * jawRadius * 0.8);
            g.rotation.set(Math.PI / 2, angle, 0);
            jawGroup.add(g);
        }

        for (let i = 0; i <= 14; i++) {
            const angle = (i / 14) * Math.PI;
            const isFront = (i > 4 && i < 10);
            const isCanine = (i === 3 || i === 4 || i === 10 || i === 11);
            let geo, cHeight = 1.5 + Math.random() * 0.5;
            if (isFront) geo = new THREE.BoxGeometry(0.7, cHeight, 0.4);
            else if (isCanine) { geo = new THREE.ConeGeometry(0.35, cHeight * 1.3, 4); cHeight *= 1.3; }
            else geo = new THREE.CylinderGeometry(0.4, 0.4, cHeight * 0.7, 4);
            const tooth = new THREE.Mesh(geo, matTooth);
            const r = jawRadius - 0.3;
            tooth.position.set(Math.cos(angle) * r, sign * (cHeight / 2 + 0.3), -Math.sin(angle) * r * 0.8);
            tooth.rotation.x = sign * Math.PI / 2 + (Math.random() - 0.5) * 0.4;
            tooth.rotation.z = (Math.random() - 0.5) * 0.2;
            jawGroup.add(tooth);
        }

        const throat = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.5), matThroat);
        throat.position.set(0, sign * 1.2, -jawRadius + 0.5);
        throat.rotation.x = sign * Math.PI / 4;
        jawGroup.add(throat);

        return jawGroup;
    }

    updateAnimation(dt) {
        this._time += dt;
        // 非线性撕咬动画
        const raw = Math.sin(this._time * 5);
        let chomp = raw > 0 ? Math.pow(raw, 0.5) * 0.4 : Math.pow(Math.abs(raw), 3) * -0.1;
        if (this._topJaw) this._topJaw.rotation.x = -chomp;
        if (this._bottomJaw) this._bottomJaw.rotation.x = chomp;
        // 浮动
        this.group.position.y = this.position.y + Math.sin(this._time * 2.5) * 0.5;
        // 微颤
        this.group.rotation.z = Math.sin(this._time * 20) * 0.02;
    }

    // 使用demon-base默认AI (纯直冲)
}
