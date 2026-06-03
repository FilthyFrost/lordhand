/**
 * THE FLAYED VESSEL — 剥皮容器
 * 忠实还原恶魔3.html中的buildTheFlayedVessel
 * 全部MeshBasicMaterial (无灯光)
 */

const THREE = window.THREE;
import { DemonBase, DemonState } from '../demon-base.js';

function createBlob(mat, rx, ry, rz, x, y, z, rotX=0, rotY=0, rotZ=0) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 6), mat);
    mesh.scale.set(rx, ry, rz);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rotX, rotY, rotZ);
    return mesh;
}

export class DemonFlayedVessel extends DemonBase {
    constructor(scene, position, config = {}) {
        super(scene, position, {
            hp: config.hp || 240,
            speed: config.speed || 12,
            size: new THREE.Vector3(2.5, 5, 2),
            attackRange: 4,
            attackDamage: 4,
            name: 'THE FLAYED VESSEL',
            colliders: null, // 浮空: 不做墙壁碰撞
            ...config,
        });

        this._time = Math.random() * 100;
    }

    buildModel() {
        const matPaleSkin = new THREE.MeshBasicMaterial({ color: 0xcdd2d8 });
        const matPaleVein = new THREE.MeshBasicMaterial({ color: 0x99aacc });
        const matWetGore = new THREE.MeshBasicMaterial({ color: 0xaa0000 });
        const matObsidian = new THREE.MeshBasicMaterial({ color: 0x111111 });

        // 1. 腿部
        const buildLeg = (isLeft) => {
            const leg = new THREE.Group();
            const sign = isLeft ? -1 : 1;

            leg.add(createBlob(matPaleSkin, 0.7, 1.8, 0.8, 0, -1.5, 0, 0, 0, sign * 0.1));
            leg.add(createBlob(matPaleSkin, 0.5, 1.6, 0.6, 0.3*sign, -1.5, 0.3));
            leg.add(createBlob(matPaleSkin, 0.4, 0.5, 0.5, 0, -3.2, 0.2));
            leg.add(createBlob(matPaleSkin, 0.5, 1.5, 0.6, 0, -4.5, 0.1, 0.1, 0, 0));

            const foot = createBlob(matPaleSkin, 0.5, 0.3, 1.0, 0, -5.7, 0.5);
            const bloodStain = createBlob(matWetGore, 0.51, 0.2, 0.6, 0, -5.6, 0);
            leg.add(foot, bloodStain);

            for (let i = 0; i < 3; i++) {
                const vein = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4, 3), matPaleVein);
                vein.position.set(sign*0.5, -3, (Math.random()-0.5)*0.8);
                vein.rotation.set((Math.random()-0.5)*0.2, 0, (Math.random()-0.5)*0.2);
                leg.add(vein);
            }

