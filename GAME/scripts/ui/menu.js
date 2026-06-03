/**
 * MENU.JS — 主菜单系统 (1:1复刻自 主界面_FInal.html)
 *
 * 复刻内容:
 * - AudioEngine (hover, click, transition 音效)
 * - Dreamcore 背景 + 视差
 * - Chrome液态金属文字
 * - Cybersigilism 符文装饰 (鼠标旋转)
 * - PS1/CRT 扫描线叠加
 * - 液态扭曲过渡 (liquid-warp)
 * - 设置面板 (音量, FOV, 血腥, CRT)
 * - 菜单项交互 (skew, >, blink, invert)
 */
(function() {
    'use strict';

    // ==========================================
    // 1. AUDIO ENGINE (1:1 from original)
    // ==========================================
    class AudioEngine {
        constructor() {
            this.ctx = null;
            this.initialized = false;
        }
        init() {
            if (!this.initialized) {
                this.ctx = new (window.AudioContext || window.webkitAudioContext)();
                this.initialized = true;
            }
        }
        createDistortionCurve(amount = 50) {
            const k = typeof amount === 'number' ? amount : 50,
                n_samples = 44100,
                curve = new Float32Array(n_samples),
                deg = Math.PI / 180;
            for (let i = 0; i < n_samples; ++i) {
                const x = (i * 2) / n_samples - 1;
                curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
            }
            return curve;
        }
        playHover() {
            if (!this.ctx) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(800, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + 0.05);
            gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.1);
        }
        playClick() {
            if (!this.ctx) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const distortion = this.ctx.createWaveShaper();
            osc.type = 'square';
            osc.frequency.setValueAtTime(150, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(20, this.ctx.currentTime + 0.3);
            distortion.curve = this.createDistortionCurve(400);
            distortion.oversample = '4x';
            gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.4);
            osc.connect(distortion);
            distortion.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.4);
        }
        playTransition() {
            if (!this.ctx) return;
            const osc1 = this.ctx.createOscillator();
            const osc2 = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const distortion = this.ctx.createWaveShaper();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(120, this.ctx.currentTime);
            osc1.frequency.exponentialRampToValueAtTime(10, this.ctx.currentTime + 1.0);
            osc2.type = 'triangle';
            osc2.frequency.setValueAtTime(800, this.ctx.currentTime);
            osc2.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 1.0);
            distortion.curve = this.createDistortionCurve(100);
            gain.gain.setValueAtTime(0.8, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 1.0);
            osc1.connect(gain);
            osc2.connect(distortion);
            distortion.connect(gain);
            gain.connect(this.ctx.destination);
            osc1.start();
            osc2.start();
            osc1.stop(this.ctx.currentTime + 1.0);
            osc2.stop(this.ctx.currentTime + 1.0);
        }
    }
    const audio = new AudioEngine();

    // ==========================================
    // 2. STATE
    // ==========================================
    let view = 'MAIN'; // MAIN, SETTINGS, IN_GAME
    let isTransitioning = false;
    let mouseX = 0, mouseY = 0;
    let masterVolume = 100, fov = 90, bloodEnabled = true;

    // ==========================================
    // 3. DOM REFERENCES
    // ==========================================
    const container = document.getElementById('menu-overlay');
    const mainContent = document.getElementById('menu-main-content');
    const settingsPanel = document.getElementById('menu-settings-panel');
    const parallaxWrapper = document.getElementById('menu-parallax-wrapper');
    const sigilLeft = document.getElementById('sigil-left');
    const sigilRight = document.getElementById('sigil-right');

    // ==========================================
    // 4. MOUSE PARALLAX
    // ==========================================
    window.addEventListener('mousemove', function(e) {
        mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
        mouseY = (e.clientY / window.innerHeight - 0.5) * 2;

        if (view === 'MAIN' && parallaxWrapper) {
            parallaxWrapper.style.transform =
                'perspective(' + (fov * 10) + 'px) rotateX(' + (mouseY * -15) + 'deg) rotateY(' + (mouseX * 15) + 'deg)' +
                (isTransitioning ? ' translateZ(200px)' : ' translateZ(0px)');
        }
        if (sigilLeft) sigilLeft.style.transform = 'rotate(' + (mouseX * 20) + 'deg)';
        if (sigilRight) sigilRight.style.transform = 'rotate(' + (mouseY * -20) + 'deg)';
    });

    // ==========================================
    // 5. NAVIGATION
    // ==========================================
    function navigateTo(targetView) {
        audio.init();
        audio.playClick();
        audio.playTransition();

        // If returning from settings during gameplay pause
        if (targetView === 'MAIN' && window._returnToPauseFromSettings) {
            window._returnToPauseFromSettings = false;
            container.style.display = 'none';
            var blocker = document.getElementById('blocker');
            document.getElementById('blocker-title').textContent = '暂停';
            document.getElementById('blocker-title').dataset.text = '暂停';
            document.getElementById('blocker-menu').style.display = 'flex';
            blocker.style.display = 'flex';
            return;
        }

        isTransitioning = true;
        container.classList.add('state-psychotic');

        setTimeout(function() {
            view = targetView;
            updateView();
            setTimeout(function() {
                isTransitioning = false;
                container.classList.remove('state-psychotic');
            }, 400);
        }, 600);
    }

    function updateView() {
        if (view === 'MAIN') {
            mainContent.style.display = 'flex';
            settingsPanel.style.display = 'none';
        } else if (view === 'SETTINGS') {
            mainContent.style.display = 'none';
            settingsPanel.style.display = 'flex';
        } else if (view === 'IN_GAME') {
            // Hide menu, show loading animation iframe
            container.style.display = 'none';
            var iframe = document.getElementById('loading-iframe');
            iframe.style.display = 'block';
            iframe.src = 'loading.html';

            // Start loading the actual game world in background (but DON'T lock pointer)
            // Show the hidden #loading div so static_world.js can write progress text to it
            document.getElementById('loading').style.display = 'block';
            window.loadGameWorld();
        }
    }

    // Called by loading.html iframe when dive animation finishes
    window.onLoadingComplete = function() {
        var iframe = document.getElementById('loading-iframe');
        iframe.style.display = 'none';
        iframe.src = '';
        document.getElementById('loading').style.display = 'none';

        // 通过统一入口进入游戏态（确保焦点、键盘、Pointer Lock 全部就绪）
        window.enterGameplay();
    };

    // ==========================================
    // 6. EVENT BINDINGS
    // ==========================================
    // Init audio on first click
    container.addEventListener('click', function() { audio.init(); });

    // Menu items
    document.querySelectorAll('[data-menu-action]').forEach(function(el) {
        el.addEventListener('click', function() {
            var action = el.dataset.menuAction;
            if (action === 'continue' || action === 'newgame') navigateTo('IN_GAME');
            else if (action === 'settings') navigateTo('SETTINGS');
            else if (action === 'back') navigateTo('MAIN');
        });
        el.addEventListener('mouseenter', function() {
            audio.init();
            audio.playHover();
        });
    });

    // Settings controls
    var volSlider = document.getElementById('menu-vol-slider');
    var volDisplay = document.getElementById('menu-vol-display');
    var fovSlider = document.getElementById('menu-fov-slider');
    var fovDisplay = document.getElementById('menu-fov-display');
    var bloodToggle = document.getElementById('menu-blood-toggle');
    var bloodDisplay = document.getElementById('menu-blood-display');

    if (volSlider) volSlider.addEventListener('input', function(e) {
        masterVolume = Number(e.target.value);
        volDisplay.textContent = masterVolume + '%';
        audio.init();
        var osc = audio.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = e.target.value * 10;
        osc.connect(audio.ctx.destination);
        osc.start();
        osc.stop(audio.ctx.currentTime + 0.05);
    });

    if (fovSlider) fovSlider.addEventListener('input', function(e) {
        fov = Number(e.target.value);
        fovDisplay.textContent = fov;
    });

    if (bloodToggle) bloodToggle.addEventListener('click', function() {
        bloodEnabled = !bloodEnabled;
        bloodDisplay.textContent = bloodEnabled ? 'ENABLED' : 'DISABLED';
        bloodDisplay.style.color = bloodEnabled ? '#ff003c' : '#999';
        audio.init();
        audio.playClick();
    });

    // ESC to close settings
    document.addEventListener('keydown', function(e) {
        if (e.code === 'Escape' && view === 'SETTINGS') {
            audio.init();
            audio.playClick();
            navigateTo('MAIN'); // This handles _returnToPauseFromSettings internally
        }
    });

})();
