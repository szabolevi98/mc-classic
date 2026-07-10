'use strict';
/* ═══════════════════════════════════════════════════════════════
   MC CLASSIC CLONE — Three.js voxel játék
   Véges világ (128×128×128), a szélén óceán. Chunk-alapú meshing,
   procedurális textúra-atlasz, mentés localStorage-ba (RLE).
   ═══════════════════════════════════════════════════════════════ */

// ═══ ALAP KONSTANSOK ═══
const SX = 128, SZ = 128, SY = 128;  // világméret (magas plafon a nagy épületekhez)
const SEA = 30;                      // tengerszint (legfelső vízblokk y-ja)
const CHUNK = 16;                    // chunk oldalhossz (oszlopokban)

// ═══ RNG + ZAJ ═══
let SEED = (Math.random() * 0xFFFFFFFF) >>> 0;

function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = Math.imul(s + 0x6D2B79F5, 1) | 0;
    s = (s ^ s >>> 15) * (1 | s);
    s = s + Math.imul(s ^ s >>> 7, 61 | s) ^ s;
    return ((s ^ s >>> 14) >>> 0) / 4294967296;
  };
}
function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) ^ Math.imul(iz, 1234567891) ^ SEED) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function hash3(ix, iy, iz) {
  let h = (Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1274126177) ^ SEED) | 0;
  h = Math.imul(h ^ (h >>> 13), 1540483477);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
function smooth(t) { return t * t * (3 - 2 * t); }
function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
function fbm2(x, z) {
  return noise2(x, z) * 0.55 + noise2(x * 2.13 + 37, z * 2.13 + 91) * 0.28 +
         noise2(x * 4.7 + 113, z * 4.7 + 5) * 0.17;
}
function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
  const c000 = hash3(ix, iy, iz),     c100 = hash3(ix + 1, iy, iz);
  const c010 = hash3(ix, iy + 1, iz), c110 = hash3(ix + 1, iy + 1, iz);
  const c001 = hash3(ix, iy, iz + 1),     c101 = hash3(ix + 1, iy, iz + 1);
  const c011 = hash3(ix, iy + 1, iz + 1), c111 = hash3(ix + 1, iy + 1, iz + 1);
  const x00 = c000 + (c100 - c000) * fx, x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx, x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

// ═══ BLOKK-AZONOSÍTÓK (mentés-kompatibilis, NE rendezd át!) ═══
const AIR = 0, STONE = 1, GRASS = 2, DIRT = 3, COBBLE = 4, PLANKS = 5, BEDROCK = 6,
      SAND = 7, GRAVEL = 8, LOG = 9, LEAVES = 10, SPONGE = 11, GLASS = 12,
      COAL_ORE = 13, IRON_ORE = 14, GOLD_ORE = 15, IRON_BLK = 16, GOLD_BLK = 17,
      BRICK = 18, MOSSY = 19, OBSIDIAN = 20, SHELF = 21, WATER = 22,
      WOOL0 = 23, /* 23..38: 16 gyapjúszín */
      FLOWER_Y = 39, FLOWER_R = 40, FLOWER_B = 41, FLOWER_P = 42, FLOWER_W = 43,
      MUSH_R = 44, MUSH_B = 45, SAPLING = 46,
      DIAMOND_ORE = 47, DIAMOND_BLK = 48, LAVA = 49;

// ═══ TEXTÚRA-ATLASZ (procedurális, 16px csempék, 16×4 rács) ═══
const TILE = 16, ACOLS = 16, AROWS = 4;
const atlasCanvas = document.createElement('canvas');
atlasCanvas.width = ACOLS * TILE; atlasCanvas.height = AROWS * TILE;
const AG = atlasCanvas.getContext('2d');
let tileCount = 0;

function addTile(draw) {
  const ti = tileCount++;
  const gx = (ti % ACOLS) * TILE, gy = Math.floor(ti / ACOLS) * TILE;
  const rng = makeRng(0xC0FFEE + ti * 7919);
  AG.save();
  AG.translate(gx, gy);
  draw(AG, rng);
  AG.restore();
  return ti;
}
function P(g, x, y, r, gr, b, a = 255) {
  g.fillStyle = 'rgba(' + (r | 0) + ',' + (gr | 0) + ',' + (b | 0) + ',' + (a / 255) + ')';
  g.fillRect(x, y, 1, 1);
}
// alap zajos csempe
function noisy(g, rng, r, gr, b, v) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = (rng() - 0.5) * 2 * v;
    P(g, x, y, r + d, gr + d, b + d);
  }
}

const T_GRASS_TOP = addTile((g, r) => noisy(g, r, 106, 170, 64, 20));
const T_DIRT = addTile((g, r) => noisy(g, r, 134, 96, 67, 16));
const T_GRASS_SIDE = addTile((g, r) => {
  noisy(g, r, 134, 96, 67, 16);
  for (let x = 0; x < 16; x++) {
    const depth = 2 + (r() < 0.5 ? 1 : 0);
    for (let y = 0; y < depth; y++) {
      const d = (r() - 0.5) * 30;
      P(g, x, y, 100 + d, 165 + d, 60 + d);
    }
  }
});
const T_STONE = addTile((g, r) => noisy(g, r, 128, 128, 128, 11));
const T_COBBLE = addTile((g, r) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const n = noise2(x * 0.5 + 3, y * 0.5 + 7);
    const s = 88 + n * 70 + (r() - 0.5) * 18;
    P(g, x, y, s, s, s);
  }
});
const T_BEDROCK = addTile((g, r) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const s = [38, 60, 84, 105][ (r() * 4) | 0 ];
    P(g, x, y, s, s, s);
  }
});
const T_PLANKS = addTile((g, r) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let rr = 176, gg = 143, bb = 88;
    const d = (r() - 0.5) * 16;
    if (y % 4 === 3) { rr = 130; gg = 100; bb = 55; }
    P(g, x, y, rr + d, gg + d, bb + d);
  }
});
const T_LOG_SIDE = addTile((g, r) => {
  for (let x = 0; x < 16; x++) {
    const stripe = noise2(x * 0.9 + 11, 3) * 34;
    for (let y = 0; y < 16; y++) {
      const d = (r() - 0.5) * 14;
      P(g, x, y, 103 - stripe + d, 78 - stripe * 0.7 + d, 47 - stripe * 0.4 + d);
    }
  }
});
const T_LOG_TOP = addTile((g, r) => {
  noisy(g, r, 103, 78, 47, 10);
  for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) {
    const dx = Math.abs(x - 7.5), dy = Math.abs(y - 7.5);
    const ring = Math.floor(Math.max(dx, dy));
    const s = ring % 2 === 0 ? 22 : 0;
    const d = (r() - 0.5) * 10;
    P(g, x, y, 172 + s + d, 138 + s + d, 84 + s * 0.6 + d);
  }
});
const T_LEAVES = addTile((g, r) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (r() < 0.22) continue;               // átlátszó lyukak
    const d = (r() - 0.5) * 34;
    P(g, x, y, 56 + d, 132 + d, 38 + d);
  }
});
const T_SAND = addTile((g, r) => noisy(g, r, 219, 207, 163, 12));
const T_GRAVEL = addTile((g, r) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (r() < 0.3) { const d = (r() - 0.5) * 20; P(g, x, y, 148 + d, 128 + d, 110 + d); }
    else { const s = 118 + (r() - 0.5) * 44; P(g, x, y, s, s, s); }
  }
});
const T_WATER = addTile((g, r) => {
  noisy(g, r, 46, 86, 214, 16);
  for (let i = 0; i < 5; i++) {
    const y = (r() * 16) | 0, x0 = (r() * 10) | 0;
    for (let x = x0; x < Math.min(16, x0 + 4 + r() * 4); x++) P(g, x, y, 90, 130, 235);
  }
});
const T_LAVA = addTile((g, r) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const n = noise2(x * 0.35 + 55, y * 0.35 + 99);
    const d = (r() - 0.5) * 26;
    if (n > 0.55) P(g, x, y, 250, 150 + n * 60 + d, 30 + d * 0.4);
    else P(g, x, y, 196 + d, 66 + d * 0.5, 14);
  }
  // izzó erek
  for (let i = 0; i < 4; i++) {
    const y0 = (r() * 16) | 0, x0 = (r() * 8) | 0;
    for (let x = x0; x < Math.min(16, x0 + 5 + r() * 5); x++) P(g, x, y0, 255, 222, 92);
  }
});
const T_GLASS = addTile((g, r) => {
  for (let i = 0; i < 16; i++) {
    P(g, i, 0, 210, 228, 236); P(g, i, 15, 210, 228, 236);
    P(g, 0, i, 210, 228, 236); P(g, 15, i, 210, 228, 236);
  }
  for (let i = 0; i < 4; i++) { P(g, 3 + i, 11 - i, 235, 245, 250); }
  P(g, 11, 3, 235, 245, 250); P(g, 12, 2, 235, 245, 250);
});
const T_SPONGE = addTile((g, r) => {
  noisy(g, r, 196, 187, 64, 14);
  for (let i = 0; i < 16; i++) {
    const x = (r() * 16) | 0, y = (r() * 16) | 0;
    P(g, x, y, 150, 140, 30);
  }
});
function oreTile(cr, cg, cb) {
  return addTile((g, r) => {
    noisy(g, r, 128, 128, 128, 11);
    for (let i = 0; i < 6; i++) {
      const x = 1 + (r() * 13) | 0, y = 1 + (r() * 13) | 0;
      P(g, x, y, cr, cg, cb); P(g, x + 1, y, cr, cg, cb);
      if (r() < 0.7) P(g, x, y + 1, cr * 0.85, cg * 0.85, cb * 0.85);
      if (r() < 0.4) P(g, x + 1, y + 1, cr * 0.85, cg * 0.85, cb * 0.85);
    }
  });
}
const T_COAL = oreTile(35, 35, 35);
const T_IRON = oreTile(216, 167, 133);
const T_GOLD = oreTile(252, 238, 105);
const T_DIAMOND = oreTile(115, 232, 226);
function metalTile(cr, cg, cb) {
  return addTile((g, r) => {
    noisy(g, r, cr, cg, cb, 5);
    for (let i = 0; i < 16; i++) { P(g, i, 0, cr + 22, cg + 22, cb + 22); P(g, 0, i, cr + 22, cg + 22, cb + 22); }
    for (let i = 0; i < 16; i++) { P(g, i, 15, cr - 34, cg - 34, cb - 34); P(g, 15, i, cr - 34, cg - 34, cb - 34); }
  });
}
const T_IRON_BLK = metalTile(222, 222, 222);
const T_GOLD_BLK = metalTile(248, 216, 66);
const T_DIAMOND_BLK = metalTile(112, 222, 214);
const T_BRICK = addTile((g, r) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = Math.floor(y / 4);
    const mortarH = (y % 4 === 3);
    const off = row % 2 === 0 ? 0 : 4;
    const mortarV = ((x + off) % 8 === 7);
    if (mortarH || mortarV) { const d = (r() - 0.5) * 10; P(g, x, y, 178 + d, 178 + d, 178 + d); }
    else { const d = (r() - 0.5) * 18; P(g, x, y, 152 + d, 62 + d, 50 + d); }
  }
});
const T_MOSSY = addTile((g, r) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const n = noise2(x * 0.5 + 3, y * 0.5 + 7);
    const s = 88 + n * 70 + (r() - 0.5) * 18;
    P(g, x, y, s, s, s);
  }
  for (let i = 0; i < 9; i++) {
    const x = (r() * 14) | 0, y = (r() * 14) | 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
      if (r() < 0.8) P(g, x + dx, y + dy, 88 + (r() - 0.5) * 20, 132, 58);
  }
});
const T_OBSIDIAN = addTile((g, r) => {
  noisy(g, r, 22, 16, 34, 8);
  for (let i = 0; i < 7; i++) P(g, (r() * 16) | 0, (r() * 16) | 0, 74, 44, 116);
});
const T_SHELF = addTile((g, r) => {
  // deszka háttér + két sor színes könyvgerinc
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = (r() - 0.5) * 16;
    P(g, x, y, 176 + d, 143 + d, 88 + d);
  }
  const spineCols = [[168,60,50],[60,90,160],[70,130,60],[160,140,60],[120,70,140],[190,190,190]];
  for (const y0 of [2, 9]) {
    for (let x = 1; x < 15; x += 2) {
      const c = spineCols[(r() * spineCols.length) | 0];
      for (let y = y0; y < y0 + 5; y++) { P(g, x, y, c[0], c[1], c[2]); P(g, x + 1, y, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8); }
    }
  }
});
// 16 klasszikus gyapjúszín
const WOOL_COLORS = [
  [200, 48, 48], [222, 136, 40], [222, 222, 48], [136, 222, 40],
  [56, 200, 56], [48, 222, 136], [40, 200, 200], [96, 160, 240],
  [110, 110, 245], [140, 90, 230], [170, 60, 220], [210, 60, 210],
  [230, 70, 150], [72, 72, 72], [150, 150, 150], [242, 242, 242],
];
const T_WOOL = WOOL_COLORS.map(c => addTile((g, r) => {
  noisy(g, r, c[0], c[1], c[2], 14);
  for (let y = 3; y < 16; y += 4) for (let x = 0; x < 16; x++)
    if (r() < 0.6) P(g, x, y, c[0] * 0.86, c[1] * 0.86, c[2] * 0.86);
}));
// virágok (5 szín) — átlátszó hátterű "sprite" csempék
function flowerTile(cr, cg, cb, centR, centG, centB) {
  return addTile((g, r) => {
    for (let y = 8; y < 15; y++) P(g, 8, y, 34, 120, 34);
    P(g, 7, 11, 40, 130, 40); P(g, 9, 12, 40, 130, 40);       // levelek
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (Math.abs(dx) + Math.abs(dy) === 2 && r() < 0.4) continue;
      P(g, 8 + dx * 2, 4 + dy * 2, cr, cg, cb);
      P(g, 8 + dx, 4 + dy, cr, cg, cb);
    }
    P(g, 8, 4, centR, centG, centB);
  });
}
const T_FLOWER_Y = flowerTile(228, 208, 42, 200, 130, 30);
const T_FLOWER_R = flowerTile(210, 50, 40, 240, 220, 70);
const T_FLOWER_B = flowerTile(70, 110, 235, 240, 220, 70);
const T_FLOWER_P = flowerTile(170, 70, 220, 240, 220, 70);
const T_FLOWER_W = flowerTile(240, 240, 240, 240, 220, 70);
function mushTile(cr, cg, cb) {
  return addTile((g, r) => {
    for (let y = 8; y < 15; y++) { P(g, 7, y, 225, 218, 200); P(g, 8, y, 205, 198, 180); }
    for (let y = 4; y < 8; y++) {
      const w = y === 4 ? 3 : 5;
      for (let x = 8 - w; x <= 7 + w; x++) P(g, x, y, cr, cg, cb);
    }
    P(g, 5, 5, 245, 245, 245); P(g, 10, 6, 245, 245, 245); P(g, 7, 4, 245, 245, 245);
  });
}
const T_MUSH_R = mushTile(196, 42, 42);
const T_MUSH_B = mushTile(146, 104, 66);
const T_SAPLING = addTile((g, r) => {
  for (let y = 9; y < 15; y++) P(g, 8, y, 103, 78, 47);
  for (let i = 0; i < 16; i++) {
    const x = 4 + (r() * 8) | 0, y = 2 + (r() * 7) | 0;
    P(g, x, y, 50 + (r() - 0.5) * 30, 140 + (r() - 0.5) * 30, 40);
  }
});

