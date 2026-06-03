/**
 * INIT-SPELL.JS — 法术/武器系统入口
 *
 * 零侵入: 不覆盖任何Three.js方法 (scene.add/remove保持原始)
 */

import { ProjectileSystem } from './projectile-system.js';
import { HandModel } from '../player/hand-model.js';
import { JuiceSystem } from '../vfx/juice-system.js';
import { enhanceImpact, updateEnhancedParticles } from '../vfx/particles.js';
import { WeaponSystem } from './weapon-system.js';

const THREE = window.THREE;

function waitForGame() {
    if (window._gameLoopActive) {
        boot();
    } else {
        setTimeout(waitForGame, 100);
    }
}
waitForGame();

let scene, camera, player, audioCtx, masterCompressor;
let projectileSystem, juice, handModel, weaponSystem;
let nearbyColliders = [];
const _seenColliders = new Set();
let _refreshCounter = 0;

function boot() {
    scene = window._gameScene;
    camera = window._gameCamera;
    player = window._gamePlayer;
    audioCtx = window.audioCtx;
    masterCompressor = window.masterComp;

    projectileSystem = new ProjectileSystem(scene, nearbyColliders);

    try {
        juice = new JuiceSystem(null, camera, scene);
    } catch(e) {
        juice = { cameraImpulse(){}, chromaticAberration(){}, updatePostProcess(){}, hitStop(){}, radialDistortion(){}, whiteout(){}, invertFlash(){}, vignettePulse(){}, setTimeScale(){} };
    }

    initSpellSystem();
    bindInputEvents();

    window._updateSpellSystem = updateSpellSystem;
    window._getProjectileCount = function() { return projectileSystem ? projectileSystem.projectiles.length : 0; };
    window._getCrossParticleCount = function() { return weaponSystem ? weaponSystem._crossParticles.length : 0; };
    window._getInstParticlesInfo = function() {
        if (!weaponSystem || !weaponSystem._instParticles) return '';
        var pools = weaponSystem._instParticles._pools;
        var msg = '';
        for (var name in pools) {
            var p = pools[name];
            var color = p.particles.length > 0 ? '#ff0' : '#0f0';
            msg += '<span style="color:' + color + '">' + name + ':' + p.particles.length + '/' + p.maxCount + '</span> ';
        }
        return msg;
    };

    // GC: 不覆盖任何Three.js方法, 只清理invisible/透明对象
    var _mapMeshes = new Set();
    var _gcCounter = 0;
    setTimeout(function() {
        scene.children.forEach(function(c) { _mapMeshes.add(c); });
        _mapMeshes.add(camera);
    }, 100);

    window._spellGC = function() {
        _gcCounter++;
        if (_gcCounter % 60 !== 0) return;
        for (var i = scene.children.length - 1; i >= 0; i--) {
            var obj = scene.children[i];
            if (_mapMeshes.has(obj)) continue;
            if (obj.isInstancedMesh) continue;
            if (obj._pooled) continue;
            if (obj.isCamera) continue;
            var dead = false;
            if (!obj.visible) dead = true;
            else if (obj.material && obj.material.transparent && obj.material.opacity <= 0.01) dead = true;
            if (dead) {
                scene.remove(obj);
                obj.traverse(function(child) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) child.material.forEach(function(m){m.dispose();});
                        else child.material.dispose();
                    }
                });
            }
        }
    };
}

// ==========================================
// 近距离碰撞体刷新
// ==========================================
function refreshNearbyColliders() {
    _refreshCounter++;
    if (_refreshCounter % 3 !== 0) return;
    nearbyColliders.length = 0;
    if (!window.spatialGrid) return;
    const CELL_SIZE = 20;
    const px = player.pos.x, py = player.pos.y, pz = player.pos.z;
    const range = 2;
    const minCX = Math.floor(px / CELL_SIZE) - range;
    const maxCX = Math.floor(px / CELL_SIZE) + range;
    const minCY = Math.floor(py / CELL_SIZE) - range;
    const maxCY = Math.floor(py / CELL_SIZE) + range;
    const minCZ = Math.floor(pz / CELL_SIZE) - range;
    const maxCZ = Math.floor(pz / CELL_SIZE) + range;
    _seenColliders.clear();
    for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cy = minCY; cy <= maxCY; cy++) {
            for (let cz = minCZ; cz <= maxCZ; cz++) {
                const key = `${cx}_${cy}_${cz}`;
                const cell = window.spatialGrid[key];
                if (!cell) continue;
                for (const c of cell) {
                    if (!_seenColliders.has(c)) {
                        _seenColliders.add(c);
                        nearbyColliders.push(c);
                    }
                }
            }
        }
    }
}

// ==========================================
// 音效函数 (从 法术设计.html 1:1提取)
// ==========================================
let _sfxNoiseBuffer = null;
function _getSfxNoise() {
    if (_sfxNoiseBuffer) return _sfxNoiseBuffer;
    const length = audioCtx.sampleRate * 2;
    _sfxNoiseBuffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
    const data = _sfxNoiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return _sfxNoiseBuffer;
}

