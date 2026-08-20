import type { TileOp } from "./types";

export const WORLD_W = 100;
export const WORLD_H = 60;
export const TILE_COUNT = WORLD_W * WORLD_H;

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
    fg: Uint16Array;
    bg: Uint16Array;
    extra: Map<number, TileExtra>;
}

export type WorldListener = (indices: number[], full: boolean) => void;

export class World {
    fg: Uint16Array;
    bg: Uint16Array;
    extra: Map<number, TileExtra>;
    name = "START";

    private undoStack: TileOp[][] = [];
    private redoStack: TileOp[][] = [];
    private currentOps: TileOp[] | null = null;
    private listeners: WorldListener[] = [];
    private dirtySinceFlush = new Set<number>();

    constructor() {
        this.fg = new Uint16Array(TILE_COUNT);
        this.bg = new Uint16Array(TILE_COUNT);
        this.extra = new Map();
    }

    onChange(fn: WorldListener): void {
        this.listeners.push(fn);
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
        const arr = layer === 0 ? this.fg : this.bg;
        const target = arr[start];
        if (target === value) return [];
        const changed: number[] = [];
        const stack = [start];
        const seen = new Uint8Array(TILE_COUNT);
        seen[start] = 1;
        while (stack.length) {
            const i = stack.pop()!;
            if (arr[i] !== target) continue;
            this.setTile(i, layer, value);
            changed.push(i);
            const x = i % WORLD_W;
            const y = (i / WORLD_W) | 0;
            if (x > 0 && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
            if (x < WORLD_W - 1 && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
            if (y > 0 && !seen[i - WORLD_W]) { seen[i - WORLD_W] = 1; stack.push(i - WORLD_W); }
            if (y < WORLD_H - 1 && !seen[i + WORLD_W]) { seen[i + WORLD_W] = 1; stack.push(i + WORLD_W); }
        }
        return changed;
    }

    clear(): void {
        this.beginOp();
        for (let i = 0; i < TILE_COUNT; i++) {
            this.setTile(i, 0, 0);
            this.setTile(i, 1, 0);
        }
        this.extra.clear();
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

    replaceWhole(fg: Uint16Array, bg: Uint16Array, extra: Map<number, TileExtra>, name: string): void {
        this.fg = fg;
        this.bg = bg;
        this.extra = extra;
        this.name = name;
        this.undoStack.length = 0;
        this.redoStack.length = 0;
        this.emit([], true);
    }
}