// ═══ BLOKK-REGISZTER ═══
// tiles: [top, bottom, side] ; icon: hotbar/menü ikon csempéje
function B(name, tiles, opts = {}) {
  return Object.assign({
    name, tiles,
    icon: tiles ? tiles[2] : 0,
    solid: true, opaque: true, plant: false, water: false, cutout: false, sel: true,
  }, opts);
}
const BLOCKS = [];
BLOCKS[AIR]      = B('air', null, { solid: false, opaque: false, sel: false });
BLOCKS[STONE]    = B('Stone', [T_STONE, T_STONE, T_STONE]);
BLOCKS[GRASS]    = B('Grass', [T_GRASS_TOP, T_DIRT, T_GRASS_SIDE]);
BLOCKS[DIRT]     = B('Dirt', [T_DIRT, T_DIRT, T_DIRT]);
BLOCKS[COBBLE]   = B('Cobblestone', [T_COBBLE, T_COBBLE, T_COBBLE]);
BLOCKS[PLANKS]   = B('Planks', [T_PLANKS, T_PLANKS, T_PLANKS]);
BLOCKS[BEDROCK]  = B('Bedrock', [T_BEDROCK, T_BEDROCK, T_BEDROCK], { sel: false });
BLOCKS[SAND]     = B('Sand', [T_SAND, T_SAND, T_SAND]);
BLOCKS[GRAVEL]   = B('Gravel', [T_GRAVEL, T_GRAVEL, T_GRAVEL]);
BLOCKS[LOG]      = B('Log', [T_LOG_TOP, T_LOG_TOP, T_LOG_SIDE]);
BLOCKS[LEAVES]   = B('Leaves', [T_LEAVES, T_LEAVES, T_LEAVES], { opaque: false, cutout: true });
BLOCKS[SPONGE]   = B('Sponge', [T_SPONGE, T_SPONGE, T_SPONGE]);
BLOCKS[GLASS]    = B('Glass', [T_GLASS, T_GLASS, T_GLASS], { opaque: false, cutout: true });
BLOCKS[COAL_ORE] = B('Coal Ore', [T_COAL, T_COAL, T_COAL]);
BLOCKS[IRON_ORE] = B('Iron Ore', [T_IRON, T_IRON, T_IRON]);
BLOCKS[GOLD_ORE] = B('Gold Ore', [T_GOLD, T_GOLD, T_GOLD]);
BLOCKS[IRON_BLK] = B('Iron Block', [T_IRON_BLK, T_IRON_BLK, T_IRON_BLK]);
BLOCKS[GOLD_BLK] = B('Gold Block', [T_GOLD_BLK, T_GOLD_BLK, T_GOLD_BLK]);
BLOCKS[BRICK]    = B('Bricks', [T_BRICK, T_BRICK, T_BRICK]);
BLOCKS[MOSSY]    = B('Mossy Cobble', [T_MOSSY, T_MOSSY, T_MOSSY]);
BLOCKS[OBSIDIAN] = B('Obsidian', [T_OBSIDIAN, T_OBSIDIAN, T_OBSIDIAN]);
BLOCKS[SHELF]    = B('Bookshelf', [T_PLANKS, T_PLANKS, T_SHELF]);
BLOCKS[WATER]    = B('Water', [T_WATER, T_WATER, T_WATER],
                     { solid: false, opaque: false, water: true, sel: true });
for (let i = 0; i < 16; i++) {
  BLOCKS[WOOL0 + i] = B('Wool', [T_WOOL[i], T_WOOL[i], T_WOOL[i]]);
}
function plantB(name, tile) {
  return B(name, [tile, tile, tile],
    { solid: false, opaque: false, plant: true, cutout: true, icon: tile });
}
BLOCKS[FLOWER_Y] = plantB('Dandelion', T_FLOWER_Y);
BLOCKS[FLOWER_R] = plantB('Rose', T_FLOWER_R);
BLOCKS[FLOWER_B] = plantB('Blue Flower', T_FLOWER_B);
BLOCKS[FLOWER_P] = plantB('Purple Flower', T_FLOWER_P);
BLOCKS[FLOWER_W] = plantB('White Flower', T_FLOWER_W);
BLOCKS[MUSH_R]   = plantB('Red Mushroom', T_MUSH_R);
BLOCKS[MUSH_B]   = plantB('Brown Mushroom', T_MUSH_B);
BLOCKS[SAPLING]  = plantB('Sapling', T_SAPLING);
BLOCKS[DIAMOND_ORE] = B('Diamond Ore', [T_DIAMOND, T_DIAMOND, T_DIAMOND]);
BLOCKS[DIAMOND_BLK] = B('Diamond Block', [T_DIAMOND_BLK, T_DIAMOND_BLK, T_DIAMOND_BLK]);
BLOCKS[LAVA]        = B('Lava', [T_LAVA, T_LAVA, T_LAVA],
                        { solid: false, opaque: false, lava: true, sel: true });