            leg.position.set(sign * 1.2, 0, 0);
            return leg;
        };
        this.group.add(buildLeg(true), buildLeg(false));

        // 2. 内脏核心 (80个血肉blob)
        const coreFlesh = new THREE.Group();
        for (let i = 0; i < 80; i++) {
            const blob = createBlob(matWetGore,
                0.2 + Math.random()*0.4,
                0.8 + Math.random()*1.5,
                0.2 + Math.random()*0.4,
                (Math.random()-0.5) * 1.5,
                1.5 + Math.random() * 5.5,
                0.2 + Math.random() * 0.5,
                Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI
            );
            coreFlesh.add(blob);
        }
        this.group.add(coreFlesh);

        // 3. 撕裂的皮囊边缘 (30对皮瓣)
        this._skinFlaps = new THREE.Group();
        for (let i = 0; i < 30; i++) {
            const y = 1.0 + (i/30) * 6.5;
            const curve = Math.sin((i/30)*Math.PI) * 1.5;
            this._skinFlaps.add(createBlob(matPaleSkin, 0.6, 0.4, 0.8, -0.8 - curve, y, 0.5, 0, 0.5, 0));
            this._skinFlaps.add(createBlob(matPaleSkin, 0.6, 0.4, 0.8, 0.8 + curve, y, 0.5, 0, -0.5, 0));
        }
        this.group.add(this._skinFlaps);

        // 4. 异化手臂群 (6对抓握之手)
        this._hands = [];
        const armPairs = 6;
        for (let i = 0; i < armPairs; i++) {
            const height = 2.0 + i * 0.9;
            const widthOffset = Math.sin((i/armPairs)*Math.PI) * 1.5;

            const buildHand = (isLeft) => {
                const hGroup = new THREE.Group();
                const sign = isLeft ? -1 : 1;

                hGroup.add(createBlob(matPaleSkin, 1.2, 0.4, 0.5, sign*0.8, 0, -0.2, 0, sign*0.2, sign*0.5));
                const forearm = createBlob(matPaleSkin, 1.0, 0.3, 0.4, sign*1.8, -0.2, 0.2, 0, sign*-0.5, 0);
                hGroup.add(forearm);

                for (let f = 0; f < 3; f++) {
                    const finger = new THREE.Group();
                    finger.add(createBlob(matPaleSkin, 0.4, 0.15, 0.15, 0, 0, 0));
                    finger.add(createBlob(matPaleSkin, 0.3, 0.1, 0.1, sign*0.3, 0, 0.2, 0, sign*-0.8, 0));
                    finger.position.set(sign*2.5, -0.2 + (f-1)*0.2, 0.5);
                    finger.rotation.y = sign * -1.0;
                    hGroup.add(finger);
                }

                hGroup.position.set(sign*(1.0 + widthOffset), height, 0.5);
                hGroup.userData.baseRotZ = isLeft ? 0.2 : -0.2;
                hGroup.rotation.z = hGroup.userData.baseRotZ;
                hGroup.rotation.x = -0.2;
                return hGroup;
            };

            const lHand = buildHand(true);
            const rHand = buildHand(false);
            this.group.add(lHand, rHand);
            this._hands.push(lHand, rHand);
        }

        // 5. 黑曜石巨头 + 高举巨臂
        this._headGroup = new THREE.Group();
        this._headGroup.add(createBlob(matWetGore, 1.2, 0.8, 1.2, 0, 7.8, 0.5));

        const dome = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 12), matObsidian);
        dome.scale.set(0.95, 1.15, 1.0);
        dome.position.set(0, 8.8, 1.2);
        dome.rotation.x = 0.4;
        this._headGroup.add(dome);

        const giantArm = new THREE.Group();
        giantArm.add(createBlob(matPaleSkin, 1.0, 3.5, 1.0, 1.5, 9.5, -1.0, 0, 0, -0.6));
        giantArm.add(createBlob(matPaleSkin, 0.8, 3.5, 0.8, 3.5, 12.5, -1.5, -0.5, 0, -0.2));
        this._headGroup.add(giantArm);

        this.group.add(this._headGroup);

        // 整体缩放适配游戏 + 确保站立姿态正确 (头朝上, 脚朝下)
        this.group.scale.set(0.35, 0.35, 0.35);
        // 模型原点在脚部附近, 整体上移让它看起来站立
        this.group.position.y += 2;
    }

    updateAnimation(dt) {
        this._time += dt;

        // 身体呼吸摆动
        this.group.position.y = this.position.y + Math.sin(this._time * 2) * 0.15;

        // 皮瓣蠕动
        if (this._skinFlaps) {
            this._skinFlaps.children.forEach((flap, i) => {
                const isLeft = i % 2 === 0;
                flap.position.x += (isLeft ? -1 : 1) * Math.sin(this._time * 10 + i) * 0.005;
            });
        }

        // 手臂抽搐
        this._hands.forEach((arm, i) => {
            const twitch = Math.sin(this._time * 15 + i * 1.2) * 0.1;
            arm.rotation.z = (arm.userData.baseRotZ || 0) + twitch;
        });

        // 头部缓慢转动
        if (this._headGroup) {
            this._headGroup.rotation.y = Math.sin(this._time * 1.0) * 0.25;
            this._headGroup.rotation.x = Math.cos(this._time * 1.5) * 0.08;
        }
    }

    // 使用demon-base默认AI (纯直冲)

    // 重写: Vessel保持直立, 只在Y轴旋转面朝玩家
    _keepUpright() {
        return true; // 标记给base知道这个怪要保持直立
    }
}
