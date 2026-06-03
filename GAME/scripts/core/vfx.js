/**
 * VFX.JS — 3D particles, shockwaves, screen shake, screen flash
 * Extracted from game-core.js. Reads window._gameScene, window.player at runtime.
 */
(function() {
    'use strict';

    const screenFlash = document.getElementById('screen-flash');

    // === Shake & Flash ===
    let shakeTimer = 0, shakeIntensity = 0, fovOffset = 0;

    function triggerShake(i, d) { shakeIntensity = i; shakeTimer = d; }
    function triggerFlash(color, opacity, duration) {
        screenFlash.style.transition = 'none';
        screenFlash.style.backgroundColor = color;
        screenFlash.style.opacity = opacity;
        void screenFlash.offsetWidth;
        screenFlash.style.transition = 'opacity ' + duration + 's ease-out';
        screenFlash.style.opacity = '0';
    }

    // === Materials ===
    const particleGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const matDebris = new THREE.MeshBasicMaterial({ color: 0xaaaaaa });
    const matEnergyDash = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    const matEnergyBlue = new THREE.MeshBasicMaterial({ color: 0x0055ff });
    const matSparkOrange = new THREE.MeshBasicMaterial({ color: 0xff8800 });

    // === 3D Particles ===
    const particles3D = [];

    function spawnDebris(origin, dir, material, count, speed, size, isEnergy) {
        var scene = window._gameScene;
        if (!scene) return;
        for (let i = 0; i < count; i++) {
            const mesh = new THREE.Mesh(particleGeo, material);
            mesh.position.copy(origin).add(new THREE.Vector3((Math.random()-.5)*.8,(Math.random()-.5)*.8,(Math.random()-.5)*.8));
            const d2 = new THREE.Vector3(Math.random()-.5,Math.random()-.5,Math.random()-.5).normalize();
            if (dir) d2.add(dir.clone().multiplyScalar(1.5)).normalize();
            scene.add(mesh);
            particles3D.push({ mesh, vel: d2.multiplyScalar(speed*(0.5+Math.random()*1.5)), life: 1, scale: size*(Math.random()*.8+.4), isEnergy });
        }
    }

    function updateParticles(dt) {
        var scene = window._gameScene;
        if (!scene) return;
        for (let i = particles3D.length-1; i >= 0; i--) {
            const p = particles3D[i]; p.life -= dt * (p.isEnergy ? 3.5 : 2.5);
            if (p.life <= 0) { scene.remove(p.mesh); particles3D.splice(i, 1); continue; }
            p.vel.y -= 60 * dt * (p.isEnergy ? 0.1 : 0.8);
            p.mesh.position.addScaledVector(p.vel, dt);
            if (p.isEnergy) {
                if (p.vel.lengthSq() > 0.1) {
                    p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), p.vel.clone().normalize());
                    p.mesh.scale.set(p.scale*p.life*.2, p.scale*p.life*.2, p.scale*p.life+p.vel.length()*.2);
                }
            } else {
                p.mesh.rotation.x += p.vel.y*dt;
                p.mesh.rotation.y += p.vel.x*dt;
                p.mesh.scale.setScalar(p.scale*p.life);
            }
        }
    }

    // === Shockwaves ===
    const shockwaves = [];

    function spawnShockwave(color, scale) {
        var scene = window._gameScene;
        var player = window.player;
        if (!scene || !player) return;
        const mesh = new THREE.Mesh(
            new THREE.RingGeometry(.3, 1, 16),
            new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide, transparent: true })
        );
        mesh.rotation.x = -Math.PI/2;
        mesh.position.copy(player.pos);
        mesh.position.y -= player.size.y/2 - .1;
        scene.add(mesh);
        shockwaves.push({ mesh, age: 0, scale: scale });
    }

    function updateShockwaves(dt) {
        var scene = window._gameScene;
        if (!scene) return;
        for (let i = shockwaves.length-1; i >= 0; i--) {
            const s = shockwaves[i];
            s.age += dt;
            const sc = 1 + s.age * 30 * s.scale;
            s.mesh.scale.set(sc, sc, 1);
            s.mesh.material.opacity = 1 - s.age * 4;
            if (s.age > .25) { scene.remove(s.mesh); shockwaves.splice(i, 1); }
        }
    }

    // === Shake helpers for game-core ===
    function applyShake(camera, dt) {
        if (shakeTimer > 0) {
            camera.position.x += (Math.random()-.5) * shakeIntensity;
            camera.position.y += (Math.random()-.5) * shakeIntensity;
            camera.position.z += (Math.random()-.5) * shakeIntensity;
            shakeTimer -= dt;
        }
    }

    // === Expose globally ===
    window.triggerShake = triggerShake;
    window.triggerFlash = triggerFlash;
    window.spawnDebris = spawnDebris;
    window.spawnShockwave = spawnShockwave;
    window.matDebris = matDebris;
    window.matEnergyDash = matEnergyDash;
    window.matEnergyBlue = matEnergyBlue;
    window.matSparkOrange = matSparkOrange;
    window._updateParticles = updateParticles;
    window._updateShockwaves = updateShockwaves;
    window._applyShake = applyShake;
    window._setFovOffset = function(val) { fovOffset = val; };
    window._getFovOffset = function() { return fovOffset; };
    window._tickFovOffset = function(dt) { fovOffset = THREE.MathUtils.lerp(fovOffset, 0, dt * 8); return fovOffset; };
})();
