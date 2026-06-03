/**
 * GAME-CORE.JS — 原始游戏核心逻辑
 *
 * 直接从 地图/超现实主义leveldesign/index.html 的内联脚本提取
 * 唯一修改: 添加 window.startGame() 供菜单调用，不自动启动
 */
(function() {
    'use strict';

    // === GLOBALS ===
    const MATS = {
        main: new THREE.MeshBasicMaterial({ color: 0xe5e5e5 }),
        accent: new THREE.MeshBasicMaterial({ color: 0xd0d0d0 }),
        dark: new THREE.MeshBasicMaterial({ color: 0x333333 }),
        chrome: new THREE.MeshBasicMaterial({ color: 0xcccccc }),
        cyan: new THREE.MeshBasicMaterial({ color: 0x00ffff }),
        wood: new THREE.MeshBasicMaterial({ color: 0xe5e5e5 }),
        edge: new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 })
    };
    window.MATS = MATS;

    const blocker = document.getElementById('blocker');
    const speedlines = document.getElementById('speedlines');
    const crosshair = document.getElementById('crosshair');
    const screenFlash = document.getElementById('screen-flash');
    const loadingEl = document.getElementById('loading');

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xe6f2ff, 150, 500);

    const camera = new THREE.PerspectiveCamera(100, window.innerWidth / window.innerHeight, 0.1, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.autoClear = false;
    document.body.appendChild(renderer.domElement);

    // Fade scene for motion trail / afterimage effect
    const fadeScene = new THREE.Scene();
    const fadeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const fadeMaterial = new THREE.MeshBasicMaterial({
        color: 0xe6f2ff,
        transparent: true,
        opacity: 0.15,
        depthTest: false
    });
    fadeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMaterial));

    const colliders = [];
    window.colliders = colliders;
    window.scene = scene;

    // === PLAYER ===
    const player = {
        pos: new THREE.Vector3(384, 115, 628),
        vel: new THREE.Vector3(0, 0, 0),
        size: new THREE.Vector3(0.6, 1.8, 0.6),
        dashDir: new THREE.Vector3(),
        onGround: false, jumpsLeft: 2, isDashing: false, dashTimer: 0,
        wallNormal: new THREE.Vector3(), isTouchingWall: false,
        footstepTimer: 0, climbStepTimer: 0,
        coyoteTimer: 0, hasJumped: false,
        speed: 28, airSpeed: 24, jumpForce: 21, gravity: 60,
        wallSlideGravity: 12, climbSpeed: 20, dashSpeed: 85,
        dashDuration: 0.15, friction: 20, airFriction: 3.5,
        yaw: 0, pitch: 0,
        onRail: false, railIndex: -1, railProgress: 0, railSpeed: 80
    };
    window.player = player;

    const keys = { w: false, a: false, s: false, d: false, shift: false, space: false };
    window._keys = keys;
    let prevSpace = false, prevShift = false;

    // VFX system loaded from core/vfx.js (window.triggerShake, window.spawnDebris, etc.)

    // === AUDIO ===
    // Audio system loaded from core/audio.js (window.audioCtx, window.playFootstep, etc.)

    // === LOAD WORLD ===
    async function loadWorld() {
        // Monitor loadingEl text changes to report real progress to iframe
        var progressObserver = new MutationObserver(function() {
            var text = loadingEl.textContent; // "LOADING 45/181..."
            var match = text.match(/(\d+)\/(\d+)/);
            if (match) {
                var current = parseInt(match[1]);
                var total = parseInt(match[2]);
                var pct = Math.floor((current / total) * 100);
                // Send to loading iframe
                var iframe = document.getElementById('loading-iframe');
                if (iframe && iframe.contentWindow) {
                    iframe.contentWindow.postMessage({ type: 'progress', value: pct }, '*');
                }
            }
        });
        progressObserver.observe(loadingEl, { childList: true, characterData: true, subtree: true });

        await loadStaticWorld();

        progressObserver.disconnect();

        // Safety platform at spawn
        spawnSolid(scene, colliders, new THREE.BoxGeometry(10, 2, 10), MATS.main, 384, 112, 628, 0, 0, 0);
        spatialInsert(colliders[colliders.length - 1]);
        loadingEl.style.display = 'none';
        // Don't show blocker here — onLoadingComplete will handle it
        window._gameWorldReady = true;

        // Notify iframe that loading is truly complete
        var iframe = document.getElementById('loading-iframe');
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({ type: 'progress', value: 100 }, '*');
        }
    }

    // === INPUT ===
    // Pointer lock only activates after game loop starts (window._gameLoopActive)
    window._gameLoopActive = false;
    var _hasEnteredOnce = false;

    document.addEventListener('click', function(e) {
        if(window.audioCtx && window.audioCtx.state==='suspended')window.audioCtx.resume();
        if(!window._gameLoopActive) return;

        // Handle blocker menu clicks
        if (e.target.id === 'blocker-resume') {
            document.body.requestPointerLock();
            return;
        }
        if (e.target.id === 'blocker-settings') {
            // Show settings panel (reuse menu's settings)
            blocker.style.display = 'none';
            var menuOverlay = document.getElementById('menu-overlay');
            menuOverlay.style.display = 'block';
            document.getElementById('menu-main-content').style.display = 'none';
            document.getElementById('menu-settings-panel').style.display = 'flex';
            // ESC in settings will return to pause
            window._returnToPauseFromSettings = true;
            return;
        }
        if (e.target.id === 'blocker-mainmenu') {
            window._gameLoopActive = false;
            blocker.style.display = 'none';
            // Reload page to return to menu
            window.location.reload();
            return;
        }

        // Normal click → lock pointer
        document.body.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', function() {
        if(document.pointerLockElement===document.body) {
            blocker.style.display='none';
            _hasEnteredOnce = true;
        } else {
            keys.w=keys.a=keys.s=keys.d=keys.space=keys.shift=false;
            if (_hasEnteredOnce && window._gameLoopActive) {
                // Show pause menu (not first-time enter screen)
                document.getElementById('blocker-title').textContent = '暂停';
                document.getElementById('blocker-title').dataset.text = '暂停';
                document.getElementById('blocker-menu').style.display = 'flex';
                blocker.style.display='flex';
            }
        }
    });
    document.addEventListener('mousemove', e => { if(document.pointerLockElement===document.body){player.yaw-=e.movementX*.0022;player.pitch-=e.movementY*.0022;player.pitch=Math.max(-Math.PI/2+.05,Math.min(Math.PI/2-.05,player.pitch));} });
    document.addEventListener('keydown', e => { switch(e.code){case 'KeyW':keys.w=true;break;case 'KeyS':keys.s=true;break;case 'KeyA':keys.a=true;break;case 'KeyD':keys.d=true;break;case 'Space':keys.space=true;e.preventDefault();break;case 'ShiftLeft':case 'ShiftRight':keys.shift=true;break;} });
    document.addEventListener('keyup', e => { switch(e.code){case 'KeyW':keys.w=false;break;case 'KeyS':keys.s=false;break;case 'KeyA':keys.a=false;break;case 'KeyD':keys.d=false;break;case 'Space':keys.space=false;break;case 'ShiftLeft':case 'ShiftRight':keys.shift=false;break;} });

    // === PHYSICS ===
    function checkCollision(px, py, pz) {
        return checkCollisionSpatial(px, py, pz, 0.3, 0.9, 0.3);
    }

    const clock = new THREE.Clock();
    function update() {
        const dt = _lastFrameDt;
        if(document.pointerLockElement !== document.body) return;

        // Rail
        updateRailSystem(player, dt, keys, prevSpace);
        if(player.onRail) {
            camera.position.copy(player.pos);camera.position.y+=.72;
            camera.rotation.set(0,0,0);camera.rotateY(player.yaw);camera.rotateX(player.pitch);
            var _fov=window._tickFovOffset(dt);camera.fov=THREE.MathUtils.lerp(camera.fov,115+_fov,dt*10);camera.updateProjectionMatrix();
            speedlines.style.opacity=.6;prevSpace=keys.space;window._updateShockwaves(dt);window._updateParticles(dt);return;
        }
        speedlines.style.opacity=player.isDashing?1:0;

        const footPos=player.pos.clone();footPos.y-=.9;
        const forward=new THREE.Vector3(Math.sin(player.yaw),0,Math.cos(player.yaw)).normalize();
        const right=new THREE.Vector3(forward.z,0,-forward.x).normalize();
        const moveDir=new THREE.Vector3();
        if(keys.w)moveDir.add(forward.clone().negate());if(keys.s)moveDir.add(forward);if(keys.a)moveDir.add(right.clone().negate());if(keys.d)moveDir.add(right);
        if(moveDir.length()>0)moveDir.normalize();

        // Dash
        if(keys.shift&&!prevShift&&!player.isDashing){player.isDashing=true;player.dashTimer=.15;window.playDash();window.triggerShake(.6,.2);window.triggerFlash('rgba(0,255,255,0.4)',1,.2);window._setFovOffset(50);player.dashDir.copy(moveDir.lengthSq()>0?moveDir:forward.clone().negate());window.spawnDebris(player.pos,null,window.matEnergyDash,20,35,1,true);player.vel.x=player.dashDir.x*85;player.vel.z=player.dashDir.z*85;player.vel.y=0;player.jumpsLeft=Math.max(player.jumpsLeft,1);}
        prevShift=keys.shift;
        if(player.isDashing){player.dashTimer-=dt;player.vel.y=0;window.spawnDebris(player.pos,player.dashDir.clone().negate(),window.matEnergyDash,2,12,.7,true);if(player.dashTimer<=0){player.isDashing=false;player.vel.x*=.6;player.vel.z*=.6;}}

        if(!player.isDashing){
            const ms=player.onGround?28:24;const lf=player.onGround?20*dt:3.5*dt;
            player.vel.x=THREE.MathUtils.lerp(player.vel.x,moveDir.x*ms,lf);player.vel.z=THREE.MathUtils.lerp(player.vel.z,moveDir.z*ms,lf);
            if(player.onGround&&(player.vel.x*player.vel.x+player.vel.z*player.vel.z)>5){player.footstepTimer-=dt;if(player.footstepTimer<=0){window.playFootstep();window.triggerShake(.04,.03);player.footstepTimer=.24;}}else player.footstepTimer=0;
        }

        // Wall
        player.isTouchingWall=false;player.wallNormal.set(0,0,0);
        if(checkCollision(player.pos.x+.15,player.pos.y,player.pos.z)){player.isTouchingWall=true;player.wallNormal.x=-1;}
        else if(checkCollision(player.pos.x-.15,player.pos.y,player.pos.z)){player.isTouchingWall=true;player.wallNormal.x=1;}
        if(checkCollision(player.pos.x,player.pos.y,player.pos.z+.15)){player.isTouchingWall=true;player.wallNormal.z=-1;}
        else if(checkCollision(player.pos.x,player.pos.y,player.pos.z-.15)){player.isTouchingWall=true;player.wallNormal.z=1;}
        if(player.wallNormal.lengthSq()>0)player.wallNormal.normalize();

        // Gravity + climb
        if(!player.isDashing){let grav=60;if(player.isTouchingWall&&!player.onGround){if(moveDir.dot(player.wallNormal)<-.1){player.vel.y=20;grav=0;window.triggerShake(.03,.05);window.spawnDebris(player.pos,player.wallNormal,window.matSparkOrange,1,8,.4,true);player.climbStepTimer-=dt;if(player.climbStepTimer<=0){window.playClimb();player.climbStepTimer=.14;}}else if(player.vel.y<0)grav=12;}player.vel.y-=grav*dt;}

        // Jump
        if(player.onGround){player.coyoteTimer=.2;player.jumpsLeft=2;if(!keys.space)player.hasJumped=false;}else player.coyoteTimer-=dt;
        if(keys.space&&player.coyoteTimer>0&&!player.hasJumped){player.vel.y=21;player.coyoteTimer=0;player.onGround=false;player.hasJumped=true;window.playJump(false);window.spawnShockwave(0xffffff,1);window.triggerShake(.2,.08);window.spawnDebris(footPos,new THREE.Vector3(0,1,0),window.matDebris,6,7,.8,false);}
        else if(keys.space&&!prevSpace&&player.coyoteTimer<=0){
            if(player.isTouchingWall){player.vel.y=21*1.1;player.vel.x=player.wallNormal.x*28*1.3;player.vel.z=player.wallNormal.z*28*1.3;player.jumpsLeft=1;window.playJump(true);window.spawnShockwave(0x0055ff,1.2);window.triggerShake(.3,.1);window.spawnDebris(player.pos,player.wallNormal,window.matEnergyBlue,10,20,.8,true);}
            else if(player.jumpsLeft>0){player.vel.y=21;player.jumpsLeft--;window.playJump(true);window.spawnShockwave(0x00aaff,1.8);window.triggerShake(.35,.1);window.spawnDebris(footPos,new THREE.Vector3(0,-1,0),window.matEnergyBlue,25,30,1,true);}
        }
        prevSpace=keys.space;

        // Collision
        player.isTouchingWall=false;player.wallNormal.set(0,0,0);
        player.pos.x+=player.vel.x*dt;let hx=checkCollision(player.pos.x,player.pos.y,player.pos.z);
        if(hx){if(player.vel.x>0){player.pos.x=hx.minX-.3-.001;player.wallNormal.x=-1;}else{player.pos.x=hx.maxX+.3+.001;player.wallNormal.x=1;}if(Math.abs(player.vel.x)>10)window.triggerShake(.08,.05);player.vel.x=0;player.isTouchingWall=true;}
        player.pos.z+=player.vel.z*dt;let hz=checkCollision(player.pos.x,player.pos.y,player.pos.z);
        if(hz){if(player.vel.z>0){player.pos.z=hz.minZ-.3-.001;player.wallNormal.z=-1;}else{player.pos.z=hz.maxZ+.3+.001;player.wallNormal.z=1;}if(Math.abs(player.vel.z)>10)window.triggerShake(.08,.05);player.vel.z=0;player.isTouchingWall=true;}
        player.pos.y+=player.vel.y*dt;let hy=checkCollision(player.pos.x,player.pos.y,player.pos.z);player.onGround=false;
        if(hy){if(player.vel.y<0){player.pos.y=hy.maxY+.9+.001;player.onGround=true;if(player.vel.y<-20){window.triggerShake(.2,.08);window.spawnDebris(footPos,new THREE.Vector3(0,1,0),window.matDebris,10,6,1,false);}if(hy.type==='balloon')handleBalloonCollision(player,hy);}else{player.pos.y=hy.minY-.9-.001;}player.vel.y=0;}

        // Death
        if(player.pos.y<-50){player.pos.set(384,115,628);player.vel.set(0,0,0);player.yaw=0;player.pitch=0;window.triggerFlash('rgba(255,0,0,0.6)',1,.4);}

        // Camera
        camera.position.copy(player.pos);camera.position.y+=.72;
        window._applyShake(camera, dt);
        camera.rotation.set(0,0,0);camera.rotateY(player.yaw);camera.rotateX(player.pitch);
        var _fovOff=window._tickFovOffset(dt);const spdB=Math.min(player.vel.length()*.4,20);const tFov=90+spdB+_fovOff;
        camera.fov=THREE.MathUtils.lerp(camera.fov,tFov,dt*(tFov>camera.fov?18:6));camera.updateProjectionMatrix();
        window._updateShockwaves(dt);window._updateParticles(dt);

        // HUD
        document.getElementById('height-display').textContent = Math.floor(player.pos.y);
    }

    window.addEventListener('resize', () => { camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();renderer.setSize(window.innerWidth,window.innerHeight); });


    var _lastFrameDt = 0;
    function animate() {
        requestAnimationFrame(animate);
        _lastFrameDt = Math.min(clock.getDelta(), 0.1);
        update();
        // 法术粒子系统始终更新 (不受pointer lock门控, 确保粒子能自清理)
        if (window._updateSpellSystem) window._updateSpellSystem(_lastFrameDt);
        // 场景垃圾收集器 (兜底清理泄漏的特效对象)
        if (window._spellGC) window._spellGC(_lastFrameDt);
        if (window.globalUniforms) window.globalUniforms.uTime.value = clock.elapsedTime;
        renderer.render(fadeScene, fadeCamera);
        renderer.render(scene, camera);
        if (window._updateDebugPanel) window._updateDebugPanel();
        if (window._autoDebugLog) window._autoDebugLog();
    }

    // === PUBLIC API (for menu integration) ===

    // Phase 1: Load world data (called when entering loading screen)
    // Does NOT lock pointer or start render loop
    window._gameWorldReady = false;
    window.loadGameWorld = function() {
        loadWorld().then(function() {
            window._gameWorldReady = true;
            // If user already clicked "进入地图" before loading finished, enter now
            if (window._pendingGameStart) {
                window._pendingGameStart = false;
                window.enterGameplay();
            }
        });
    };

    // Phase 2: Start render loop (called after user clicks "进入地图")
    window.startGameLoop = function() {
        if (!window._gameWorldReady) {
            // World not ready yet, defer until loadWorld() completes
            window._pendingGameStart = true;
            return;
        }
        window._gameLoopActive = true;
        animate();
    };

    // 统一的"进入游戏态"入口 —— 确保所有子系统原子性就绪
    window.enterGameplay = function() {
        // 1. 确保键盘焦点在主文档（iframe 会偷走焦点）
        window.focus();
        document.body.focus();

        // 2. 重置键盘状态（清除转场期间的脏状态）
        keys.w = keys.a = keys.s = keys.d = keys.space = keys.shift = false;

        // 3. 确保 Pointer Lock 生效
        if (document.pointerLockElement !== document.body) {
            document.body.requestPointerLock();
        }

        // 4. 启动游戏循环
        if (!window._gameLoopActive) {
            window.startGameLoop();
        }
    };

    // Legacy combined (if needed)
    window.startGame = function() {
        loadWorld();
        animate();
    };

    // Expose for weapon/enemy systems to hook into
    window._renderer = renderer;
    window._gameCamera = camera;
    window._gameScene = scene;
    window._gameColliders = colliders;
    window._gamePlayer = player;
    // _setFovOffset now in core/vfx.js
    window.spatialGrid = spatialGrid; // Expose for spell system's projectile collision

})();