function playShotgunBlast() {
    if (audioCtx.state === 'suspended') return;
    const t = audioCtx.currentTime;
    const noise = _getSfxNoise();
    const kick = audioCtx.createOscillator();
    const kickG = audioCtx.createGain();
    kick.type = 'sine';
    kick.frequency.setValueAtTime(400, t);
    kick.frequency.exponentialRampToValueAtTime(40, t + 0.015);
    kickG.gain.setValueAtTime(0.6, t);
    kickG.gain.setValueAtTime(0.6, t + 0.010);
    kickG.gain.exponentialRampToValueAtTime(0.0001, t + 0.120);
    kick.connect(kickG); kickG.connect(masterCompressor);
    kick.start(t); kick.stop(t + 0.120);
    const click = audioCtx.createBufferSource();
    const clickG = audioCtx.createGain();
    click.buffer = noise;
    clickG.gain.setValueAtTime(0.45, t);
    clickG.gain.exponentialRampToValueAtTime(0.0001, t + 0.005);
    click.connect(clickG); clickG.connect(masterCompressor);
    click.start(t); click.stop(t + 0.005);
}

function playHitSound(isEnemy) {
    if (audioCtx.state === 'suspended') return;
    const t = audioCtx.currentTime;
    const p = 0.7 + Math.random() * 0.6;
    const noise = _getSfxNoise();
    const carrierFreqStart = (isEnemy ? 600 : 450) * p;
    const carrierFreqEnd = (isEnemy ? 200 : 220) * p;
    const modFreq = carrierFreqStart * 1.4;
    const modDepth = (isEnemy ? 400 : 250) * p;
    const mod = audioCtx.createOscillator();
    const modGain = audioCtx.createGain();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(modFreq, t);
    mod.frequency.exponentialRampToValueAtTime(modFreq * 0.5, t + 0.025);
    modGain.gain.setValueAtTime(modDepth, t);
    modGain.gain.exponentialRampToValueAtTime(10, t + 0.030);
    const carrier = audioCtx.createOscillator();
    const carrierGain = audioCtx.createGain();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(carrierFreqStart, t);
    carrier.frequency.exponentialRampToValueAtTime(carrierFreqEnd, t + 0.020);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    carrierGain.gain.setValueAtTime(isEnemy ? 0.4 : 0.25, t);
    carrierGain.gain.setValueAtTime(isEnemy ? 0.4 : 0.25, t + 0.008);
    carrierGain.gain.exponentialRampToValueAtTime(0.0001, t + (isEnemy ? 0.045 : 0.035));
    carrier.connect(carrierGain);
    carrierGain.connect(masterCompressor);
    mod.start(t); carrier.start(t);
    mod.stop(t + 0.050); carrier.stop(t + 0.050);
    const grain = audioCtx.createBufferSource();
    const grainG = audioCtx.createGain();
    grain.buffer = noise;
    grainG.gain.setValueAtTime(isEnemy ? 0.2 : 0.12, t);
    grainG.gain.exponentialRampToValueAtTime(0.0001, t + 0.004);
    grain.connect(grainG); grainG.connect(masterCompressor);
    grain.start(t); grain.stop(t + 0.004);
}

// ==========================================
// 初始化 (法术部分, 不含刷怪)
// ==========================================
function initSpellSystem() {
    handModel = new HandModel(scene, camera);
    handModel.setSpellColor(0x8800ff);

    weaponSystem = new WeaponSystem(
        scene, camera, audioCtx, masterCompressor,
        projectileSystem, handModel, nearbyColliders,
        window.triggerShake, window.triggerFlash,
        (val) => { if (window._setFovOffset) window._setFovOffset(val); }
    );

    window.__juice = juice;
    window._playShotgunBlast = playShotgunBlast;
}

// ==========================================
// 鼠标输入绑定
// ==========================================
function bindInputEvents() {
    document.addEventListener('mousedown', (e) => {
        if (document.pointerLockElement !== document.body) return;
        if (!weaponSystem) return;
        weaponSystem.onMouseDown(e.button);
    });
    document.addEventListener('mouseup', (e) => {
        if (document.pointerLockElement !== document.body) return;
        if (!weaponSystem) return;
        weaponSystem.onMouseUp(e.button);
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ==========================================
// 每帧更新 (法术部分, 不含刷怪)
// ==========================================
function updateSpellSystem(dt) {
    if (!weaponSystem) return;

    refreshNearbyColliders();

    try { weaponSystem.update(dt); } catch(e) { console.warn('Weapon error:', e.message); }
    try { handModel.update(dt, weaponSystem.getHandState()); } catch(e) {}
    try { projectileSystem.update(dt); } catch(e) {}

    const hits = projectileSystem.hitResults || [];
    const canSpawn = dt < 0.04;
    let impactCount = 0;
    let soundCount = 0;
    for (const hit of hits) {
        try {
            if (canSpawn && impactCount < 3) {
                enhanceImpact(scene, hit.position, hit.normal, hit.projectileType, hit.speed);
                impactCount++;
            }
            if (soundCount < 3) {
                const isEnemy = hit.collider && hit.collider.type === 'enemy';
                playHitSound(isEnemy);
                soundCount++;
            }
        } catch(e) {}
    }

    try { updateEnhancedParticles(dt); } catch(e) {}
    try { juice.updatePostProcess(dt); } catch(e) {}
}
