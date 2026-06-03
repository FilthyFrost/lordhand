// SPATIAL_HASH.JS - Grid-based spatial partitioning for fast collision detection
// Divides world into cells. checkCollision only scans nearby cells instead of ALL colliders.

const CELL_SIZE = 20; // Each cell is 20x20x20 units
const spatialGrid = {}; // "cx_cy_cz" → [collider, collider, ...]

function getCellKey(x, y, z) {
    const cx = Math.floor(x / CELL_SIZE);
    const cy = Math.floor(y / CELL_SIZE);
    const cz = Math.floor(z / CELL_SIZE);
    return `${cx}_${cy}_${cz}`;
}

/**
 * Insert a collider into the spatial grid.
 * A collider may span multiple cells — insert it into all cells it overlaps.
 */
function spatialInsert(col) {
    const minCX = Math.floor(col.minX / CELL_SIZE);
    const maxCX = Math.floor(col.maxX / CELL_SIZE);
    const minCY = Math.floor(col.minY / CELL_SIZE);
    const maxCY = Math.floor(col.maxY / CELL_SIZE);
    const minCZ = Math.floor(col.minZ / CELL_SIZE);
    const maxCZ = Math.floor(col.maxZ / CELL_SIZE);

    for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cy = minCY; cy <= maxCY; cy++) {
            for (let cz = minCZ; cz <= maxCZ; cz++) {
                const key = `${cx}_${cy}_${cz}`;
                if (!spatialGrid[key]) spatialGrid[key] = [];
                spatialGrid[key].push(col);
            }
        }
    }
}

/**
 * Build the spatial grid from the global colliders array.
 * Call this ONCE after all buildings and corridors are loaded.
 */
function buildSpatialGrid(colliders) {
    // Clear existing grid
    for (const key in spatialGrid) delete spatialGrid[key];

    for (const col of colliders) {
        spatialInsert(col);
    }

    const cellCount = Object.keys(spatialGrid).length;
    const avgPerCell = colliders.length > 0 ? (Object.values(spatialGrid).reduce((s, c) => s + c.length, 0) / cellCount).toFixed(1) : 0;
    console.log(`[SPATIAL] Grid built: ${colliders.length} colliders → ${cellCount} cells (avg ${avgPerCell}/cell)`);
}

/**
 * Fast collision check using spatial grid.
 * Only checks colliders in the cell(s) the player overlaps.
 */
function checkCollisionSpatial(px, py, pz, hw, hh, hd) {
    // Determine which cells the player AABB overlaps
    const minCX = Math.floor((px - hw) / CELL_SIZE);
    const maxCX = Math.floor((px + hw) / CELL_SIZE);
    const minCY = Math.floor((py - hh) / CELL_SIZE);
    const maxCY = Math.floor((py + hh) / CELL_SIZE);
    const minCZ = Math.floor((pz - hd) / CELL_SIZE);
    const maxCZ = Math.floor((pz + hd) / CELL_SIZE);

    for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cy = minCY; cy <= maxCY; cy++) {
            for (let cz = minCZ; cz <= maxCZ; cz++) {
                const key = `${cx}_${cy}_${cz}`;
                const cell = spatialGrid[key];
                if (!cell) continue;
                for (const c of cell) {
                    if (px + hw > c.minX && px - hw < c.maxX &&
                        py + hh > c.minY && py - hh < c.maxY &&
                        pz + hd > c.minZ && pz - hd < c.maxZ) {
                        return c;
                    }
                }
            }
        }
    }
    return null;
}
