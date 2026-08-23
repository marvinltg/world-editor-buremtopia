import { promises as fs, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join, basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ITEMS_JSON = join(ROOT, "data", "items.json");
const CACHE = join(ROOT, "data", "cache-items");
const OUT_GEN = join(ROOT, "public", "gen");
const OUT_RTTEX = join(ROOT, "public", "rttex");
const OUT_WEATHER = join(OUT_GEN, "weather");

// Layer cuaca: m = mode render ("tile" = ulang native, "cover" = skala penuhi canvas,
// "hills" = ulang horizontal nempel dasar dengan tinggi hp * tinggi world), a = alpha.
const WEATHER_DEFS = [
    { id: 0, name: "Default", layers: [
        { f: "b_skybg", m: "tile" },
        { f: "b_hills3", m: "hills", hp: 0.6 },
        { f: "b_hills2", m: "hills", hp: 0.45 },
        { f: "b_hills1", m: "hills", hp: 0.3 }
    ] },
    { id: 1, name: "Sunset", layers: [
        { f: "sunset", m: "tile" },
        { f: "b_hills3", m: "hills", hp: 0.55, a: 0.9 },
        { f: "b_hills2", m: "hills", hp: 0.42, a: 0.95 },
        { f: "b_hills1", m: "hills", hp: 0.28 }
    ] },
    { id: 2, name: "Night", layers: [
        { f: "night_back", m: "tile" },
        { f: "b_hills3", m: "hills", hp: 0.55, a: 0.8 },
        { f: "b_hills2", m: "hills", hp: 0.42, a: 0.85 },
        { f: "b_hills1", m: "hills", hp: 0.28, a: 0.9 }
    ] },
    { id: 3, name: "Desert", layers: [
        { f: "desert_sky", m: "tile" },
        { f: "desert_hills2", m: "hills", hp: 0.48 },
        { f: "desert_hills", m: "hills", hp: 0.32 }
    ] },
    { id: 7, name: "Mars", layers: [
        { f: "mars_back", m: "tile" }
    ] },
    { id: 11, name: "Snowy", layers: [
        { f: "icebg_skybg", m: "tile" },
        { f: "icebg_3", m: "hills", hp: 0.52 },
        { f: "icebg_4", m: "hills", hp: 0.42 },
        { f: "icebg_1", m: "hills", hp: 0.3 }
    ] },
    { id: 14, name: "Undersea", layers: [
        { f: "darkbluewater", m: "tile" },
        { f: "water_ray", m: "tile", a: 0.25 }
    ] },
    { id: 32, name: "Jungle", layers: [
        { f: "jungle_sky", m: "tile" },
        { f: "jungle_hills", m: "hills", hp: 0.55 },
        { f: "jungle_hills2", m: "hills", hp: 0.4 }
    ] },
    { id: 87, name: "Bedawang Nala", layers: [
        { f: "bg_BN_sky", m: "tile" },
        { f: "bg_BN_layer3", m: "cover", a: 0.9 },
        { f: "bg_BN_layer2", m: "cover" },
        { f: "bg_BN_layer1", m: "hills", hp: 0.35 }
    ] }
];

const EXCLUDED_ACTIONS = new Set([0, 1, 4, 8, 19, 20, 37, 63, 72, 115, 129]);
const BG_ACTIONS = new Set([18, 22, 23, 28]);

function walk(dir, out) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, out);
        else if (name.toLowerCase().endsWith(".rttex")) out.push(full);
    }
}

function decodeRttex(buf) {
    if (buf.subarray(0, 6).toString() !== "RTPACK") throw new Error("no RTPACK magic");
    const payload = inflateSync(buf.subarray(32));
    if (payload.subarray(0, 4).toString() !== "RTTX") throw new Error("no RTTX payload");
    const w = payload.readUInt32LE(8);
    const h = payload.readUInt32LE(12);
    const px = payload.subarray(124, 124 + w * h * 4);
    if (px.length !== w * h * 4) throw new Error("pixel data truncated");
    return { w, h, px };
}

const db = JSON.parse(readFileSync(ITEMS_JSON, "utf8"));
console.log(`items.json v${db.version} items=${db.item_count}`);

const files = [];
walk(CACHE, files);
const byBase = new Map();
for (const f of files) {
    const base = basename(f);
    const isCache = f.split(/[\\/]/).includes("cache");
    const prev = byBase.get(base.toLowerCase());
    if (!prev || (!isCache && prev.isCache)) byBase.set(base.toLowerCase(), { path: f, isCache });
}