// a Select block menü sorrendje
const SELECT_ORDER = [
  STONE, COBBLE, DIRT, GRASS, PLANKS, LOG, LEAVES, SAPLING,
  FLOWER_Y, FLOWER_R, FLOWER_B, FLOWER_P, FLOWER_W, MUSH_R, MUSH_B,
  SAND, GRAVEL, WATER, LAVA, SPONGE, GLASS,
  COAL_ORE, IRON_ORE, GOLD_ORE, DIAMOND_ORE,
  IRON_BLK, GOLD_BLK, DIAMOND_BLK, BRICK, MOSSY, OBSIDIAN, SHELF,
  WOOL0, WOOL0+1, WOOL0+2, WOOL0+3, WOOL0+4, WOOL0+5, WOOL0+6, WOOL0+7,
  WOOL0+8, WOOL0+9, WOOL0+10, WOOL0+11, WOOL0+12, WOOL0+13, WOOL0+14, WOOL0+15,
];

// ═══ VILÁG-ADAT ═══
const world = new Uint8Array(SX * SY * SZ);
const colH = new Int16Array(SX * SZ);       // legmagasabb fény-blokkoló y oszloponként
const idx = (x, y, z) => (x * SZ + z) * SY + y;

function getB(x, y, z) {
  if (y < 0) return BEDROCK;
  if (y >= SY) return AIR;
  if (x < 0 || x >= SX || z < 0 || z >= SZ) return (y <= SEA ? WATER : AIR);
  return world[idx(x, y, z)];
}
function isBlocker(id) { // napfényt blokkolja?
  return id !== AIR && id !== GLASS && !BLOCKS[id].plant;
}
function recomputeColH(x, z) {
  let h = -1;
  for (let y = SY - 1; y >= 0; y--) {
    if (isBlocker(world[idx(x, y, z)])) { h = y; break; }
  }
  colH[x * SZ + z] = h;
}
function sunlit(x, y, z) {
  if (x < 0 || x >= SX || z < 0 || z >= SZ) return true;
  return y > colH[x * SZ + z];
}

// ═══ VILÁGGENERÁLÁS ═══
const heights = new Int16Array(SX * SZ);

function terrainH(x, z) {
  const n = fbm2(x * 0.021, z * 0.021) * 0.72 + fbm2(x * 0.052 + 210, z * 0.052 + 77) * 0.28;
  let h = SEA - 9 + n * 30;
  const ridge = fbm2(x * 0.011 + 555, z * 0.011 + 888);
  h += Math.max(0, ridge - 0.60) * 46;              // ritka nagyobb dombok
  // sziget-lecsengés: a térkép széle mindig víz alatt
  const e = Math.min(x, SX - 1 - x, z, SZ - 1 - z) / 22;
  const ef = smooth(Math.max(0, Math.min(1, e)));
  h = (SEA - 7) + (h - (SEA - 7)) * ef;
  // A terep plafonja fix (SEA+24) marad, hogy a magasabb SY csak több
  // építési levegőt adjon fölé, a táj alakja ne változzon.
  return Math.max(4, Math.min(SEA + 24, Math.floor(h)));
}

async function generateWorld(onProgress) {
  world.fill(0);
  liqLevel.clear(); waterQ.clear(); lavaQ.clear();

  // 1) domborzat
  for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) heights[x * SZ + z] = terrainH(x, z);

  // kilátszó szürke szikla: meredek lejtőkön + magas hegyek foltjain
  const stoneTop = new Uint8Array(SX * SZ);
  for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) {
    const h = heights[x * SZ + z];
    const n1 = x > 0 ? heights[(x - 1) * SZ + z] : h;
    const n2 = x < SX - 1 ? heights[(x + 1) * SZ + z] : h;
    const n3 = z > 0 ? heights[x * SZ + z - 1] : h;
    const n4 = z < SZ - 1 ? heights[x * SZ + z + 1] : h;
    const slope = Math.max(Math.abs(h - n1), Math.abs(h - n2), Math.abs(h - n3), Math.abs(h - n4));
    if (slope >= 3 || (h > SEA + 12 && fbm2(x * 0.06 + 70, z * 0.06 + 70) > 0.60))
      stoneTop[x * SZ + z] = 1;
  }

  for (let x = 0; x < SX; x++) {
    for (let z = 0; z < SZ; z++) {
      const h = heights[x * SZ + z];
      const beach = h <= SEA + 1;
      const st = stoneTop[x * SZ + z] === 1 && !beach;
      for (let y = 0; y <= h; y++) {
        let b;
        // göröngyös bedrock-alj: 1-3 blokk vastag, véletlenszerűen
        if (y === 0 ||
            (y === 1 && hash2(x + 9100, z + 9100) < 0.66) ||
            (y === 2 && hash2(x + 9200, z + 9200) < 0.30)) b = BEDROCK;
        else if (y < h - 3) b = STONE;
        else if (y < h) b = beach ? SAND : (st ? STONE : DIRT);
        else b = beach ? SAND : (st ? STONE : (h > SEA ? GRASS : DIRT));
        world[idx(x, y, z)] = b;
      }
      // mélyebb tengerfenék: kavics-foltok
      if (h < SEA - 2 && hash2(x + 7000, z + 7000) < 0.35) world[idx(x, h, z)] = GRAVEL;
      // víz feltöltés a tengerszintig
      for (let y = h + 1; y <= SEA; y++) world[idx(x, y, z)] = WATER;
    }
    if (x % 16 === 15) await onProgress(0.00 + (x / SX) * 0.30, 'TERRAIN');
  }

  // 2) barlangok: üreg-zaj + két "féreg-járat" zaj kombináció.
  // A barlangszáj-zónákban a járat a FELSZÍNT is átütheti → lejáratok.
  const entranceZone = (x, z) => fbm2(x * 0.045 + 400, z * 0.045 + 400) > 0.80;
  for (let x = 0; x < SX; x++) {
    for (let z = 0; z < SZ; z++) {
      const h = heights[x * SZ + z];
      const breach = entranceZone(x, z) && h > SEA + 2;
      const top = breach ? h : h - 4;       // víz közelében a felszín alatt marad
      for (let y = 4; y <= top; y++) {
        const cave = noise3(x * 0.075, y * 0.11, z * 0.075) > 0.685;
        const w1 = noise3(x * 0.045, y * 0.06, z * 0.045);
        const w2 = noise3(x * 0.045 + 31.4, y * 0.06 + 7.7, z * 0.045 + 91.2);
        const worm = Math.abs(w1 - 0.5) < 0.05 && Math.abs(w2 - 0.5) < 0.05;
        if (cave || worm) world[idx(x, y, z)] = AIR;
      }
    }
    if (x % 16 === 15) await onProgress(0.30 + (x / SX) * 0.30, 'CAVES');
  }
  // barlangszájak környéke: a föld helyett szürke szikla látszódjon
  for (let x = 1; x < SX - 1; x++) {
    for (let z = 1; z < SZ - 1; z++) {
      if (!entranceZone(x, z)) continue;
      const h = heights[x * SZ + z];
      if (h <= SEA + 2) continue;
      let breached = false;
      for (let y = h; y > h - 3 && y > 0; y--)
        if (world[idx(x, y, z)] === AIR) { breached = true; break; }
      if (!breached) continue;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const nx = x + dx, nz = z + dz;
        const hn = heights[nx * SZ + nz];
        for (let y = Math.max(1, hn - 3); y <= hn; y++) {
          const b = world[idx(nx, y, nz)];
          if (b === DIRT || b === GRASS) world[idx(nx, y, nz)] = STONE;
        }
      }
    }
  }

  // 3) érc-telérek (véletlen bolyongás a kőben)
  const rng = makeRng(SEED ^ 0x0E0E5);
  function veins(count, ore, maxY, len) {
    for (let i = 0; i < count; i++) {
      let x = 2 + (rng() * (SX - 4)) | 0;
      let z = 2 + (rng() * (SZ - 4)) | 0;
      let y = 2 + (rng() * maxY) | 0;
      const n = 3 + (rng() * len) | 0;
      for (let j = 0; j < n; j++) {
        if (x > 0 && x < SX && z > 0 && z < SZ && y > 0 && y < SY &&
            world[idx(x, y, z)] === STONE) world[idx(x, y, z)] = ore;
        x += (rng() * 3 | 0) - 1; y += (rng() * 3 | 0) - 1; z += (rng() * 3 | 0) - 1;
      }
    }
  }
  veins(340, COAL_ORE, 52, 7);
  veins(200, IRON_ORE, 38, 5);
  veins(90,  GOLD_ORE, 20, 4);
  veins(64,  DIAMOND_ORE, 14, 4);
  await onProgress(0.62, 'ORES');

  // 4) fák
  const treeRng = makeRng(SEED ^ 0x7EE5);
  let planted = 0;
  for (let i = 0; i < 900 && planted < 130; i++) {
    const x = 3 + (treeRng() * (SX - 6)) | 0;
    const z = 3 + (treeRng() * (SZ - 6)) | 0;
    const h = heights[x * SZ + z];
    if (world[idx(x, h, z)] !== GRASS || h <= SEA + 1) continue;
    const trunk = 4 + (treeRng() * 3) | 0;
    const topY = h + trunk;
    if (topY + 2 >= SY) continue;
    // lombkorona
    for (let ly = topY - 2; ly <= topY + 1; ly++) {
      const rad = ly >= topY ? 1 : 2;
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        if (Math.abs(dx) === rad && Math.abs(dz) === rad && treeRng() < 0.55) continue;
        const lx = x + dx, lz = z + dz;
        if (lx < 0 || lx >= SX || lz < 0 || lz >= SZ) continue;
        if (world[idx(lx, ly, lz)] === AIR) world[idx(lx, ly, lz)] = LEAVES;
      }
    }
    for (let y = h + 1; y < topY; y++) world[idx(x, y, z)] = LOG;
    world[idx(x, h, z)] = DIRT;
    planted++;
  }
  await onProgress(0.68, 'TREES');

  // 5) virágok / gombák
  const plantRng = makeRng(SEED ^ 0xF10E5);
  const FLOWERS = [FLOWER_Y, FLOWER_R, FLOWER_B, FLOWER_P, FLOWER_W];
  for (let i = 0; i < 420; i++) {
    const x = 1 + (plantRng() * (SX - 2)) | 0;
    const z = 1 + (plantRng() * (SZ - 2)) | 0;
    const h = heights[x * SZ + z];
    const gnd = world[idx(x, h, z)];
    if ((gnd !== GRASS && gnd !== DIRT) || world[idx(x, h + 1, z)] !== AIR) continue;
    // árnyékban gomba, napon virág — a lomb dönt
    let shaded = false;
    for (let y = h + 2; y < Math.min(SY, h + 12); y++)
      if (world[idx(x, y, z)] === LEAVES) { shaded = true; break; }
    if (shaded) world[idx(x, h + 1, z)] = plantRng() < 0.5 ? MUSH_R : MUSH_B;
    else if (gnd === GRASS) world[idx(x, h + 1, z)] = FLOWERS[(plantRng() * FLOWERS.length) | 0];
  }
  // barlangi gombák
  for (let i = 0; i < 260; i++) {
    const x = 2 + (plantRng() * (SX - 4)) | 0;
    const z = 2 + (plantRng() * (SZ - 4)) | 0;
    const y = 5 + (plantRng() * (SEA - 8)) | 0;
    if (world[idx(x, y, z)] === AIR && world[idx(x, y - 1, z)] === STONE)
      world[idx(x, y, z)] = plantRng() < 0.5 ? MUSH_R : MUSH_B;
  }
  await onProgress(0.72, 'PLANTS');
}

