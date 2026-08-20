import type { TileExtra, WorldState } from "./world";

export const WORLD_W = 100;
export const WORLD_H = 60;
export const TILE_COUNT = WORLD_W * WORLD_H;
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

function blocksArray(fg: Uint16Array, bg: Uint16Array, extra: Map<number, TileExtra>): unknown[] {
    const out: unknown[] = new Array(TILE_COUNT);
    for (let i = 0; i < TILE_COUNT; i++) {
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
    if (state.fg.length !== TILE_COUNT || state.bg.length !== TILE_COUNT) {
        errors.push(`Ukuran tile tidak valid: ${state.fg.length}/${state.bg.length} (harus ${TILE_COUNT})`);
    }
    for (let i = 0; i < TILE_COUNT; i++) {
        if (state.fg[i] > 0xFFFF || state.bg[i] > 0xFFFF) {
            errors.push(`ID item di tile ${i} melewati batas uint16`);
            break;
        }
    }
    for (const [i] of state.extra) {
        if (i < 0 || i >= TILE_COUNT) {
            errors.push(`Extra data di index ${i} di luar jangkauan world`);
            break;
        }
    }
    if (errors.length) throw new Error(errors.join("\n"));

    const name = opts.worldName.toUpperCase();
    const doc: Record<string, unknown> = {
        admins: [],
        b: DEFAULTS.b,
        blocks: blocksArray(state.fg, state.bg, state.extra),
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
    tiles: number;
    fgCount: number;
    bgCount: number;
    extraCount: number;
}

const KNOWN_BLOCK_KEYS = new Set(["f", "b", "t", "dd", "di", "o", "fl"]);

function isGtpsWorld(obj: unknown): obj is Record<string, unknown> {
    if (!obj || typeof obj !== "object") return false;
    const o = obj as Record<string, unknown>;
    return Array.isArray(o.blocks);
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
    if (blocks.length !== TILE_COUNT) {
        throw new Error(`Jumlah tile ${blocks.length} tidak sesuai, harus ${TILE_COUNT} (100x60)`);
    }

    const fg = new Uint16Array(TILE_COUNT);
    const bg = new Uint16Array(TILE_COUNT);
    const extra = new Map<number, TileExtra>();
    let fgCount = 0;
    let bgCount = 0;

    for (let i = 0; i < TILE_COUNT; i++) {
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
        state: { name, fg, bg, extra },
        stats: { name, tiles: TILE_COUNT, fgCount, bgCount, extraCount: extra.size }
    };
}
