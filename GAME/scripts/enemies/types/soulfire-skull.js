/**
 * SOULFIRE SKULL — 魂火颅骨
 *
 * 体素矩阵拼装的像素风骷髅 + 灵魂火焰粒子系统
 * 行为: 缓慢浮空逼近玩家, 十字高光眼瞳闪烁
 */

const THREE = window.THREE;
import { DemonBase, DemonState } from '../demon-base.js';

export class DemonSoulfireSkull extends DemonBase {
    constructor(scene, position, config = {}) {
        super(scene, position, {
            hp: config.hp || 80,
            speed: config.speed || 25,
            size: new THREE.Vector3(1.5, 1.5, 1.5),
            attackRange: 3,
            attackDamage: 1,
            name: 'SOULFIRE SKULL',
            colliders: null, // 浮空怪: 不做墙壁碰撞
            ...config,
        });

        this._time = Math.random() * 100;
        this._wanderTarget = null;
        this._wanderTimer = 0;
    }

    buildModel() {
        // 材质 (MeshBasicMaterial — 兼容无灯光场景)
        const matVoxelBone = new THREE.MeshBasicMaterial({ color: 0x334466 }); // 深蓝骨
        const matGlowWhite = new THREE.MeshBasicMaterial({ color: 0xffffff }); // 耀眼白瞳
        const matGlowCyan = new THREE.MeshBasicMaterial({ color: 0x66ffff, transparent: true, opacity: 0.8 }); // 十字高光

        // 体素数据矩阵
        const voxelGrid = [
            // Layer Z=0 (Front face)
            [
                [0,0,1,1,1,1,0,0],
                [0,1,1,1,1,1,1,0],
                [1,1,1,1,1,1,1,1],
                [1,1,1,1,1,1,1,1],
                [1,0,2,1,1,2,0,1], // 眼睛
                [1,1,1,1,1,1,1,1],
                [0,1,0,1,1,0,1,0], // 獠牙
                [0,0,1,0,0,1,0,0]
            ],
            // Layer Z=-1 (Mid skull)
            [
                [0,0,1,1,1,1,0,0],
                [0,1,1,1,1,1,1,0],
                [1,1,1,1,1,1,1,1],
                [1,1,1,1,1,1,1,1],
                [1,1,0,1,1,0,1,1],
                [1,1,1,1,1,1,1,1],
                [0,1,1,1,1,1,1,0],
                [0,0,0,0,0,0,0,0]
            ],
            // Layer Z=-2 (Back skull)
            [
                [0,0,0,1,1,0,0,0],
                [0,0,1,1,1,1,0,0],
                [0,1,1,1,1,1,1,0],
                [0,1,1,1,1,1,1,0],
                [0,1,1,1,1,1,1,0],
                [0,0,1,1,1,1,0,0],
                [0,0,0,0,0,0,0,0],
                [0,0,0,0,0,0,0,0]
            ]
        ];

        // 解析体素矩阵
        const voxelGroup = new THREE.Group();
        const vSize = 0.5;
        const offset = (8 * vSize) / 2;
        const boxGeo = new THREE.BoxGeometry(vSize, vSize, vSize);

        for (let z = 0; z < voxelGrid.length; z++) {
            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    const val = voxelGrid[z][y][x];
                    if (val === 1) {
                        const bone = new THREE.Mesh(boxGeo, matVoxelBone);
                        bone.position.set(
                            x * vSize - offset + vSize / 2,
                            (7 - y) * vSize - offset,
                            -z * vSize
                        );
                        voxelGroup.add(bone);
                    } else if (val === 2) {
                        // 眼睛 (稍大+白色)
                        const eye = new THREE.Mesh(boxGeo, matGlowWhite);
                        eye.position.set(
                            x * vSize - offset + vSize / 2,
                            (7 - y) * vSize - offset,
                            -z * vSize + 0.05
                        );
                        eye.scale.setScalar(1.1);
                        voxelGroup.add(eye);

                        // 十字高光 (Cross Flare)
                        const flareVGeo = new THREE.BoxGeometry(vSize * 0.25, vSize * 2.5, 0.08);
                        const flareV = new THREE.Mesh(flareVGeo, matGlowCyan);
                        flareV.position.copy(eye.position);
                        flareV.position.z += 0.3;
                        voxelGroup.add(flareV);

                        const flareHGeo = new THREE.BoxGeometry(vSize * 2.5, vSize * 0.25, 0.08);
                        const flareH = new THREE.Mesh(flareHGeo, matGlowCyan);
                        flareH.position.copy(eye.position);
                        flareH.position.z += 0.3;
                        voxelGroup.add(flareH);
                    }
                }
            }
        }

        voxelGroup.position.y = 0.5;
        this.group.add(voxelGroup);
        this._skullMesh = voxelGroup;

        // 灵魂火焰粒子 (用Points + ShaderMaterial)
        const fireCount = 800;
        const fireGeo = new THREE.BufferGeometry();
        const firePos = new Float32Array(fireCount * 3);
        const fireParams = new Float32Array(fireCount * 2);

        for (let i = 0; i < fireCount; i++) {
            firePos[i * 3] = (Math.random() - 0.5) * 5;
            firePos[i * 3 + 1] = (Math.random() - 0.5) * 3 - 1.5;
            firePos[i * 3 + 2] = (Math.random() - 0.5) * 1.5 - 0.5;
            fireParams[i * 2] = Math.random();
            fireParams[i * 2 + 1] = 0.5 + Math.random() * 1.5;
        }

        fireGeo.setAttribute('position', new THREE.BufferAttribute(firePos, 3));
        fireGeo.setAttribute('aParams', new THREE.BufferAttribute(fireParams, 2));

        this._fireMat = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                cWhite: { value: new THREE.Color(0xffffff) },
                cCyan: { value: new THREE.Color(0x66ffff) },
                cBlue: { value: new THREE.Color(0x114488) }
            },
            vertexShader: `
                uniform float time;
                attribute vec2 aParams;
                varying float vLife;
                void main() {
                    float life = fract(aParams.x + time * aParams.y);
                    vLife = life;
                    vec3 pos = position;
                    pos.y += life * 7.0;
                    float noise = sin(time * 5.0 + pos.y * 2.0 + pos.x) * 1.2;
                    noise = floor(noise * 4.0) / 4.0;
                    pos.x += noise;
                    pos.x *= (1.0 - life * 0.6);
                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = 18.0 * (10.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform vec3 cWhite;
                uniform vec3 cCyan;
                uniform vec3 cBlue;
                varying float vLife;
                void main() {
                    vec3 finalColor;
                    if(vLife < 0.2) {
                        finalColor = cWhite;
                    } else if(vLife < 0.6) {
                        finalColor = cCyan;
                    } else {
                        finalColor = cBlue;
                    }
                    float alpha = 1.0 - pow(vLife, 3.0);
                    if(alpha < 0.1) discard;
                    gl_FragColor = vec4(finalColor, alpha * 0.7);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const firePoints = new THREE.Points(fireGeo, this._fireMat);
        this.group.add(firePoints);
    }

    updateAnimation(dt) {
        this._time += dt;

        // 浮动
        this.group.position.y = this.position.y + Math.sin(this._time * 2) * 0.5;

        // 头骨轻微摆动
        if (this._skullMesh) {
            this._skullMesh.rotation.y = Math.sin(this._time) * 0.15;
            this._skullMesh.rotation.x = Math.sin(this._time * 1.5) * 0.08;
        }

        // 驱动火焰着色器
        if (this._fireMat) {
            this._fireMat.uniforms.time.value = this._time;
        }
    }

    // 使用demon-base默认AI (纯直冲)
}
