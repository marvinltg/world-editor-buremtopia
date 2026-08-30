import type { TileExtra, WorldState } from "./world";
import {
    DEFAULT_WORLD_W,
    DEFAULT_WORLD_H,
    MAX_WORLD_W,
    MAX_WORLD_H
} from "./world";

export const FORMAT_VERSION = 26;

const DEFAULTS: Record<string, unknown> = {
    entry_level: 1,
    music_bpm: 100,
    weather: 0,
    d_weather: 0,
    xeno: 0,
    w_s: 0,
    wt: 0,
    r: 255,
    g: 128,
    b: 64,
    ct: "",
    n_b: "",
    owner: "",
    o2: "",
    guild_world_id: 0
};

export interface ExportOptions {
    worldName: string;
}

export interface ExportResult {
    blob: Blob;
    filename: string;
}

export function validateName(name: string): string | null {
    if (!name || !/^[A-Za-z0-9_-]+$/.test(name)) return "Nama world harus alfanumerik (A-Z, 0-9), tanpa spasi";
    if (name.length > 24) return "Nama world maksimal 24 karakter";
    return null;
}

function sortedObject(entries: [string, unknown][]): Record<string, unknown> {
    const sorted = entries.filter(([, v]) => v !== undefined).sort((a, b) => a[0].localeCompare(b[0]));
    return Object.fromEntries(sorted);
}

function blocksArray(fg: Uint16Array, bg: Uint16Array, extra: Map<number, TileExtra>, tileCount: number): unknown[] {
    const out: unknown[] = new Array(tileCount);
    for (let i = 0; i < tileCount; i++) {
        const e = extra.get(i);
        const entries: [string, unknown][] = [];
        if (e?.raw) {
            for (const [k, v] of Object.entries(e.raw)) entries.push([k, v]);
        }
        if (bg[i] !== 0) entries.push(["b", bg[i]]);
        if (e?.doorDestination) entries.push(["dd", e.doorDestination]);
        if (e?.doorId) entries.push(["di", e.doorId]);
        if (fg[i] !== 0) entries.push(["f", fg[i]]);
        if (e?.flags !== undefined && e.flags !== 0) entries.push(["fl", e.flags]);
        if (e?.open !== undefined && e.open !== 1) entries.push(["o", e.open]);
        if (e?.txt) entries.push(["t", e.txt]);
        if (entries.length === 0) {
            out[i] = null;
            continue;
        }
        out[i] = sortedObject(entries);
    }
    return out;
}

export function exportWorld(state: WorldState, opts: ExportOptions): ExportResult {
    const errors: string[] = [];
    const nameErr = validateName(opts.worldName);
    if (nameErr) errors.push(nameErr);

    const w = state.w > 0 ? state.w : DEFAULT_WORLD_W;
    const h = state.h > 0 ? state.h : DEFAULT_WORLD_H;
    if (w < 1 || w > MAX_WORLD_W) errors.push(`Lebar world ${w} di luar batas 1-${MAX_WORLD_W}`);
    if (h < 1 || h > MAX_WORLD_H) errors.push(`Tinggi world ${h} di luar batas 1-${MAX_WORLD_H}`);
    const tileCount = w * h;
    if (state.fg.length !== tileCount || state.bg.length !== tileCount) {
        errors.push(`Ukuran tile tidak valid: ${state.fg.length}/${state.bg.length} (harus ${tileCount} = ${w}x${h})`);
    }
    for (let i = 0; i < Math.min(state.fg.length, tileCount); i++) {
        if (state.fg[i] > 0xFFFF || state.bg[i] > 0xFFFF) {
            errors.push(`ID item di tile ${i} melewati batas uint16`);
            break;
        }
    }
    for (const [i] of state.extra) {
        if (i < 0 || i >= tileCount) {
            errors.push(`Extra data di index ${i} di luar jangkauan world`);
            break;
        }
    }
    if (errors.length) throw new Error(errors.join("\n"));

    const name = opts.worldName.toUpperCase();
    const doc: Record<string, unknown> = {
        admins: [],
        b: DEFAULTS.b,
        blocks: blocksArray(state.fg, state.bg, state.extra, tileCount),
        bulletin: [],
        cc_s: [],
        cctv: [],
        ct: DEFAULTS.ct,
        d_weather: DEFAULTS.d_weather,
        drop_new: [],
        entry_level: DEFAULTS.entry_level,
        g: DEFAULTS.g,
        guild_world_id: DEFAULTS.guild_world_id,
        machine: [],
        max_x: w,
        max_y: h,
        music_bpm: DEFAULTS.music_bpm,
        n_b: DEFAULTS.n_b,
        npc: [],
        o2: DEFAULTS.o2,
        owner: DEFAULTS.owner,
        r: DEFAULTS.r,
        sbox1: [],
        w_s: DEFAULTS.w_s,
        weather: DEFAULTS.weather,
        whitelist: [],
        wt: DEFAULTS.wt,
        xeno: DEFAULTS.xeno
    };
    const blob = new Blob([JSON.stringify(doc)], { type: "application/json" });
    return { blob, filename: `${name}_.json` };
}