// ═══ THREE.JS ALAP ═══
const SKY = 0x9ec8ff;
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(SKY);
renderer.domElement.style.position = 'fixed';
renderer.domElement.style.inset = '0';
renderer.domElement.style.zIndex = '1';
document.body.insertBefore(renderer.domElement, document.getElementById('click-catcher'));

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(SKY, 60, 190);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 400);

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const atlasTex = new THREE.CanvasTexture(atlasCanvas);
atlasTex.magFilter = THREE.NearestFilter;
atlasTex.minFilter = THREE.NearestFilter;
atlasTex.generateMipmaps = false;

const matOpaque = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, side: THREE.DoubleSide });
const matCutout = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 });
const matWater  = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.62 });

// ── környező óceán a látóhatárig — GYŰRŰ alakú: a pálya felett LYUK van,
// különben a térkép alatt átderengene egy fantom "vízréteg" ásás közben! ──
const WSURF = SEA + 0.9;   // vízfelszín (a blokk teteje alatt 0.1-gyel, mindenhol)
const waterTileCanvas = document.createElement('canvas');
waterTileCanvas.width = waterTileCanvas.height = TILE;
waterTileCanvas.getContext('2d').drawImage(atlasCanvas,
  (T_WATER % ACOLS) * TILE, Math.floor(T_WATER / ACOLS) * TILE, TILE, TILE, 0, 0, TILE, TILE);
const oceanTex = new THREE.CanvasTexture(waterTileCanvas);
oceanTex.magFilter = THREE.NearestFilter;
oceanTex.minFilter = THREE.NearestFilter;
oceanTex.wrapS = oceanTex.wrapT = THREE.RepeatWrapping;
const oceanShape = new THREE.Shape();
oceanShape.moveTo(-2000, -2000); oceanShape.lineTo(2000, -2000);
oceanShape.lineTo(2000, 2000);   oceanShape.lineTo(-2000, 2000);
oceanShape.closePath();
const oceanHole = new THREE.Path();
oceanHole.moveTo(0, 0); oceanHole.lineTo(SX, 0);
oceanHole.lineTo(SX, SZ); oceanHole.lineTo(0, SZ);
oceanHole.closePath();
oceanShape.holes.push(oceanHole);
const oceanGeo = new THREE.ShapeGeometry(oceanShape);
oceanGeo.rotateX(Math.PI / 2);       // XY sík → XZ sík; uv = világkoordináta → 1 csempe/blokk
const ocean = new THREE.Mesh(oceanGeo, new THREE.MeshBasicMaterial({
  map: oceanTex, transparent: true, opacity: 0.62, side: THREE.DoubleSide,
}));
ocean.position.y = WSURF;
scene.add(ocean);

// ── pályán kívüli tengerfenék (CSAK vizuális, sosem kerül a world tömbbe) ──
// Mint az igazi MC Classicban: a perem-terep szintjén (SEA-7, top face = SEA-6)
// bedrock sík fut a látóhatárig a víz alatt, üresség helyett.
const bedTileCanvas = document.createElement('canvas');
bedTileCanvas.width = bedTileCanvas.height = TILE;
bedTileCanvas.getContext('2d').drawImage(atlasCanvas,
  (T_BEDROCK % ACOLS) * TILE, Math.floor(T_BEDROCK / ACOLS) * TILE, TILE, TILE, 0, 0, TILE, TILE);
const bedFloorTex = new THREE.CanvasTexture(bedTileCanvas);
bedFloorTex.magFilter = bedFloorTex.minFilter = THREE.NearestFilter;
bedFloorTex.wrapS = bedFloorTex.wrapT = THREE.RepeatWrapping;
// gyűrű alakú sík (lyuk a pálya felett), uv = világkoord → 1 csempe/blokk
const bedFloorGeo = new THREE.ShapeGeometry(oceanShape);
bedFloorGeo.rotateX(Math.PI / 2);
const bedFloor = new THREE.Mesh(bedFloorGeo,
  new THREE.MeshBasicMaterial({ map: bedFloorTex, side: THREE.DoubleSide }));
bedFloor.position.y = SEA - 6;   // a perem-oszlopok tetejével (23-as blokk teteje) egy szintben
scene.add(bedFloor);
// függőleges bedrock falak a pálya peremén a fenék-sík ALATT (0 → SEA-6),
// hogy a szélen leásva se lehessen kilátni az ürességbe
const BED_H = SEA - 6;
const bedWallTex = new THREE.CanvasTexture(bedTileCanvas);
bedWallTex.magFilter = bedWallTex.minFilter = THREE.NearestFilter;
bedWallTex.wrapS = bedWallTex.wrapT = THREE.RepeatWrapping;
bedWallTex.repeat.set(SX, BED_H);   // 1 csempe / blokk
const bedWallMat = new THREE.MeshBasicMaterial({ map: bedWallTex, color: 0x808080, side: THREE.DoubleSide });
const EPS = 0.02;
for (const [px, pz, rotY] of [
  [SX / 2, -EPS, 0],                 // z = 0 perem
  [SX / 2, SZ + EPS, Math.PI],       // z = SZ perem
  [-EPS, SZ / 2, -Math.PI / 2],      // x = 0 perem
  [SX + EPS, SZ / 2, Math.PI / 2],   // x = SX perem
]) {
  const w = new THREE.Mesh(new THREE.PlaneGeometry(SX, BED_H), bedWallMat);
  w.position.set(px, BED_H / 2, pz);
  w.rotation.y = rotY;
  scene.add(w);
}

// felhők (pixeles, lassan úszó)
const cloudCanvas = document.createElement('canvas');
cloudCanvas.width = cloudCanvas.height = 128;
{
  const g = cloudCanvas.getContext('2d');
  for (let cy = 0; cy < 32; cy++) for (let cx = 0; cx < 32; cx++) {
    if (fbm2(cx * 0.22 + 500, cy * 0.22 + 500) > 0.58)
      { g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(cx * 4, cy * 4, 4, 4); }
  }
}
const cloudTex = new THREE.CanvasTexture(cloudCanvas);
cloudTex.magFilter = THREE.NearestFilter; cloudTex.minFilter = THREE.NearestFilter;
cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping;
cloudTex.repeat.set(6, 6);
const clouds = new THREE.Mesh(
  new THREE.PlaneGeometry(3000, 3000),
  new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.9, alphaTest: 0.3, side: THREE.DoubleSide, depthWrite: false })
);
clouds.rotation.x = -Math.PI / 2;
clouds.position.set(SX / 2, 96, SZ / 2);
clouds.renderOrder = 2;   // mindig az óceánsík (átlátszó) UTÁN, hogy ne fakuljon ki felülről
scene.add(clouds);

// blokk-kijelölő keret
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 })
);
highlight.visible = false;
scene.add(highlight);

// ═══ CHUNK MESHING ═══
const chunkMeshes = new Map();     // "cx,cz" → [mesh...]

// lapok: [normál, fényerő, 4 sarok (bl,br,tr,tl)]
const FACE_DEFS = [
  { d: [0, 1, 0],  l: 1.00, c: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], t: 0 }, // top
  { d: [0, -1, 0], l: 0.50, c: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], t: 1 }, // bottom
  { d: [1, 0, 0],  l: 0.70, c: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]], t: 2 },
  { d: [-1, 0, 0], l: 0.70, c: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], t: 2 },
  { d: [0, 0, 1],  l: 0.85, c: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], t: 2 },
  { d: [0, 0, -1], l: 0.85, c: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], t: 2 },
];
function tileUV(ti) {
  const gx = (ti % ACOLS) * TILE, gy = Math.floor(ti / ACOLS) * TILE;
  const W = ACOLS * TILE, H = AROWS * TILE, e = 0.25;
  return {
    u0: (gx + e) / W, u1: (gx + TILE - e) / W,
    v1: 1 - (gy + e) / H, v0: 1 - (gy + TILE - e) / H,
  };
}
function pushQuad(b, p0, p1, p2, p3, uv, light) {
  b.p.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2],
           p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
  b.u.push(uv.u0, uv.v0, uv.u1, uv.v0, uv.u1, uv.v1,
           uv.u0, uv.v0, uv.u1, uv.v1, uv.u0, uv.v1);
  for (let i = 0; i < 6; i++) b.c.push(light, light, light);
}

