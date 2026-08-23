import type { TileOp } from "./types";

export const DEFAULT_WORLD_W = 100;
export const DEFAULT_WORLD_H = 60;
export const MIN_WORLD_W = 10;
export const MIN_WORLD_H = 10;
export const MAX_WORLD_W = 200;
export const MAX_WORLD_H = 120;

export function clampW(w: number): number {
    return Math.min(MAX_WORLD_W, Math.max(MIN_WORLD_W, Math.round(w) || DEFAULT_WORLD_W));
}

export function clampH(h: number): number {
    return Math.min(MAX_WORLD_H, Math.max(MIN_WORLD_H, Math.round(h) || DEFAULT_WORLD_H));
}

export interface TileExtra {
    txt?: string;
    doorDestination?: string;
    doorId?: string;
    open?: number;
    flags?: number;
    raw?: Record<string, unknown>;
}

export interface WorldState {
    name: string;
    w: number;
    h: number;
    fg: Uint16Array;
    bg: Uint16Array;
    extra: Map<number, TileExtra>;
}

export type WorldListener = (indices: number[], full: boolean) => void;

export class World {
    w: number;
    h: number;
    fg: Uint16Array;
    bg: Uint16Array;
    extra: Map<number, TileExtra>;
    name = "START";

    private undoStack: TileOp[][] = [];
    private redoStack: TileOp[][] = [];
    private currentOps: TileOp[] | null = null;
    private listeners: WorldListener[] = [];
    private dirtySinceFlush = new Set<number>();
    private locked = new Set<number>();

    constructor(w: number = DEFAULT_WORLD_W, h: number = DEFAULT_WORLD_H) {
        this.w = clampW(w);
        this.h = clampH(h);
        this.fg = new Uint16Array(this.tileCount);
        this.bg = new Uint16Array(this.tileCount);
        this.extra = new Map();
    }

    get tileCount(): number {
        return this.w * this.h;
    }

    onChange(fn: WorldListener): void {
        this.listeners.push(fn);
    }

    resize(w: number, h: number): boolean {
        const nw = clampW(w);
        const nh = clampH(h);
        if (nw === this.w && nh === this.h) return false;
        const nfg = new Uint16Array(nw * nh);
        const nbg = new Uint16Array(nw * nh);
        const copyW = Math.min(this.w, nw);
        const copyH = Math.min(this.h, nh);
        for (let y = 0; y < copyH; y++) {
            for (let x = 0; x < copyW; x++) {
                const si = y * this.w + x;
                const di = y * nw + x;
                nfg[di] = this.fg[si];
                nbg[di] = this.bg[si];
            }
        }
        this.fg = nfg;
        this.bg = nbg;
        this.w = nw;
        this.h = nh;
        this.extra.clear();
        this.locked.clear();
        this.undoStack.length = 0;
        this.redoStack.length = 0;
        if (this.currentOps) this.currentOps = null;
        this.dirtySinceFlush.clear();
        this.emit([], true);
        return true;
    }

    isLocked(i: number): boolean {
        return this.locked.has(i);
    }

    setLocked(i: number, on: boolean): void {
        if (on) this.locked.add(i);
        else this.locked.delete(i);
    }

    private emit(indices: number[], full = false): void {
        for (const fn of this.listeners) fn(indices, full);
    }

    beginOp(): void {
        if (!this.currentOps) {
            this.currentOps = [];
            this.dirtySinceFlush.clear();
        }
    }

    endOp(): boolean {
        const ops = this.currentOps;
        this.currentOps = null;
        if (ops && ops.length > 0) {
            this.undoStack.push(ops);
            if (this.undoStack.length > 100) this.undoStack.shift();
            this.redoStack.length = 0;
            return true;
        }
        return false;
    }

    get undoDepth(): number { return this.undoStack.length; }
    get redoDepth(): number { return this.redoStack.length; }

    setTile(i: number, layer: 0 | 1, value: number): void {
        const arr = layer === 0 ? this.fg : this.bg;
        if (i < 0 || i >= arr.length) return;
        if (arr[i] === value) return;
        if (this.currentOps) this.currentOps.push({ i, l: layer, old: arr[i], nw: value });
        arr[i] = value;
        this.dirtySinceFlush.add(i);
    }