export interface ImportStats {
    name: string;
    w: number;
    h: number;
    tiles: number;
    fgCount: number;
    bgCount: number;
    extraCount: number;
}

// Simplified Lua script tile - just id,x,y format
export interface LuaScriptTile {
    i: number;   // tile index
    id: number;  // item ID
    layer: 0 | 1; // 0 = foreground, 1 = background
}

// Parse a single line like "7444,0,7" or "BG:728,0,18"
function parseLuaScriptLine(line: string): LuaScriptTile | null {
    let trimmed = line.trim();
    if (!trimmed) return null;

    // Handle BG: prefix for background items
    const bgPrefix = trimmed.startsWith("BG:");
    if (bgPrefix) trimmed = trimmed.substring(3).trim();

    const parts = trimmed.split(",");
    if (parts.length < 3) return null;

    const id = parseInt(parts[0].trim(), 10);
    if (isNaN(id)) return null;

    const x = parseInt(parts[1].trim(), 10);
    const y = parseInt(parts[2].trim(), 10);
    if (isNaN(x) || isNaN(y)) return null;

    const i = y * 100 + x; // assuming world width 100, will be validated later
    const layer = bgPrefix ? 1 : 0;

    return { i, id, layer };
}

// Parse entire Lua script world text into WorldState
export function parseLuaScriptWorld(text: string): { state: WorldState; tiles: LuaScriptTile[] } {
    const lines = text.split("\n").filter((l: string) => l.trim() !== "");
    const tiles: LuaScriptTile[] = [];

    // Fixed world dimensions for Lua script format
    const maxX = 100; // DEFAULT_WORLD_W
    const maxY = 60;  // DEFAULT_WORLD_H
    const tileCount = maxX * maxY;

    const fg = new Uint16Array(tileCount).fill(0);
    const bg = new Uint16Array(tileCount).fill(0);

    for (const line of lines) {
        const tile = parseLuaScriptLine(line);
        if (!tile) continue;
        if (tile.i < 0 || tile.i >= tileCount) continue;

        if (tile.layer === 0) {
            fg[tile.i] = tile.id;
        } else {
            bg[tile.i] = tile.id;
        }

        tiles.push(tile);
    }

    return {
        state: { name: "START", w: maxX, h: maxY, fg, bg, extra: new Map() },
        tiles
    };
}

// Export world state as Lua script text format (id,x,y)
export function exportLuaScriptWorld(state: WorldState): string {
    const lines: string[] = [];
    const w = state.w > 0 ? state.w : 100;
    const h = state.h > 0 ? state.h : 60;

    // Export foreground tiles
    for (let i = 0; i < state.fg.length; i++) {
        const id = state.fg[i];
        if (id !== 0) {
            const x = i % w;
            const y = (i / w) | 0;
            lines.push(`${id},${x},${y}`);
        }
    }

    // Export background tiles
    for (let i = 0; i < state.bg.length; i++) {
        const id = state.bg[i];
        if (id !== 0) {
            const x = i % w;
            const y = (i / w) | 0;
            lines.push(`BG:${id},${x},${y}`);
        }
    }

    return lines.join("\n");
}

// Import from Lua script text format
export function importLuaScriptWorld(text: string): WorldState {
    const { state } = parseLuaScriptWorld(text);
    return state;
}