function buildChunk(cx, cz) {
  const key = cx + ',' + cz;
  const old = chunkMeshes.get(key);
  if (old) {
    for (const m of old) { scene.remove(m); m.geometry.dispose(); }
    chunkMeshes.delete(key);
  }
  const op = { p: [], c: [], u: [] };
  const cut = { p: [], c: [], u: [] };
  const wat = { p: [], c: [], u: [] };

  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  for (let x = x0; x < x0 + CHUNK; x++) {
    for (let z = z0; z < z0 + CHUNK; z++) {
      for (let y = 0; y < SY; y++) {
        const id = world[idx(x, y, z)];
        if (id === AIR) continue;
        const blk = BLOCKS[id];

        if (blk.plant) {
          const light = sunlit(x, y, z) ? 1.0 : 0.55;
          const uv = tileUV(blk.tiles[0]);
          const a = 0.145, b2 = 0.855, hgt = 0.95;
          pushQuad(cut, [x+a,y,z+a], [x+b2,y,z+b2], [x+b2,y+hgt,z+b2], [x+a,y+hgt,z+a], uv, light);
          pushQuad(cut, [x+a,y,z+b2], [x+b2,y,z+a], [x+b2,y+hgt,z+a], [x+a,y+hgt,z+b2], uv, light);
          continue;
        }

        if (blk.water || blk.lava) {
          // folyadék: a felszín a blokk teteje alatt 0.1-gyel; az oldalak is
          // eddig érnek. Azonos folyadék-szomszédnál a magasságkülönbség
          // 0.1-es csíkját külön kitöltjük → nincs rés a vízesésben!
          const isW = !!blk.water;
          const bucket = isW ? wat : op;         // a láva nem átlátszó
          const uv = tileUV(blk.tiles[0]);
          const above = getB(x, y + 1, z);
          // tömör blokk alatt a folyadék teljesen kitölti a cellát (mint az
          // igazi MC-ben), különben 0.1-es rés látszana be oldalról
          const topY = (above === id || BLOCKS[above].opaque) ? 1 : 0.9;
          // láva: mindig teljes fénnyel izzik, a nap/árnyék nem fogja
          const shade = (f, lx, ly, lz) => isW ? f * (sunlit(lx, ly, lz) ? 1 : 0.55) : 1.0;
          if (above !== id && !BLOCKS[above].opaque) {
            const l = shade(1.0, x, y + 1, z);
            pushQuad(bucket, [x, y+topY, z+1], [x+1, y+topY, z+1], [x+1, y+topY, z], [x, y+topY, z], uv, l);
          }
          const below = getB(x, y - 1, z);
          if (below !== id && !BLOCKS[below].opaque) {
            const l = shade(0.5, x, y - 1, z);
            pushQuad(bucket, [x, y, z], [x+1, y, z], [x+1, y, z+1], [x, y, z+1], uv, l);
          }
          const sides = [[1,0,0.7],[-1,0,0.7],[0,1,0.85],[0,-1,0.85]];
          for (const s of sides) {
            const nx3 = x + s[0], nz3 = z + s[1];
            const nid2 = getB(nx3, y, nz3);
            let yLo = 0, yHi = topY;
            if (nid2 === id) {
              // azonos folyadék: ha ez teljes (1.0), a szomszéd meg 0.9-es
              // felszínű, a köztes 0.1-es csík kitöltése
              const nAbove = getB(nx3, y + 1, nz3);
              const nbTop = (nAbove === id || BLOCKS[nAbove].opaque) ? 1 : 0.9;
              if (topY <= nbTop) continue;
              yLo = nbTop; yHi = topY;
            } else if (BLOCKS[nid2].opaque) continue;
            const l = shade(s[2], nx3, y, nz3);
            let p0, p1;
            if (s[0] === 1)       { p0 = [x+1, z+1]; p1 = [x+1, z]; }
            else if (s[0] === -1) { p0 = [x, z];     p1 = [x, z+1]; }
            else if (s[1] === 1)  { p0 = [x, z+1];   p1 = [x+1, z+1]; }
            else                  { p0 = [x+1, z];   p1 = [x, z]; }
            pushQuad(bucket,
              [p0[0], y+yLo, p0[1]], [p1[0], y+yLo, p1[1]],
              [p1[0], y+yHi, p1[1]], [p0[0], y+yHi, p0[1]], uv, l);
          }
          continue;
        }

        for (const f of FACE_DEFS) {
          const nx2 = x + f.d[0], ny2 = y + f.d[1], nz2 = z + f.d[2];
          const nid = getB(nx2, ny2, nz2);
          const nB = BLOCKS[nid];
          if (id === GLASS) {
            if (nid === GLASS || nB.opaque) continue;
          } else {
            if (nB.opaque) continue;
          }
          const light = f.l * (sunlit(nx2, ny2, nz2) ? 1.0 : 0.55);
          const ti = blk.tiles[f.t];
          const uv = tileUV(ti);
          const c = f.c;
          let bucket = op;
          if (blk.water) bucket = wat;
          else if (blk.cutout) bucket = cut;
          pushQuad(bucket,
            [x + c[0][0], y + c[0][1], z + c[0][2]],
            [x + c[1][0], y + c[1][1], z + c[1][2]],
            [x + c[2][0], y + c[2][1], z + c[2][2]],
            [x + c[3][0], y + c[3][1], z + c[3][2]], uv, light);
        }
      }
    }
  }

  const meshes = [];
  function mk(b, mat) {
    if (b.p.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    scene.add(m);
    meshes.push(m);
  }
  mk(op, matOpaque);
  mk(cut, matCutout);
  mk(wat, matWater);
  chunkMeshes.set(key, meshes);
}

async function buildAllChunks(onProgress) {
  const total = (SX / CHUNK) * (SZ / CHUNK);
  let done = 0;
  for (let cx = 0; cx < SX / CHUNK; cx++) {
    for (let cz = 0; cz < SZ / CHUNK; cz++) {
      buildChunk(cx, cz);
      done++;
      if (done % 6 === 0) await onProgress(0.75 + (done / total) * 0.25, 'MESH');
    }
  }
}

function chunkKeysFor(x, z) {
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  const keys = [cx + ',' + cz];
  const lx = x % CHUNK, lz = z % CHUNK;
  if (lx === 0 && cx > 0) keys.push((cx - 1) + ',' + cz);
  if (lx === CHUNK - 1 && cx < SX / CHUNK - 1) keys.push((cx + 1) + ',' + cz);
  if (lz === 0 && cz > 0) keys.push(cx + ',' + (cz - 1));
  if (lz === CHUNK - 1 && cz < SZ / CHUNK - 1) keys.push(cx + ',' + (cz + 1));
  return keys;
}
function rebuildAround(x, z) {
  for (const k of chunkKeysFor(x, z)) {
    const [a, b] = k.split(',').map(Number);
    buildChunk(a, b);
  }
}

// ═══ FOLYADÉK-SZIMULÁCIÓ (víz + láva: lefelé folyik, majd szétterül) ═══
// Víz: gyors, szivacs blokkolja/felszívja. Láva: lassú, vízzel találkozva
// COBBLESTONE keletkezik (mint az igazi Minecraftban).
const waterQ = new Set();
const lavaQ  = new Set();
let waterT = 0, lavaT = 0;
const WK = (x, y, z) => x + ',' + y + ',' + z;
// folyadék-szintek (csak futásidőben, mentésbe nem kerül): forrás = 8 (víz) / 4 (láva),
// oldalirányú terjedésnél 1-gyel csökken, 1-nél elfogy → nem áraszt el mindent.
// A generált/betöltött víz nincs a Map-ben → forrásként viselkedik (óceán).
const liqLevel = new Map();
const LIQ_MAX = id => id === WATER ? 8 : 4;

function enqueueLiquidAround(x, y, z) {
  const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  for (const d of dirs) {
    const nx = x + d[0], ny = y + d[1], nz = z + d[2];
    if (nx < 0 || nx >= SX || ny < 1 || ny >= SY || nz < 0 || nz >= SZ) continue;
    const b = world[idx(nx, ny, nz)];
    if (b === WATER) waterQ.add(WK(nx, ny, nz));
    else if (b === LAVA) lavaQ.add(WK(nx, ny, nz));
  }
}
function spongeNear(x, y, z) {
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (nx < 0 || nx >= SX || ny < 0 || ny >= SY || nz < 0 || nz >= SZ) continue;
    if (world[idx(nx, ny, nz)] === SPONGE) return true;
  }
  return false;
}
const LIQ_DIRS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
function liquidTick(LIQ, queue) {
  if (queue.size === 0) return;
  const OTHER = LIQ === WATER ? LAVA : WATER;
  const items = [];
  for (const k of queue) { items.push(k); if (items.length >= 400) break; }
  const chunks = new Set();
  const mark = (x, z) => { for (const ck of chunkKeysFor(x, z)) chunks.add(ck); };
  const flow = (x, y, z, lvl) => {
    if (x < 0 || x >= SX || y < 1 || y >= SY || z < 0 || z >= SZ) return false;
    if (world[idx(x, y, z)] !== AIR) return false;
    if (LIQ === WATER && spongeNear(x, y, z)) return false;
    // találkozik-e a MÁSIK folyadékkal?
    let touchOther = false;
    for (const d of LIQ_DIRS) {
      const nx = x + d[0], ny = y + d[1], nz = z + d[2];
      if (nx < 0 || nx >= SX || ny < 0 || ny >= SY || nz < 0 || nz >= SZ) continue;
      if (world[idx(nx, ny, nz)] === OTHER) {
        if (LIQ === LAVA) { touchOther = true; }
        else {
          // az érkező víz a szomszéd LÁVÁT kővé dermeszti
          world[idx(nx, ny, nz)] = COBBLE;
          recomputeColH(nx, nz); mark(nx, nz);
        }
      }
    }
    if (LIQ === LAVA && touchOther) {
      // a vízhez érő láva azonnal megszilárdul
      world[idx(x, y, z)] = COBBLE;
      recomputeColH(x, z); mark(x, z);
      return true;
    }
    world[idx(x, y, z)] = LIQ;
    liqLevel.set(WK(x, y, z), lvl);
    recomputeColH(x, z); mark(x, z);
    queue.add(WK(x, y, z));
    return true;
  };
  for (const k of items) {
    queue.delete(k);
    const p = k.split(',');
    const x = +p[0], y = +p[1], z = +p[2];
    if (world[idx(x, y, z)] !== LIQ) { liqLevel.delete(k); continue; }
    const lvl = liqLevel.has(k) ? liqLevel.get(k) : LIQ_MAX(LIQ);
    // előbb lefelé (a leeső folyadék újra teljes erejű); ha alatta nem levegő,
    // oldalra terül eggyel gyengébb szinttel — 1-es szint már nem terjed
    if (!flow(x, y - 1, z, LIQ_MAX(LIQ))) {
      if (getB(x, y - 1, z) !== AIR && lvl > 1) {
        flow(x + 1, y, z, lvl - 1); flow(x - 1, y, z, lvl - 1);
        flow(x, y, z + 1, lvl - 1); flow(x, y, z - 1, lvl - 1);
      }
    }
  }
  for (const key of chunks) {
    const [a, b] = key.split(',').map(Number);
    buildChunk(a, b);
  }
}

