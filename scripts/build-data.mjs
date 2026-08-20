import { promises as fs, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join, basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ITEMS_JSON = join(ROOT, "data", "items.json");
const CACHE = join(ROOT, "data", "cache-items");
const OUT_GEN = join(ROOT, "public", "gen");
const OUT_RTTEX = join(ROOT, "public", "rttex");

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
