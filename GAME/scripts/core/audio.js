/**
 * AUDIO.JS — Synthesized sound effects (footstep, jump, dash, climb, rail)
 * Extracted from game-core.js. Exposes window.audioCtx, window.masterComp, window.noiseBuf, and play* functions.
 */
(function() {
    'use strict';

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx();
    const masterComp = audioCtx.createDynamicsCompressor();
    masterComp.threshold.value = -20; masterComp.ratio.value = 12;
    masterComp.attack.value = 0.002; masterComp.release.value = 0.1;
    masterComp.connect(audioCtx.destination);

    const noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    function playFootstep() {
        if (audioCtx.state === 'suspended') return;
        const t = audioCtx.currentTime;
        const o = audioCtx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(30, t + .08);
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.5, t + .01); g.gain.exponentialRampToValueAtTime(.01, t + .08);
        o.connect(g); g.connect(masterComp); o.start(t); o.stop(t + .1);
    }

    function playJump(d) {
        if (audioCtx.state === 'suspended') return;
        const t = audioCtx.currentTime;
        if (!d) {
            const o = audioCtx.createOscillator(); o.type = 'square';
            o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(30, t + .15);
            const g = audioCtx.createGain();
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.8, t + .01); g.gain.exponentialRampToValueAtTime(.01, t + .15);
            o.connect(g); g.connect(masterComp); o.start(t); o.stop(t + .2);
        } else {
            const b = audioCtx.createBufferSource(); b.buffer = noiseBuf;
            const f = audioCtx.createBiquadFilter(); f.type = 'bandpass';
            f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(300, t + .2);
            const g = audioCtx.createGain();
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + .01); g.gain.exponentialRampToValueAtTime(.01, t + .25);
            b.connect(f); f.connect(g); g.connect(masterComp); b.start(t); b.stop(t + .3);
        }
    }

    function playDash() {
        if (audioCtx.state === 'suspended') return;
        const t = audioCtx.currentTime;
        const w = audioCtx.createBufferSource(); w.buffer = noiseBuf;
        const wf = audioCtx.createBiquadFilter(); wf.type = 'lowpass'; wf.Q.value = 3;
        wf.frequency.setValueAtTime(8000, t); wf.frequency.exponentialRampToValueAtTime(300, t + .25);
        const wg = audioCtx.createGain();
        wg.gain.setValueAtTime(0, t); wg.gain.linearRampToValueAtTime(1, t + .02); wg.gain.exponentialRampToValueAtTime(.01, t + .3);
        w.connect(wf); wf.connect(wg); wg.connect(masterComp); w.start(t); w.stop(t + .35);
    }

    function playClimb() {
        if (audioCtx.state === 'suspended') return;
        const t = audioCtx.currentTime;
        const o = audioCtx.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(500, t + .1);
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.5, t + .01); g.gain.exponentialRampToValueAtTime(.01, t + .12);
        o.connect(g); g.connect(masterComp); o.start(t); o.stop(t + .15);
    }

    function playRailOn() {
        if (audioCtx.state === 'suspended') return;
        const t = audioCtx.currentTime;
        const o = audioCtx.createOscillator(); o.type = 'triangle';
        o.frequency.setValueAtTime(800, t); o.frequency.exponentialRampToValueAtTime(1200, t + .1);
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.5, t + .01); g.gain.exponentialRampToValueAtTime(.01, t + .15);
        o.connect(g); g.connect(masterComp); o.start(t); o.stop(t + .2);
    }

    // Expose globally
    window.audioCtx = audioCtx;
    window.masterComp = masterComp;
    window.noiseBuf = noiseBuf;
    window.playFootstep = playFootstep;
    window.playJump = playJump;
    window.playDash = playDash;
    window.playClimb = playClimb;
    window.playRailOn = playRailOn;
})();