const KNOWN_BLOCK_KEYS = new Set(["f", "b", "t", "dd", "di", "o", "fl"]);

function isGtpsWorld(obj: unknown): obj is Record<string, unknown> {
    if (!obj || typeof obj !== "object") return false;
    const o = obj as Record<string, unknown>;
    return Array.isArray(o.blocks);
}

function inferDimensions(count: number, doc: Record<string, unknown>): { w: number; h: number } {
    const mx = typeof doc.max_x === "number" ? doc.max_x : 0;
    const my = typeof doc.max_y === "number" ? doc.max_y : 0;
    if (mx >= 1 && mx <= MAX_WORLD_W && my >= 1 && my <= MAX_WORLD_H && mx * my === count) {
        return { w: mx, h: my };
    }
    // Server GTPS3 memakai lebar tetap 100 (max_y = size / 100), coba itu dulu.
    if (count % DEFAULT_WORLD_W === 0 && count / DEFAULT_WORLD_W <= MAX_WORLD_H) {
        return { w: DEFAULT_WORLD_W, h: count / DEFAULT_WORLD_W };
    }
    let bestW = 0;
    let bestH = 0;
    let bestScore = Infinity;
    for (let w = 1; w <= MAX_WORLD_W; w++) {
        if (count % w !== 0) continue;
        const h = count / w;
        if (h < 1 || h > MAX_WORLD_H) continue;
        const score = Math.abs(w - DEFAULT_WORLD_W) + Math.abs(h - DEFAULT_WORLD_H);
        if (score < bestScore) {
            bestScore = score;
            bestW = w;
            bestH = h;
        }
    }
    if (!bestW) throw new Error(`Jumlah tile ${count} tidak bisa dibagi menjadi ukuran world valid (${DEFAULT_WORLD_W}x${DEFAULT_WORLD_H} default, maksimal ${MAX_WORLD_W}x${MAX_WORLD_H})`);
    return { w: bestW, h: bestH };
}

export function parseWorld(text: string): { state: WorldState; stats: ImportStats } {
    let doc: unknown;
    try {
        doc = JSON.parse(text);
    } catch (e) {
        throw new Error("File bukan JSON valid: " + (e as Error).message);
    }
    if (!isGtpsWorld(doc)) throw new Error('Format tidak dikenali: harus berisi array "blocks" (format GTPS3 world JSON)');

    const blocks = doc.blocks as unknown[];
    const { w, h } = inferDimensions(blocks.length, doc);

    const fg = new Uint16Array(w * h);
    const bg = new Uint16Array(w * h);
    const extra = new Map<number, TileExtra>();
    let fgCount = 0;
    let bgCount = 0;

    for (let i = 0; i < blocks.length; i++) {
        const raw = blocks[i];
        if (!raw || typeof raw !== "object") continue;
        const b = raw as Record<string, unknown>;
        if (typeof b.f === "number") {
            fg[i] = b.f & 0xFFFF;
            fgCount++;
        }
        if (typeof b.b === "number") {
            bg[i] = b.b & 0xFFFF;
            bgCount++;
        }
        const e: TileExtra = {};
        if (typeof b.t === "string") e.txt = b.t;
        if (typeof b.dd === "string") e.doorDestination = b.dd;
        if (typeof b.di === "string") e.doorId = b.di;
        if (typeof b.o === "number") e.open = b.o;
        if (typeof b.fl === "number") e.flags = b.fl;
        const kept: Record<string, unknown> = {};
        let hasKept = false;
        for (const k of Object.keys(b)) {
            if (!KNOWN_BLOCK_KEYS.has(k)) {
                kept[k] = b[k];
                hasKept = true;
            }
        }
        if (hasKept) e.raw = kept;
        if (e.txt || e.doorDestination || e.doorId || e.open !== undefined || e.flags !== undefined || e.raw) {
            extra.set(i, e);
        }
    }

    let name = "";
    if (typeof doc.owner === "string" && doc.owner) name = doc.owner;
    return {
        state: { name, w, h, fg, bg, extra },
        stats: { name, w, h, tiles: w * h, fgCount, bgCount, extraCount: extra.size }
    };
}