function setBlock(x, y, z, id) {
  if (x < 0 || x >= SX || y < 1 || y >= SY || z < 0 || z >= SZ) return;
  world[idx(x, y, z)] = id;
  // lerakott folyadék forrásblokk; minden más felülírja az esetleges régi szintet
  if (id === WATER || id === LAVA) liqLevel.set(WK(x, y, z), LIQ_MAX(id));
  else liqLevel.delete(WK(x, y, z));
  recomputeColH(x, z);
  if (id === AIR) {
    // térképszélen a "külső óceán" azonnal beömlik (de csak a külső tengerfenék,
    // SEA-6 fölött — az alatt már bedrock van kint, nem víz); egyébként a szomszéd folyadék terjed be
    if (y <= SEA && y >= SEA - 6 && (x === 0 || x === SX - 1 || z === 0 || z === SZ - 1)) {
      world[idx(x, y, z)] = WATER;
      liqLevel.set(WK(x, y, z), LIQ_MAX(WATER));   // a külső óceán forrásként ömlik be
      recomputeColH(x, z);
      waterQ.add(WK(x, y, z));
    } else {
      enqueueLiquidAround(x, y, z);
    }
  } else if (id === WATER) {
    // a szomszédos láva kővé dermed
    for (const d of LIQ_DIRS) {
      const nx = x + d[0], ny = y + d[1], nz = z + d[2];
      if (nx < 0 || nx >= SX || ny < 1 || ny >= SY || nz < 0 || nz >= SZ) continue;
      if (world[idx(nx, ny, nz)] === LAVA) {
        world[idx(nx, ny, nz)] = COBBLE;
        recomputeColH(nx, nz);
        rebuildAround(nx, nz);
      }
    }
    waterQ.add(WK(x, y, z));
  } else if (id === LAVA) {
    // vizes szomszéd mellé rakott láva azonnal kővé válik
    let touchWater = false;
    for (const d of LIQ_DIRS) {
      const nx = x + d[0], ny = y + d[1], nz = z + d[2];
      if (nx < 0 || nx >= SX || ny < 0 || ny >= SY || nz < 0 || nz >= SZ) continue;
      if (world[idx(nx, ny, nz)] === WATER) { touchWater = true; break; }
    }
    if (touchWater) {
      world[idx(x, y, z)] = COBBLE;
      recomputeColH(x, z);
    } else {
      lavaQ.add(WK(x, y, z));
    }
  } else if (id === SPONGE) {
    // a szivacs lerakáskor felszívja a folyadékot 5×5×5-ben (vizet ÉS lávát)
    const chunks = new Set();
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || nx >= SX || ny < 1 || ny >= SY || nz < 0 || nz >= SZ) continue;
      const b = world[idx(nx, ny, nz)];
      if (b === WATER || b === LAVA) {
        world[idx(nx, ny, nz)] = AIR;
        recomputeColH(nx, nz);
        for (const ck of chunkKeysFor(nx, nz)) chunks.add(ck);
      }
    }
    for (const key of chunks) {
      const [a, b] = key.split(',').map(Number);
      buildChunk(a, b);
    }
  }
  rebuildAround(x, z);
}

// ═══ JÁTÉKOS ═══
const player = {
  x: SX / 2, y: SEA + 6, z: SZ / 2,
  vx: 0, vy: 0, vz: 0,
  yaw: 0, pitch: 0,
  onGround: false,
  W: 0.3, H: 1.8, EYE: 1.62,
};
let spawnPoint = { x: SX / 2, y: SEA + 6, z: SZ / 2 };

function solidAt(x, y, z) {
  const id = getB(Math.floor(x), Math.floor(y), Math.floor(z));
  return BLOCKS[id] ? BLOCKS[id].solid : false;
}
function boxCollides(px, py, pz) {
  const w = player.W;
  const x0 = Math.floor(px - w), x1 = Math.floor(px + w);
  const y0 = Math.floor(py), y1 = Math.floor(py + player.H);
  const z0 = Math.floor(pz - w), z1 = Math.floor(pz + w);
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const id = getB(x, y, z);
        if (BLOCKS[id] && BLOCKS[id].solid) return true;
      }
  return false;
}
function movePlayer(dt) {
  const eps = 0.001;
  player.hitWall = false;
  // X
  let nx = player.x + player.vx * dt;
  if (!boxCollides(nx, player.y, player.z)) player.x = nx;
  else {
    if (player.vx > 0) player.x = Math.floor(nx + player.W) - player.W - eps;
    else player.x = Math.floor(nx - player.W) + 1 + player.W + eps;
    player.vx = 0;
    player.hitWall = true;
  }
  // Z
  let nz = player.z + player.vz * dt;
  if (!boxCollides(player.x, player.y, nz)) player.z = nz;
  else {
    if (player.vz > 0) player.z = Math.floor(nz + player.W) - player.W - eps;
    else player.z = Math.floor(nz - player.W) + 1 + player.W + eps;
    player.vz = 0;
    player.hitWall = true;
  }
  // Y
  let ny = player.y + player.vy * dt;
  player.onGround = false;
  if (!boxCollides(player.x, ny, player.z)) player.y = ny;
  else {
    if (player.vy < 0) { player.y = Math.floor(ny) + 1 + eps; player.onGround = true; }
    else player.y = Math.floor(ny + player.H) - player.H - eps;
    player.vy = 0;
  }
  // világhatár
  player.x = Math.max(0.35, Math.min(SX - 0.35, player.x));
  player.z = Math.max(0.35, Math.min(SZ - 0.35, player.z));
  if (player.y < -12) { player.x = spawnPoint.x; player.y = spawnPoint.y; player.z = spawnPoint.z; player.vy = 0; }
}
function inWater() {
  const feet = getB(Math.floor(player.x), Math.floor(player.y + 0.35), Math.floor(player.z));
  const eye = getB(Math.floor(player.x), Math.floor(player.y + player.EYE), Math.floor(player.z));
  return feet === WATER || eye === WATER || feet === LAVA || eye === LAVA;
}

// ═══ SUGÁRKÖVETÉS (voxel DDA) ═══
function raycast(maxDist = 6) {
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
  let x = Math.floor(camera.position.x);
  let y = Math.floor(camera.position.y);
  let z = Math.floor(camera.position.z);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  const tdx = Math.abs(1 / (dir.x || 1e-9));
  const tdy = Math.abs(1 / (dir.y || 1e-9));
  const tdz = Math.abs(1 / (dir.z || 1e-9));
  let tx = (stepX > 0 ? (x + 1 - camera.position.x) : (camera.position.x - x)) * tdx;
  let ty = (stepY > 0 ? (y + 1 - camera.position.y) : (camera.position.y - y)) * tdy;
  let tz = (stepZ > 0 ? (z + 1 - camera.position.z) : (camera.position.z - z)) * tdz;
  let px = x, py = y, pz = z;
  let t = 0;
  for (let i = 0; i < 64; i++) {
    const id = getB(x, y, z);
    if (id !== AIR && id !== WATER && id !== LAVA) {
      return { x, y, z, px, py, pz, id };
    }
    px = x; py = y; pz = z;
    if (tx < ty && tx < tz) { x += stepX; t = tx; tx += tdx; }
    else if (ty < tz)       { y += stepY; t = ty; ty += tdy; }
    else                    { z += stepZ; t = tz; tz += tdz; }
    if (t > maxDist) break;
  }
  return null;
}

// ═══ HANGOK (procedurális, Web Audio — MC-s "reccs" és "kopp") ═══
let AC = null;
function audioCtx() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
// anyagfüggő tónus: kő mély reccs, föld/homok puha, fa koppanós, üveg csörren, növény suhan
function soundProfile(id) {
  const b = BLOCKS[id];
  if (b.plant || id === LEAVES) return { f: 2400, dur: 0.07, g: 0.35 };
  if (id === DIRT || id === GRASS || id === SAND || id === GRAVEL || id === SPONGE)
    return { f: 950, dur: 0.10, g: 0.55 };
  if (id === PLANKS || id === LOG || id === SHELF) return { f: 1350, dur: 0.09, g: 0.55 };
  if (id === GLASS) return { f: 3200, dur: 0.07, g: 0.45 };
  if (id >= WOOL0 && id < WOOL0 + 16) return { f: 1100, dur: 0.09, g: 0.45 };
  if (id === WATER) return { f: 650, dur: 0.12, g: 0.35 };
  if (id === LAVA)  return { f: 380, dur: 0.16, g: 0.45 };  // mély bugyogás
  return { f: 720, dur: 0.09, g: 0.6 };   // kő / érc / fém
}
function playThud(id, place) {
  if (!soundEnabled) return;
  let ac;
  try { ac = audioCtx(); } catch (e) { return; }
  const prof = soundProfile(id);
  const t = ac.currentTime;
  // zaj-lökés lecsengő aluláteresztővel (a klasszikus "reccs")
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * prof.dur), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++)
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.8);
  const src = ac.createBufferSource(); src.buffer = buf;
  const filt = ac.createBiquadFilter(); filt.type = 'lowpass';
  const base = prof.f * (place ? 1.3 : 1) * (0.9 + Math.random() * 0.2);
  filt.frequency.setValueAtTime(base, t);
  filt.frequency.exponentialRampToValueAtTime(Math.max(150, base * 0.35), t + prof.dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(prof.g, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + prof.dur);
  src.connect(filt); filt.connect(g); g.connect(ac.destination);
  src.start(t);
  // lerakásnál rövid "kopp" is
  if (place) {
    const o = ac.createOscillator(); o.type = 'triangle';
    o.frequency.value = base * 0.5;
    const og = ac.createGain();
    og.gain.setValueAtTime(0.22, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(og); og.connect(ac.destination);
    o.start(t); o.stop(t + 0.06);
  }
}

function doDig() {
  const hit = raycast();
  if (!hit || hit.id === BEDROCK) return;
  playThud(hit.id, false);
  setBlock(hit.x, hit.y, hit.z, AIR);
}
function doPlace() {
  const hit = raycast();
  if (!hit) return;
  const { px, py, pz } = hit;
  if (px < 0 || px >= SX || py < 1 || py >= SY || pz < 0 || pz >= SZ) return;
  const cur = getB(px, py, pz);
  if (cur !== AIR && cur !== WATER && cur !== LAVA && !BLOCKS[cur].plant) return;
  const id = hotbar[hotbarSel];
  // szilárd blokk ne kerüljön a játékosba
  if (BLOCKS[id].solid) {
    const w = player.W;
    if (px + 1 > player.x - w && px < player.x + w &&
        py + 1 > player.y && py < player.y + player.H &&
        pz + 1 > player.z - w && pz < player.z + w) return;
  }
  playThud(id, true);
  setBlock(px, py, pz, id);
}
function doPick() {
  const hit = raycast();
  if (hit && BLOCKS[hit.id].sel) {
    hotbar[hotbarSel] = hit.id;
    refreshHotbar();
  }
}

// ═══ UI: HOTBAR + SELECT ═══
let hotbar = [STONE, COBBLE, PLANKS, DIRT, LOG, LEAVES, SAND, GLASS, FLOWER_R];
let hotbarSel = 0;

function drawIcon(cv, id) {
  cv.width = 32; cv.height = 32;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  const ti = BLOCKS[id].icon;
  const gx = (ti % ACOLS) * TILE, gy = Math.floor(ti / ACOLS) * TILE;
  g.drawImage(atlasCanvas, gx, gy, TILE, TILE, 0, 0, 32, 32);
}
function refreshHotbar() {
  const bar = document.getElementById('hotbar');
  bar.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const slot = document.createElement('div');
    slot.className = 'hb-slot' + (i === hotbarSel ? ' sel' : '');
    const cv = document.createElement('canvas');
    drawIcon(cv, hotbar[i]);
    slot.appendChild(cv);
    // koppintásra / kattintásra slot-váltás (mobilon ez az egyetlen mód)
    const pick = e => { e.preventDefault(); hotbarSel = i; refreshHotbar(); };
    slot.addEventListener('touchstart', pick, { passive: false });
    slot.addEventListener('mousedown', e => { if (!locked) pick(e); });
    bar.appendChild(slot);
  }
}
let selectOpen = false;
function buildSelectGrid() {
  const grid = document.getElementById('select-grid');
  grid.innerHTML = '';
  for (const id of SELECT_ORDER) {
    const item = document.createElement('div');
    item.className = 'sel-item';
    item.title = BLOCKS[id].name;
    const cv = document.createElement('canvas');
    drawIcon(cv, id);
    item.appendChild(cv);
    item.addEventListener('click', () => {
      hotbar[hotbarSel] = id;
      refreshHotbar();
      closeSelect();
    });
    grid.appendChild(item);
  }
}
function openSelect() {
  if (!started) return;
  selectOpen = true;
  document.getElementById('select').className = 'show';
  if (!isMobile) document.exitPointerLock();
}
function closeSelect() {
  selectOpen = false;
  document.getElementById('select').className = '';
  if (!isMobile && started && !paused)
    document.getElementById('click-catcher').requestPointerLock();
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ''; }, 1800);
}

