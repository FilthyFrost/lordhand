// SPAWNER.JS - Unified geometry creation with automatic AABB colliders
// NO EdgesGeometry — outlines are handled by post-process depth shader

const RAIL_CURVES = [];
const RAIL_SAMPLES = [];

function spawnSolid(scene, colliders, geo, mat, x, y, z, rx, ry, rz) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (rx || ry || rz) mesh.rotation.set(rx || 0, ry || 0, rz || 0);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), MATS.edge));
    scene.add(mesh);

    // AABB collider
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    let col;
    if (!rx && !ry && !rz) {
        const hw = (bb.max.x - bb.min.x) / 2;
        const hh = (bb.max.y - bb.min.y) / 2;
        const hd = (bb.max.z - bb.min.z) / 2;
        col = { minX: x-hw, maxX: x+hw, minY: y-hh, maxY: y+hh, minZ: z-hd, maxZ: z+hd, type: "normal" };
    } else {
        const tempBox = new THREE.Box3().setFromObject(mesh);
        col = { minX: tempBox.min.x, maxX: tempBox.max.x, minY: tempBox.min.y, maxY: tempBox.max.y, minZ: tempBox.min.z, maxZ: tempBox.max.z, type: "normal" };
    }
    colliders.push(col);
    return { mesh, collider: col };
}

function spawnDecor(scene, geo, mat, x, y, z, rx, ry, rz) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (rx || ry || rz) mesh.rotation.set(rx || 0, ry || 0, rz || 0);
    scene.add(mesh);
    return { mesh };
}

function spawnBalloon(scene, colliders, x, y, z) {
    const geo = new THREE.SphereGeometry(1.5, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    const col = { minX: x-1.5, maxX: x+1.5, minY: y-1.5, maxY: y+1.5, minZ: z-1.5, maxZ: z+1.5, type: "balloon" };
    colliders.push(col);
    return { mesh, collider: col };
}

function spawnRail(scene, curvePoints) {
    const curve = new THREE.CatmullRomCurve3(curvePoints);
    const samples = curve.getSpacedPoints(30);
    const railMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    const boxGeo = new THREE.BoxGeometry(1.5, 0.4, 2);

    const pts = curve.getSpacedPoints(40);
    for (let j = 0; j < pts.length; j++) {
        const pt = pts[j];
        const tangent = curve.getTangentAt(j / pts.length);
        const rm = new THREE.Mesh(boxGeo, railMat);
        rm.position.copy(pt);
        rm.lookAt(pt.clone().add(tangent));
        scene.add(rm);
    }

    const idx = RAIL_CURVES.length;
    RAIL_CURVES.push(curve);
    RAIL_SAMPLES.push(samples);
    return { curve, samples, globalIndex: idx };
}
