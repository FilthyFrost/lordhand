// STATIC_WORLD.JS - Acid Holy Shader Pipeline
// Cel shading + vertex wobble + spherical collapse + acid rim light + inverted hull outline

const LIGHT_DIR = new THREE.Vector3(1.0, 1.5, 0.8).normalize();
const OUTLINE_THICKNESS = 0.06;

// Global time uniform (shared by all shader materials, updated each frame)
const globalUniforms = {
    uTime: { value: 0 },
    uLightDir: { value: LIGHT_DIR },
    uShadowColor: { value: new THREE.Color(0x99bbff) }
};
window.globalUniforms = globalUniforms; // Expose for game loop to update

// ★ Acid Holy Shader: wobble vertices + cel shading + acid rim light ★
const acidHolyShaderDef = {
    vertexShader: `
        uniform float uTime;
        varying vec3 vViewNormal;
        varying vec3 vViewPos;
        varying vec3 vColor;

        void main() {
            vColor = color;

            // Acid wobble: smooth eerie crawling displacement
            float wobble = sin(position.x * 2.5 + uTime * 2.0) * cos(position.y * 2.5 + uTime * 1.5) * 0.2;
            wobble += sin(position.z * 3.0 - uTime * 1.0) * 0.1;

            vec3 displacedPos = position + normal * wobble;
            vec4 mvPosition = modelViewMatrix * vec4(displacedPos, 1.0);

            // Hyper Demon spherical collapse (fisheye distortion)
            float dist = length(mvPosition.xyz);
            mvPosition.xy *= max(1.0 - dist * 0.0015, 0.3);

            vViewPos = -mvPosition.xyz;
            vViewNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform vec3 uLightDir;
        uniform vec3 uShadowColor;

        varying vec3 vViewNormal;
        varying vec3 vViewPos;
        varying vec3 vColor;

        void main() {
            // Hard cel shadow cut
            float intensity = dot(vViewNormal, uLightDir);
            float shadowThreshold = step(0.1, intensity);
            vec3 shadowCol = vColor * uShadowColor;
            vec3 baseComicColor = mix(shadowCol, vColor, shadowThreshold);

            gl_FragColor = vec4(baseComicColor, 1.0);
        }
    `
};

// Outline shader (synced wobble + spherical collapse)
const outlineShaderDef = {
    vertexShader: `
        uniform float uTime;
        uniform float uOutlineThickness;

        void main() {
            float wobble = sin(position.x * 2.5 + uTime * 2.0) * cos(position.y * 2.5 + uTime * 1.5) * 0.2;
            wobble += sin(position.z * 3.0 - uTime * 1.0) * 0.1;

            vec3 displacedPos = position + normal * (uOutlineThickness + wobble);
            vec4 mvPosition = modelViewMatrix * vec4(displacedPos, 1.0);

            // Same spherical collapse as body
            float dist = length(mvPosition.xyz);
            mvPosition.xy *= max(1.0 - dist * 0.0015, 0.3);

            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        void main() {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        }
    `
};

async function loadStaticWorld() {
    console.log('[WORLD] Loading with Acid Holy Shader...');
    const loadingEl = document.getElementById('loading');

    const manifestResp = await fetch('data/baked/manifest.json');
    const manifest = await manifestResp.json();
    console.log(`[WORLD] ${manifest.regions.length} regions, ${manifest.totalBoxes} boxes`);

    // Shared materials
    const celMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: globalUniforms.uTime,
            uLightDir: globalUniforms.uLightDir,
            uShadowColor: globalUniforms.uShadowColor
        },
        vertexShader: acidHolyShaderDef.vertexShader,
        fragmentShader: acidHolyShaderDef.fragmentShader,
        vertexColors: true
    });

    const outlineMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: globalUniforms.uTime,
            uOutlineThickness: { value: OUTLINE_THICKNESS }
        },
        vertexShader: outlineShaderDef.vertexShader,
        fragmentShader: outlineShaderDef.fragmentShader,
        side: THREE.BackSide
    });

    for (let i = 0; i < manifest.regions.length; i++) {
        const region = manifest.regions[i];
        if (loadingEl) loadingEl.textContent = `LOADING ${i + 1}/${manifest.regions.length}...`;

        // Load mesh binary
        const meshResp = await fetch(`data/baked/${region.mesh}`);
        const meshBuf = await meshResp.arrayBuffer();
        const meshView = new DataView(meshBuf);

        const numVerts = meshView.getUint32(0, true);
        const numIndices = meshView.getUint32(4, true);

        const posOffset = 8;
        const positions = new Float32Array(meshBuf, posOffset, numVerts * 3);
        const colorOffset = posOffset + numVerts * 3 * 4;
        const colors = new Float32Array(meshBuf, colorOffset, numVerts * 3);
        const idxOffset = colorOffset + numVerts * 3 * 4;
        const indices = new Uint32Array(meshBuf, idxOffset, numIndices);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.setIndex(new THREE.BufferAttribute(indices, 1));
        geo.computeVertexNormals();
        geo.computeBoundingSphere();

        // Body mesh (acid cel shaded)
        scene.add(new THREE.Mesh(geo, celMat));

        // Outline mesh (inverted hull)
        scene.add(new THREE.Mesh(geo, outlineMat));

        // Register colliders
        const chunkResp = await fetch(`data/chunks/chunk_${region.cx}_${region.cz}.json`);
        const chunkData = await chunkResp.json();
        for (const box of chunkData.boxes) {
            colliders.push({
                minX: box.x - box.w / 2, maxX: box.x + box.w / 2,
                minY: box.y - box.h / 2, maxY: box.y + box.h / 2,
                minZ: box.z - box.d / 2, maxZ: box.z + box.d / 2,
                type: "normal"
            });
        }
    }

    buildSpatialGrid(colliders);
    console.log(`[WORLD] Done: ${colliders.length} colliders, ${manifest.regions.length * 2} draw calls`);
}