const needed = new Map();
for (const it of db.items) {
    if (EXCLUDED_ACTIONS.has(it.action_type)) continue;
    if (!it.texture) continue;
    if (!needed.has(it.texture)) needed.set(it.texture, { count: 0 });
    needed.get(it.texture).count++;
}

mkdirSync(OUT_GEN, { recursive: true });
mkdirSync(OUT_RTTEX, { recursive: true });

const atlasIndex = {};
const avgColor = new Map();
let missingAtlas = [];

for (const [tex, info] of needed) {
    const entry = byBase.get(tex.toLowerCase());
    if (!entry) { missingAtlas.push(tex); continue; }
    const dest = join(OUT_RTTEX, tex.replace(/[\\/]/g, "_"));
    if (!existsSync(dest) || statSync(dest).size !== statSync(entry.path).size) {
        writeFileSync(dest, readFileSync(entry.path));
    }
    atlasIndex[tex] = "rttex/" + tex.replace(/[\\/]/g, "_");

    const dec = decodeRttex(readFileSync(entry.path));
    const { w, h, px } = dec;
    const GH = h / 32;
    for (const it of db.items) {
        if (it.texture !== tex || EXCLUDED_ACTIONS.has(it.action_type)) continue;
        const py = GH - 1 - it.texture_y;
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = 0; y < 32; y++) {
            for (let x = 0; x < 32; x++) {
                const o = ((py * 32 + y) * w + (it.texture_x * 32 + x)) * 4;
                if (px[o + 3] > 40) { r += px[o]; g += px[o + 1]; b += px[o + 2]; n++; }
            }
        }
        avgColor.set(it.item_id, n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [140, 140, 140]);
    }
}

const records = [];
for (const it of db.items) {
    if (EXCLUDED_ACTIONS.has(it.action_type)) continue;
    if (!it.texture) continue;
    if (!atlasIndex[it.texture]) continue;
    records.push([
        it.item_id,
        it.name || "",
        it.texture,
        it.texture_x | 0,
        it.texture_y | 0,
        BG_ACTIONS.has(it.action_type) ? 1 : 0,
        it.rarity || 0,
        avgColor.get(it.item_id) || [140, 140, 140]
    ]);
}
records.sort((a, b) => a[0] - b[0]);

writeFileSync(join(OUT_GEN, "items_index.json"), JSON.stringify({
    v: 1,
    fields: ["id", "name", "tex", "tx", "ty", "layer", "rarity", "color"],
    items: records
}));
writeFileSync(join(OUT_GEN, "atlas_index.json"), JSON.stringify(atlasIndex));

console.log(`placeable: ${records.length} | atlases: ${Object.keys(atlasIndex).length} | missing: ${missingAtlas.length} ${missingAtlas.join(", ")}`);

console.log("mengekstrak background weather...");
mkdirSync(OUT_WEATHER, { recursive: true });
const weatherOut = [];
for (const wd of WEATHER_DEFS) {
    const layers = [];
    for (const L of wd.layers) {
        const key = L.f.toLowerCase() + ".rttex";
        const entry = byBase.get(key);
        if (!entry) {
            console.warn(`  weather ${wd.name}: asset ${key} tidak ada di cache, layer dilewati`);
            continue;
        }
        const destName = L.f.replace(/[\\/]/g, "_") + ".rttex";
        const dest = join(OUT_WEATHER, destName);
        if (!existsSync(dest) || statSync(dest).size !== statSync(entry.path).size) {
            writeFileSync(dest, readFileSync(entry.path));
        }
        const dec = decodeRttex(readFileSync(entry.path));
        layers.push({
            src: "gen/weather/" + destName,
            m: L.m,
            hp: L.hp ?? 0,
            a: L.a ?? 1,
            iw: dec.w,
            ih: dec.h
        });
    }
    if (!layers.length) {
        console.warn(`  weather ${wd.name}: tidak ada layer valid, dilewati`);
        continue;
    }
    weatherOut.push({ id: wd.id, name: wd.name, layers });
}
writeFileSync(join(OUT_GEN, "weather_index.json"), JSON.stringify({ v: 1, weathers: weatherOut }));
console.log(`weather bg: ${weatherOut.length} cuaca | ${weatherOut.reduce((n, w) => n + w.layers.length, 0)} layer`);