    flushEmit(): void {
        if (this.dirtySinceFlush.size === 0) return;
        const indices = [...this.dirtySinceFlush];
        this.dirtySinceFlush.clear();
        this.emit(indices);
    }

    paint(i: number, tool: "place" | "erase", layer: 0 | 1, value: number): boolean {
        if (this.locked.has(i)) return false;
        if (tool === "erase") {
            if (this.fg[i] === 0 && this.bg[i] === 0 && !this.extra.has(i)) return false;
            this.setTile(i, 0, 0);
            this.setTile(i, 1, 0);
            this.extra.delete(i);
            this.dirtySinceFlush.add(i);
            return true;
        }
        const arr = layer === 0 ? this.fg : this.bg;
        if (arr[i] === value) return false;
        this.setTile(i, layer, value);
        return true;
    }

    fill(start: number, layer: 0 | 1, value: number): number[] {
        if (this.locked.has(start)) return [];
        const W = this.w;
        const H = this.h;
        const count = this.tileCount;
        const arr = layer === 0 ? this.fg : this.bg;
        const target = arr[start];
        if (target === value) return [];
        const changed: number[] = [];
        const stack = [start];
        const seen = new Uint8Array(count);
        seen[start] = 1;
        while (stack.length) {
            const i = stack.pop()!;
            if (arr[i] !== target || this.locked.has(i)) continue;
            this.setTile(i, layer, value);
            changed.push(i);
            const x = i % W;
            const y = (i / W) | 0;
            if (x > 0 && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
            if (x < W - 1 && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
            if (y > 0 && !seen[i - W]) { seen[i - W] = 1; stack.push(i - W); }
            if (y < H - 1 && !seen[i + W]) { seen[i + W] = 1; stack.push(i + W); }
        }
        return changed;
    }

    clear(): void {
        this.beginOp();
        for (let i = 0; i < this.tileCount; i++) {
            if (this.locked.has(i)) continue;
            this.setTile(i, 0, 0);
            this.setTile(i, 1, 0);
            this.extra.delete(i);
        }
        this.endOp();
        this.flushEmit();
    }

    undo(): boolean {
        const ops = this.undoStack.pop();
        if (!ops) return false;
        for (let k = ops.length - 1; k >= 0; k--) {
            const op = ops[k];
            const arr = op.l === 0 ? this.fg : this.bg;
            arr[op.i] = op.old;
        }
        this.redoStack.push(ops);
        const indices = [...new Set(ops.map(o => o.i))];
        this.emit(indices);
        return true;
    }

    redo(): boolean {
        const ops = this.redoStack.pop();
        if (!ops) return false;
        for (const op of ops) {
            const arr = op.l === 0 ? this.fg : this.bg;
            arr[op.i] = op.nw;
        }
        this.undoStack.push(ops);
        const indices = [...new Set(ops.map(o => o.i))];
        this.emit(indices);
        return true;
    }

    replaceWhole(fg: Uint16Array, bg: Uint16Array, extra: Map<number, TileExtra>, name: string, w?: number, h?: number): void {
        if (w !== undefined && h !== undefined && w * h === fg.length) {
            this.w = clampW(w);
            this.h = clampH(h);
        } else {
            const guessH = clampH(Math.round(fg.length / DEFAULT_WORLD_W));
            this.h = clampH(guessH);
            this.w = clampW(Math.max(1, Math.round(fg.length / this.h)));
        }
        if (fg.length !== this.w * this.h) {
            const nfg = new Uint16Array(this.tileCount);
            nfg.set(fg.subarray(0, Math.min(fg.length, this.tileCount)));
            fg = nfg;
            const nbg = new Uint16Array(this.tileCount);
            nbg.set(bg.subarray(0, Math.min(bg.length, this.tileCount)));
            bg = nbg;
        }
        this.fg = fg;
        this.bg = bg;
        this.extra = extra;
        this.name = name;
        this.locked.clear();
        this.undoStack.length = 0;
        this.redoStack.length = 0;
        this.emit([], true);
    }
}
