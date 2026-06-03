/**
 * DEBUG.JS — Performance diagnostics panel + auto-leak detection + console export
 * Extracted from game-core.js. Reads window._gameScene, window._renderer, window._gamePlayer.
 */
(function() {
    'use strict';

    var _debugPanel = document.createElement('div');
    _debugPanel.id = 'debug-panel';
    _debugPanel.style.cssText = 'position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.85);color:#0f0;font:12px monospace;padding:10px;z-index:9999;pointer-events:none;display:none;min-width:280px;line-height:1.6;';
    document.body.appendChild(_debugPanel);
    var _debugVisible = false;
    var _fpsFrames = 0, _fpsLast = performance.now(), _fpsDisplay = 0;
    var _sceneChildrenMax = 0;

    document.addEventListener('keydown', function(e) {
        if (e.key === '`' || e.code === 'Backquote') {
            if (e.ctrlKey) return; // Ctrl+` handled separately
            _debugVisible = !_debugVisible;
            _debugPanel.style.display = _debugVisible ? 'block' : 'none';
        }
    });

    // Auto leak detection
    var _baseline = null;
    var _leakLog = [];
    var _sampleTimer = 0;
    var _stableFrames = 0;
    var _lastChildCount = 0;

    function updateDebugPanel() {
        var scene = window._gameScene;
        var renderer = window._renderer;
        if (!scene || !renderer) return;

        _fpsFrames++;
        var now = performance.now();
        if (now - _fpsLast >= 500) {
            _fpsDisplay = Math.round(_fpsFrames / ((now - _fpsLast) / 1000));
            _fpsFrames = 0;
            _fpsLast = now;
        }

        var childCount = 0;
        scene.traverse(function() { childCount++; });
        if (childCount > _sceneChildrenMax) _sceneChildrenMax = childCount;

        var info = renderer.info;
        var projCount = window._getProjectileCount ? window._getProjectileCount() : 0;
        var crossCount = window._getCrossParticleCount ? window._getCrossParticleCount() : 0;

        // === Auto leak detection ===
        var spellIdle = (projCount === 0 && crossCount === 0);

        if (spellIdle) {
            _stableFrames++;
        } else {
            _stableFrames = 0;
        }

        if (_stableFrames === 120 && !_baseline) {
            _baseline = { children: childCount, geometries: info.memory.geometries, time: now };
            _leakLog.push({ type: 'BASELINE', children: childCount, geo: info.memory.geometries });
        }

        if (_stableFrames === 120 && _baseline && _stableFrames > 0) {
            var childDelta = childCount - _baseline.children;
            var geoDelta = info.memory.geometries - _baseline.geometries;
            if (childDelta > 5 || geoDelta > 5) {
                _leakLog.push({
                    type: 'LEAK_DETECTED',
                    time: ((now - _baseline.time) / 1000).toFixed(1) + 's',
                    childrenNow: childCount,
                    childrenBaseline: _baseline.children,
                    childDelta: childDelta,
                    geoNow: info.memory.geometries,
                    geoBaseline: _baseline.geometries,
                    geoDelta: geoDelta
                });
                _baseline.children = childCount;
                _baseline.geometries = info.memory.geometries;
            }
        }

        if (!_debugVisible) return;

        var leakStatus = '';
        if (_leakLog.length > 0) {
            var last = _leakLog[_leakLog.length - 1];
            if (last.type === 'LEAK_DETECTED') {
                leakStatus = '<span style="color:#f00;font-weight:bold;">LEAK: +' + last.childDelta + ' children, +' + last.geoDelta + ' geo</span><br>';
            } else {
                leakStatus = '<span style="color:#0f0;">Baseline set (' + last.children + ' children)</span><br>';
            }
        } else {
            leakStatus = '<span style="color:#888;">Waiting for baseline (stop shooting 2s)...</span><br>';
        }

        var deltaFromBaseline = _baseline ? (childCount - _baseline.children) : 0;
        var deltaColor = deltaFromBaseline > 50 ? '#f00' : deltaFromBaseline > 10 ? '#ff0' : '#0f0';

        _debugPanel.innerHTML =
            '<b>== PERFORMANCE ==</b><br>' +
            'FPS: <span style="color:' + (_fpsDisplay < 30 ? '#f00' : _fpsDisplay < 50 ? '#ff0' : '#0f0') + '">' + _fpsDisplay + '</span><br>' +
            '<br><b>== SCENE ==</b><br>' +
            'Children: ' + childCount + ' (max: ' + _sceneChildrenMax + ')<br>' +
            'Draw calls: ' + info.render.calls + '<br>' +
            'Triangles: ' + info.render.triangles.toLocaleString() + '<br>' +
            '<br><b>== GPU MEMORY ==</b><br>' +
            'Geometries: ' + info.memory.geometries + '<br>' +
            'Textures: ' + info.memory.textures + '<br>' +
            '<br><b>== SCENE DELTA ==</b><br>' +
            'From baseline: <span style="color:' + deltaColor + '">' + (deltaFromBaseline > 0 ? '+' : '') + deltaFromBaseline + '</span><br>' +
            '<br><b>== ACTIVE ==</b><br>' +
            'Projectiles: ' + projCount + ' | Cross: ' + crossCount + '<br>' +
            '<br><b>== INSTANCED POOLS ==</b><br>' +
            (window._getInstParticlesInfo ? window._getInstParticlesInfo() : '...') + '<br>' +
            '<br><b>== LEAK DETECTOR ==</b><br>' +
            leakStatus +
            '<br><span style="color:#888">` hide | Ctrl+` log</span>';
    }

    // Auto debug log: POST to server every 60 frames
    var _autoLogTimer = 0;
    function _autoDebugLog() {
        var scene = window._gameScene;
        var renderer = window._renderer;
        var player = window._gamePlayer;
        if (!scene || !renderer || !player) return;

        _autoLogTimer++;
        if (_autoLogTimer % 60 !== 0) return;

        var nonMapCount = 0;
        var histogram = {};
        var pooledCount = 0, instancedCount = 0, mapCount2 = 0;
        for (var _si = 0; _si < scene.children.length; _si++) {
            var obj = scene.children[_si];
            if (obj.material && obj.material.type === 'ShaderMaterial') { mapCount2++; continue; }
            if (obj.type === 'LineSegments' && obj.material && obj.material.color && obj.material.color.getHex() === 0x000000) { mapCount2++; continue; }
            if (obj.isCamera) continue;
            if (obj._pooled) { pooledCount++; continue; }
            if (obj.isInstancedMesh) { instancedCount++; continue; }

            nonMapCount++;
            var geo = obj.geometry ? obj.geometry.type : 'noGeo';
            var color = obj.material && obj.material.color ? obj.material.color.getHexString() : '?';
            var vis = obj.visible ? 'V' : 'H';
            var key = geo + '|' + color + '|' + vis;
            histogram[key] = (histogram[key] || 0) + 1;
        }
        var sorted = Object.entries(histogram).sort(function(a,b){return b[1]-a[1];}).slice(0, 15);
        var nonMapObjects = sorted.map(function(e) { return { key: e[0], count: e[1] }; });

        var payload = {
            fps: _fpsDisplay,
            children: scene.children.length,
            nonMapCount: nonMapCount,
            drawCalls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
            geometries: renderer.info.memory.geometries,
            projectiles: window._getProjectileCount ? window._getProjectileCount() : 0,
            crossParticles: window._getCrossParticleCount ? window._getCrossParticleCount() : 0,
            playerPos: [+player.pos.x.toFixed(0), +player.pos.y.toFixed(0), +player.pos.z.toFixed(0)],
            nonMapHistogram: nonMapObjects,
            pooledCount: pooledCount,
            instancedCount: instancedCount,
            mapCount: mapCount2
        };

        fetch('/debug-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(function(){});
    }

    // Ctrl+` full export to console
    document.addEventListener('keydown', function(e) {
        if ((e.key === '`' || e.code === 'Backquote') && e.ctrlKey) {
            var scene = window._gameScene;
            if (!scene) return;

            console.log('=== LEAK DETECTION LOG ===');
            console.table(_leakLog);
            console.log('Current scene.children.length:', scene.children.length);

            var categories = {};
            var mapCount = 0;
            scene.children.forEach(function(obj) {
                var isMap = false;
                if (obj.material && obj.material.type === 'ShaderMaterial') isMap = true;
                if (obj.type === 'LineSegments' && obj.material && obj.material.color && obj.material.color.getHex() === 0x000000) isMap = true;

                if (isMap) { mapCount++; return; }

                var key = obj.type;
                if (obj.geometry) {
                    key += '(' + (obj.geometry.type || 'BufferGeo') + ')';
                }
                if (obj.material) {
                    var color = obj.material.color ? '#' + obj.material.color.getHexString() : 'none';
                    var opacity = obj.material.opacity !== undefined ? obj.material.opacity.toFixed(2) : '1';
                    key += ' color=' + color + ' op=' + opacity;
                }
                key += ' vis=' + obj.visible;
                if (!categories[key]) categories[key] = 0;
                categories[key]++;
            });

            console.log('Map objects:', mapCount);
            console.log('Non-map objects by category:');
            var sorted = Object.entries(categories).sort(function(a,b) { return b[1] - a[1]; });
            sorted.forEach(function(entry) {
                console.log('  ' + entry[1] + 'x ' + entry[0]);
            });
        }
    });

    // Expose
    window._updateDebugPanel = updateDebugPanel;
    window._autoDebugLog = _autoDebugLog;
})();