// ═══ MENTÉS / BETÖLTÉS (RLE + base64) ═══
function bytesToB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000)
    s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
function saveWorld(silent) {
  const rle = [];
  let i = 0;
  while (i < world.length) {
    const v = world[i];
    let run = 1;
    while (i + run < world.length && world[i + run] === v && run < 65535) run++;
    rle.push(v, run & 255, run >> 8);
    i += run;
  }
  const save = {
    v: 1, seed: SEED, ts: Date.now(), sy: SY,
    px: player.x, py: player.y, pz: player.z,
    yaw: player.yaw, pitch: player.pitch,
    hotbar, sel: hotbarSel,
    data: bytesToB64(new Uint8Array(rle)),
  };
  try {
    localStorage.setItem(slotKey(currentSlot), JSON.stringify(save));
    if (!silent) toast('World saved');
  } catch (e) {
    toast('Save failed (storage full?)');
  }
}
function loadWorldData(save) {
  SEED = save.seed >>> 0;
  const bytes = b64ToBytes(save.data);
  world.fill(0);
  liqLevel.clear(); waterQ.clear(); lavaQ.clear();
  let o = 0, i = 0;
  while (i < bytes.length && o < world.length) {
    const v = bytes[i], run = bytes[i + 1] | (bytes[i + 2] << 8);
    world.fill(v, o, o + run);
    o += run; i += 3;
  }
  player.x = save.px; player.y = save.py; player.z = save.pz;
  player.yaw = save.yaw; player.pitch = save.pitch;
  if (Array.isArray(save.hotbar)) hotbar = save.hotbar.slice(0, 9);
  hotbarSel = save.sel || 0;
  spawnPoint = { x: save.px, y: save.py, z: save.pz };
}

// ═══ INPUT ═══
const keys = {};
let started = false, paused = false, locked = false;
let digHeld = false, placeHeld = false, actionCd = 0;

let isMobile = localStorage.getItem('mcc_mobile') !== null
  ? localStorage.getItem('mcc_mobile') === '1'
  : (('ontouchstart' in window) || navigator.maxTouchPoints > 0);
function applyMobileUI() {
  document.getElementById('mobile-ui').style.display = isMobile ? 'block' : 'none';
  document.getElementById('box-mobile').textContent = isMobile ? '✓' : '✕';
}
document.getElementById('set-mobile').addEventListener('click', () => {
  isMobile = !isMobile;
  localStorage.setItem('mcc_mobile', isMobile ? '1' : '0');
  applyMobileUI();
});
applyMobileUI();

document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (!started) return;
  if (e.code === 'KeyB') { selectOpen ? closeSelect() : openSelect(); }
  if (e.code === 'Escape') {
    if (selectOpen) closeSelect();
    else if (paused) hidePause();
    else showPause();
  }
  if (e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5), 10);
    if (n >= 1 && n <= 9) { hotbarSel = n - 1; refreshHotbar(); }
  }
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

document.addEventListener('mousemove', e => {
  if (!locked || paused || selectOpen) return;
  player.yaw -= e.movementX * 0.0024;
  player.pitch -= e.movementY * 0.0024;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === document.getElementById('click-catcher');
  if (!locked && started && !paused && !selectOpen && !isMobile) showPause();
});
document.getElementById('click-catcher').addEventListener('click', () => {
  if (!started || isMobile || selectOpen) return;
  if (paused) hidePause();
  document.getElementById('click-catcher').requestPointerLock();
});
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('mousedown', e => {
  if (!started || !locked || paused || selectOpen) return;
  if (e.button === 0) { digHeld = true; doDig(); actionCd = 0.28; }
  else if (e.button === 2) { placeHeld = true; doPlace(); actionCd = 0.28; }
  else if (e.button === 1) { doPick(); e.preventDefault(); }
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) digHeld = false;
  if (e.button === 2) placeHeld = false;
});
document.addEventListener('wheel', e => {
  if (!started || paused || selectOpen) return;
  hotbarSel = (hotbarSel + (e.deltaY > 0 ? 1 : -1) + 9) % 9;
  refreshHotbar();
});

// ── Mobil touch ──
const touchMove = { x: 0, z: 0 };
let touchJump = false;
let touchSprint = false;   // toggle: érintésre be/ki
{
  const joyZone = document.getElementById('joystick-zone');
  const joyKnob = document.getElementById('joystick-knob');
  const lookZone = document.getElementById('look-zone');
  const JR = 62;
  let joyId = null, joyOx = 0, joyOy = 0;
  let lookId = null, lpx = 0, lpy = 0;

  joyZone.addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.changedTouches[0];
    joyId = t.identifier;
    const r = joyZone.getBoundingClientRect();
    joyOx = r.left + r.width / 2; joyOy = r.top + r.height / 2;
  }, { passive: false });
  joyZone.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      const dx = t.clientX - joyOx, dy = t.clientY - joyOy;
      const d = Math.hypot(dx, dy), cl = Math.min(d, JR);
      const nx = d > 0 ? dx / d * cl : 0, ny = d > 0 ? dy / d * cl : 0;
      joyKnob.style.transform = 'translate(calc(-50% + ' + nx + 'px), calc(-50% + ' + ny + 'px))';
      touchMove.x = nx / JR; touchMove.z = ny / JR;
    }
  }, { passive: false });
  const joyEnd = e => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      joyId = null; touchMove.x = 0; touchMove.z = 0;
      joyKnob.style.transform = 'translate(-50%,-50%)';
    }
  };
  joyZone.addEventListener('touchend', joyEnd);
  joyZone.addEventListener('touchcancel', joyEnd);

  lookZone.addEventListener('touchstart', e => {
    e.preventDefault();
    if (lookId !== null) return;
    const t = e.changedTouches[0];
    lookId = t.identifier; lpx = t.clientX; lpy = t.clientY;
  }, { passive: false });
  lookZone.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId) continue;
      player.yaw -= (t.clientX - lpx) * 0.0042;
      player.pitch -= (t.clientY - lpy) * 0.0042;
      player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
      lpx = t.clientX; lpy = t.clientY;
    }
  }, { passive: false });
  const lookEnd = e => { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; };
  lookZone.addEventListener('touchend', lookEnd);
  lookZone.addEventListener('touchcancel', lookEnd);

  function bindBtn(id, down, up) {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', e => { e.preventDefault(); el.classList.add('active'); down(); }, { passive: false });
    const end = e => { e.preventDefault(); el.classList.remove('active'); if (up) up(); };
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end, { passive: false });
  }
  bindBtn('jump-btn', () => { touchJump = true; }, () => { touchJump = false; });
  bindBtn('dig-btn', () => { digHeld = true; doDig(); actionCd = 0.28; }, () => { digHeld = false; });
  bindBtn('place-btn', () => { placeHeld = true; doPlace(); actionCd = 0.28; }, () => { placeHeld = false; });
  bindBtn('blocks-btn', () => { selectOpen ? closeSelect() : openSelect(); });
  // SPRINT: toggle — az aktív állapotot a gomb kiemelése mutatja
  {
    const sBtn = document.getElementById('sprint-btn');
    sBtn.addEventListener('touchstart', e => {
      e.preventDefault();
      touchSprint = !touchSprint;
      sBtn.classList.toggle('active', touchSprint);
    }, { passive: false });
  }
  // ESC: pause be/ki (select nyitva → azt zárja)
  document.getElementById('esc-btn').addEventListener('touchstart', e => {
    e.preventDefault();
    if (!started) return;
    if (selectOpen) closeSelect();
    else if (paused) hidePause();
    else showPause();
  }, { passive: false });
}
// select háttérre kattintva zárás
document.getElementById('select').addEventListener('click', e => {
  if (e.target === document.getElementById('select')) closeSelect();
});

