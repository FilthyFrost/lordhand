/**
 * ENHANCE-IMPACT.JS — 超级粒子爆炸系统
 *
 * Devil Daggers / Hyper Demon级别的密集、巨大、疯狂粒子爆发
 * 替代原有稀薄的impact-fx, 产生铺天盖地的碎片风暴
 */

const THREE = window.THREE;

// ==========================================
// 几何体缓存 (3种形状)
// ==========================================

// 1. 扁平菱形刀片 (5顶点, 不规则)
const _diamondGeo = new THREE.BufferGeometry();
_diamondGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, -0.5,       // 尖端
    -0.2, 0.05, 0,    // 左刃
    0.15, -0.03, 0,   // 右刃(不对称)
    -0.08, 0.02, 0.3, // 左后
    0.1, -0.04, 0.25, // 右后
]), 3));
_diamondGeo.setIndex([0,1,2, 1,3,2, 2,3,4, 0,2,1, 1,2,3, 2,4,3]);

// 2. 细长针状体
const _needleGeo = new THREE.BoxGeometry(0.025, 0.025, 0.6);

// 3. 碎片三角形
const _triGeo = new THREE.BufferGeometry();
_triGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, -0.3,
    -0.15, 0.08, 0.2,
    0.12, -0.05, 0.15,
]), 3));
_triGeo.setIndex([0,1,2, 0,2,1]);


// 几何体数组 (按权重分配)
const _geos = [];
for (let i = 0; i < 5; i++) _geos.push(_diamondGeo);  // 50%
for (let i = 0; i < 3; i++) _geos.push(_needleGeo);   // 30%
for (let i = 0; i < 2; i++) _geos.push(_triGeo);      // 20%

// ==========================================
// 材质缓存
// ==========================================
const _colorSets = {
    'dagger': [0xffffff, 0xcccccc, 0xeeeeff, 0xffffff, 0xdddddd],
    'laser_bolt': [0x00ffff, 0x0088ff, 0xaaffff, 0x00ccff, 0xffffff],
    'pulse': [0xff00ff, 0x8800ff, 0xffaaff, 0xcc44ff, 0xffffff],
};

const _matCache = {};
function getMat(color) {
    if (!_matCache[color]) {
        _matCache[color] = new THREE.MeshBasicMaterial({
            color: color,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9,
        });
    }
    return _matCache[color];
}

// ==========================================
// 粒子池
// ==========================================
const MAX_PARTICLES = 150; // 降低上限防止掉帧
const particles = [];


let _scene = null;

/**
 * 超级命中爆炸
 * @param {THREE.Scene} scene
 * @param {THREE.Vector3} position - 命中位置
 * @param {THREE.Vector3} normal - 法线方向
 * @param {string} type - 'dagger'|'laser_bolt'|'pulse'
 * @param {number} speed - 弹丸速度 (影响爆炸规模)
 */
export function enhanceImpact(scene, position, normal, type, speed) {
    _scene = scene;
    const colors = _colorSets[type] || _colorSets['dagger'];

    // 帧预算保护: 如果当前活跃粒子已经很多,减少生成
    const activeCount = particles.filter(p => p.mesh.visible).length;
    const budget = activeCount > 100 ? 5 : activeCount > 60 ? 10 : 15;
    const count = Math.min(budget + Math.floor(speed / 40), budget + 8);

    // 爆发速度: 基于弹丸速度
    const burstSpeed = 15 + speed * 0.2;

    for (let i = 0; i < count; i++) {
        // 选择几何体
        const geo = _geos[Math.floor(Math.random() * _geos.length)];
        // 选择颜色
        const color = colors[Math.floor(Math.random() * colors.length)];
        const mat = getMat(color);

        // 复用或创建
        let p;
        if (particles.length >= MAX_PARTICLES) {
            // 找到已消亡的粒子复用（不从数组移除）
            let recycled = null;
            for (let j = 0; j < particles.length; j++) {
                if (!particles[j].mesh.visible) { recycled = particles[j]; break; }
            }
            if (!recycled) recycled = particles[0]; // 全部在用则强制回收最老的
            p = recycled;
            p.mesh.geometry = geo;
            p.mesh.material = mat;
            p.mesh.visible = true;
        } else {
            const mesh = new THREE.Mesh(geo, mat);
            scene.add(mesh);
            p = { mesh, vel: new THREE.Vector3(), life: 0, maxLife: 0, baseScale: 0, spinX: 0, spinY: 0, spinZ: 0 };
            particles.push(p);
        }

        // 位置 (微偏移)
        p.mesh.position.copy(position);
        p.mesh.position.x += (Math.random() - 0.5) * 0.3;
        p.mesh.position.y += (Math.random() - 0.5) * 0.3;
        p.mesh.position.z += (Math.random() - 0.5) * 0.3;

        // 速度方向: 70%法线 + 30%随机
        const dir = normal.clone().multiplyScalar(0.7);
        dir.x += (Math.random() - 0.5) * 0.6;
        dir.y += (Math.random() - 0.5) * 0.6;
        dir.z += (Math.random() - 0.5) * 0.6;
        dir.normalize();

        const spd = burstSpeed * (0.4 + Math.random() * 1.2);
        p.vel.copy(dir).multiplyScalar(spd);

        // 生命
        p.life = 0.4 + Math.random() * 0.4;
        p.maxLife = p.life;

        // 大尺寸! (0.2-0.5)
        p.baseScale = 0.2 + Math.random() * 0.3;
        p.mesh.scale.setScalar(p.baseScale);

        // 疯狂自旋
        p.spinX = (Math.random() - 0.5) * 30;
        p.spinY = (Math.random() - 0.5) * 25;
        p.spinZ = (Math.random() - 0.5) * 35;

        // 随机初始旋转
        p.mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);

        p.mesh.visible = true;
    }

}


/**
 * 每帧更新所有增强粒子
 * @param {number} dt
 */
export function updateEnhancedParticles(dt) {
    // 更新粒子
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (!p.mesh.visible) continue;

        p.life -= dt;

        if (p.life <= 0) {
            p.mesh.visible = false;
            continue;
        }

        const t = p.life / p.maxLife; // 1→0

        // 重力 (弱)
        p.vel.y -= 10 * dt;

        // 移动
        p.mesh.position.addScaledVector(p.vel, dt);

        // 疯狂自旋
        p.mesh.rotation.x += p.spinX * dt;
        p.mesh.rotation.y += p.spinY * dt;
        p.mesh.rotation.z += p.spinZ * dt;

        // 消亡效果: x/y挤压到0, z保持(变成细线再消失)
        const squeeze = t * t; // 二次方衰减 - 最后阶段急剧变细
        const stretch = 1 + p.vel.length() * 0.008; // 速度拉伸
        p.mesh.scale.set(
            p.baseScale * squeeze * 0.8,
            p.baseScale * squeeze * 0.8,
            p.baseScale * stretch
        );

        // 材质透明度
        if (p.mesh.material.opacity !== undefined) {
            p.mesh.material.opacity = Math.min(t * 2, 0.9);
        }
    }

}
