// MECHANICS.JS - Balloon bounce + Rail system interaction

function handleBalloonCollision(player, collider) {
    if (player.vel.y > 0) return;
    player.vel.y = 34.6; // ~10 units peak height
    player.jumpsLeft = 2;
    player.onGround = false;
    playBounceSound();
    spawnShockwave(0x222222, 2.0);
    triggerShake(0.5, 0.15);
    triggerFlash('rgba(50,0,80,0.3)', 1, 0.15);
    const pos = player.pos.clone(); pos.y -= player.size.y / 2;
    spawnDebris(pos, new THREE.Vector3(0, 1, 0), matEnergyBlue, 20, 25, 1, true);
}

function playBounceSound() {
    if (audioCtx.state === 'suspended') return;
    const t = audioCtx.currentTime;
    const sub = audioCtx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(60, t); sub.frequency.exponentialRampToValueAtTime(200, t + 0.15);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.0, t + 0.01); g.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
    sub.connect(g); g.connect(masterComp); sub.start(t); sub.stop(t + 0.25);
}

function updateRailSystem(player, dt, keys, prevSpace) {
    if (!player.onRail) {
        for (let i = 0; i < RAIL_CURVES.length; i++) {
            if (!RAIL_CURVES[i]) continue;
            const samples = RAIL_SAMPLES[i];
            for (let j = 0; j < samples.length; j++) {
                const dist = player.pos.distanceTo(samples[j]);
                if (dist <= (j < 3 ? 4.0 : 2.5)) {
                    player.onRail = true;
                    player.railIndex = i;
                    player.railProgress = j / 30.0;
                    player.vel.set(0, 0, 0);
                    playRailOn();
                    triggerFlash('rgba(0,255,255,0.3)', 1, 0.15);
                    document.getElementById('rail-indicator').style.opacity = '1';
                    return;
                }
            }
        }
    } else {
        const curve = RAIL_CURVES[player.railIndex];
        if (!curve) { player.onRail = false; return; }
        const len = curve.getLength();
        player.railProgress += (player.railSpeed * dt) / len;
        if (player.railProgress >= 1.0) {
            player.onRail = false;
            player.vel.copy(curve.getTangentAt(0.99)).multiplyScalar(player.railSpeed);
            player.railProgress = 0;
            document.getElementById('rail-indicator').style.opacity = '0';
        } else {
            player.pos.copy(curve.getPointAt(player.railProgress));
            const tang = curve.getTangentAt(player.railProgress);
            player.vel.copy(tang).multiplyScalar(player.railSpeed);
            if (Math.random() > 0.7) spawnDebris(player.pos, tang.clone().negate(), matEnergyDash, 1, 8, 0.5, true);
            if (keys.space && !prevSpace) {
                player.onRail = false;
                player.vel.y += 18;
                player.jumpsLeft = 1;
                document.getElementById('rail-indicator').style.opacity = '0';
                playJump(true);
                spawnShockwave(0x00ffff, 1.5);
                triggerShake(0.3, 0.1);
            }
        }
    }
}