// ═══ PAUSE ═══
function showPause() {
  paused = true;
  document.getElementById('pause').className = 'show';
  if (!isMobile) document.exitPointerLock();
}
function hidePause() {
  paused = false;
  document.getElementById('pause').className = '';
  if (!isMobile) document.getElementById('click-catcher').requestPointerLock();
}
document.getElementById('btn-resume').addEventListener('click', hidePause);
document.getElementById('btn-save').addEventListener('click', () => saveWorld(false));
document.getElementById('btn-exit').addEventListener('click', () => { saveWorld(true); location.reload(); });

// ═══ START / MENÜ ═══
const progressWrap = document.getElementById('progress-wrap');
const progressBar = document.getElementById('progress-bar');
const progressLbl = document.getElementById('progress-label');
async function progress(p, label) {
  progressBar.style.width = Math.min(100, Math.round(p * 100)) + '%';
  progressLbl.textContent = label + '… ' + Math.min(100, Math.round(p * 100)) + '%';
  // setTimeout (nem rAF): háttér-tabban a rAF megállna és sosem generálna le
  await new Promise(r => setTimeout(r, 0));
}

function computeAllColH() {
  for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) recomputeColH(x, z);
}
function findSpawn() {
  let best = null, bd = Infinity;
  for (let x = 4; x < SX - 4; x++) for (let z = 4; z < SZ - 4; z++) {
    const h = heights[x * SZ + z];
    if (h > SEA + 1 && world[idx(x, h, z)] === GRASS) {
      const d = (x - SX / 2) ** 2 + (z - SZ / 2) ** 2;
      if (d < bd) { bd = d; best = { x: x + 0.5, y: h + 1.2, z: z + 0.5 }; }
    }
  }
  return best || { x: SX / 2, y: SEA + 8, z: SZ / 2 };
}

// ── mentési slotok (5 világ) ──
const NUM_SLOTS = 5;
const slotKey = n => 'mcc_save_' + n;
let currentSlot = 0;
// régi, egy-mentéses formátum átköltöztetése az 1-es slotba
if (localStorage.getItem('mcc_save') && !localStorage.getItem(slotKey(0))) {
  localStorage.setItem(slotKey(0), localStorage.getItem('mcc_save'));
  localStorage.removeItem('mcc_save');
}
function slotInfo(n) {
  try {
    const s = JSON.parse(localStorage.getItem(slotKey(n)));
    return (s && s.data) ? s : null;
  } catch (e) { return null; }
}
function buildSlotList() {
  const list = document.getElementById('slot-list');
  list.innerHTML = '';
  for (let n = 0; n < NUM_SLOTS; n++) {
    const info = slotInfo(n);
    const row = document.createElement('div');
    row.className = 'slot-row';
    const btn = document.createElement('button');
    if (info) {
      const d = info.ts ? new Date(info.ts) : null;
      btn.textContent = 'WORLD ' + (n + 1) + ' — ' +
        (d ? (d.toLocaleDateString() + ' ' + d.toLocaleTimeString().slice(0, 5)) : 'SAVED');
      btn.addEventListener('click', () => { currentSlot = n; startGame(true); });
      const del = document.createElement('button');
      del.className = 'slot-del';
      del.textContent = '✕';
      del.title = 'Delete world';
      del.addEventListener('click', () => {
        if (confirm('Delete world ' + (n + 1) + '?')) {
          localStorage.removeItem(slotKey(n));
          buildSlotList();
        }
      });
      row.appendChild(btn);
      row.appendChild(del);
    } else {
      btn.textContent = 'WORLD ' + (n + 1) + ' — GENERATE NEW';
      btn.addEventListener('click', () => { currentSlot = n; startGame(false); });
      row.appendChild(btn);
    }
    list.appendChild(row);
  }
}
buildSlotList();

// ── fullscreen beállítás ──
let fsEnabled = localStorage.getItem('mcc_fs') !== '0';
function applyFsUI() {
  document.getElementById('box-fs').textContent = fsEnabled ? '✓' : '✕';
}
document.getElementById('set-fs').addEventListener('click', () => {
  fsEnabled = !fsEnabled;
  localStorage.setItem('mcc_fs', fsEnabled ? '1' : '0');
  applyFsUI();
});
applyFsUI();

// ── hang beállítás ──
let soundEnabled = localStorage.getItem('mcc_sound') !== '0';
function applySoundUI() {
  document.getElementById('box-sound').textContent = soundEnabled ? '✓' : '✕';
}
document.getElementById('set-sound').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem('mcc_sound', soundEnabled ? '1' : '0');
  applySoundUI();
});
applySoundUI();

// betöltési hibák kiírása a menübe (könnyebb hibakeresés)
window.addEventListener('error', e => {
  const el = document.getElementById('progress-label');
  if (el) { el.style.display = 'block'; el.textContent = 'ERROR: ' + e.message; }
});

let starting = false;
async function startGame(loadSave) {
  if (starting) return;
  starting = true;
  document.querySelectorAll('#slot-list button').forEach(b => b.disabled = true);
  progressWrap.style.display = 'block';
  progressLbl.style.display = 'block';

  if (fsEnabled) {
    const el = document.documentElement;
    try {
      const p = el.requestFullscreen && el.requestFullscreen();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
    try {
      if (screen.orientation && screen.orientation.lock)
        screen.orientation.lock('landscape').catch(() => {});
    } catch (e) {}
  }

  if (loadSave) {
    const save = slotInfo(currentSlot);
    if (!save) {   // sérült mentés → új világ
      loadSave = false;
    } else {
      loadWorldData(save);
      await progress(0.6, 'LOADING');
    }
  }
  if (!loadSave) {
    SEED = (Math.random() * 0xFFFFFFFF) >>> 0;
    await generateWorld(progress);
    const sp = findSpawn();
    player.x = sp.x; player.y = sp.y; player.z = sp.z;
    player.yaw = Math.PI * 0.25; player.pitch = 0;
    spawnPoint = { x: sp.x, y: sp.y, z: sp.z };
  }
  computeAllColH();
  await buildAllChunks(progress);

  refreshHotbar();
  buildSelectGrid();
  document.getElementById('menu').style.display = 'none';
  started = true;
  if (!isMobile) document.getElementById('click-catcher').requestPointerLock();
  prev = performance.now();
  requestAnimationFrame(loop);
  if (!isMobile) setTimeout(() => toast('Press "B" to open the block selector'), 400);
  // autosave percenként
  setInterval(() => { if (started && !paused) saveWorld(true); }, 60000);
}

// ═══ GAME LOOP ═══
const SPEED = 4.3, JUMP_V = 8.6, GRAV = 28;
let prev = 0;

function loop() {
  requestAnimationFrame(loop);
  if (!started) return;
  const now = performance.now();
  const dt = Math.min((now - prev) / 1000, 0.05);
  prev = now;
  if (paused) return;

  // ── irányítás ──
  let mx = 0, mz = 0;
  const fwdX = -Math.sin(player.yaw), fwdZ = -Math.cos(player.yaw);
  const rightX = Math.cos(player.yaw), rightZ = -Math.sin(player.yaw);
  if (isMobile) {
    mx = fwdX * (-touchMove.z) + rightX * touchMove.x;
    mz = fwdZ * (-touchMove.z) + rightZ * touchMove.x;
  } else if (!selectOpen) {
    if (keys['KeyW']) { mx += fwdX; mz += fwdZ; }
    if (keys['KeyS']) { mx -= fwdX; mz -= fwdZ; }
    if (keys['KeyA']) { mx -= rightX; mz -= rightZ; }
    if (keys['KeyD']) { mx += rightX; mz += rightZ; }
  }
  const len = Math.hypot(mx, mz) || 1;
  const moving = Math.hypot(mx, mz) > 0.01;
  const wet = inWater();
  const sprinting = moving && (isMobile ? touchSprint : (keys['ShiftLeft'] && !selectOpen));
  const spd = SPEED * (wet ? 0.6 : 1) * (sprinting ? 1.6 : 1);
  player.vx = (mx / len) * spd * (moving ? 1 : 0);
  player.vz = (mz / len) * spd * (moving ? 1 : 0);

  const jumpKey = isMobile ? touchJump : keys['Space'];
  if (wet) {
    player.vy += (jumpKey ? 22 : -16) * dt;
    player.vy = Math.max(-2.8, Math.min(3.2, player.vy));
  } else {
    if (jumpKey && player.onGround) player.vy = JUMP_V;
    player.vy -= GRAV * dt;
    player.vy = Math.max(-40, player.vy);
  }
  movePlayer(dt);

  // kimászás-segéd: vízben part felé úszva automatikusan felnyom a peremre
  if (wet && player.hitWall && moving) player.vy = Math.max(player.vy, 6.8);

  // ── kamera ──
  camera.position.set(player.x, player.y + player.EYE, player.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  // folyadék alatti nézet: vízben sűrű kék, lávában izzó narancs köd
  const eyeId = getB(Math.floor(camera.position.x), Math.floor(camera.position.y), Math.floor(camera.position.z));
  if (eyeId === WATER) {
    scene.fog.color.setHex(0x1a4bb8); scene.fog.near = 2; scene.fog.far = 26;
    renderer.setClearColor(0x1a4bb8);
  } else if (eyeId === LAVA) {
    scene.fog.color.setHex(0xc24a08); scene.fog.near = 0.5; scene.fog.far = 7;
    renderer.setClearColor(0xc24a08);
  } else {
    scene.fog.color.setHex(SKY); scene.fog.near = 60; scene.fog.far = 190;
    renderer.setClearColor(SKY);
  }

  // folyadék-terjedés ütemezése (a láva lassabban folyik)
  waterT -= dt;
  if (waterT <= 0) { liquidTick(WATER, waterQ); waterT = 0.18; }
  lavaT -= dt;
  if (lavaT <= 0) { liquidTick(LAVA, lavaQ); lavaT = 0.65; }

  // ── blokk-kijelölés + tartott ásás/rakás ──
  const hit = (!selectOpen && (locked || isMobile)) ? raycast() : null;
  if (hit) {
    highlight.visible = true;
    highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  } else highlight.visible = false;

  actionCd -= dt;
  if (actionCd <= 0) {
    if (digHeld) { doDig(); actionCd = 0.26; }
    else if (placeHeld) { doPlace(); actionCd = 0.26; }
  }

  // felhők sodródása
  cloudTex.offset.x += dt * 0.002;

  renderer.render(scene, camera);
}
