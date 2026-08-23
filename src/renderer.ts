import type { ItemEntry } from "./types";
import { World } from "./world";
import { cropCache, findAtlas, makeTileCanvas } from "./rttex";
import { atlasUrlFor, itemById } from "./items";
import { WeatherBackground, WEATHER_NONE } from "./weather";

const TILE = 32;

export interface Viewport {
    zoom: number;
    offX: number;
    offY: number;
}

interface HoverState {
    x: number;
    y: number;
    item: ItemEntry | null;
    tool: string;
    size: number;
}

export class WorldRenderer {
    canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private worldCanvas = document.createElement("canvas");
    private worldCtx: CanvasRenderingContext2D;
    private gridCanvas = document.createElement("canvas");
    private gridCtx: CanvasRenderingContext2D;

    vp: Viewport = { zoom: 0.25, offX: 0, offY: 0 };
    showGrid = true;
    showFg = true;
    showBg = true;
    hover: HoverState | null = null;
    selectedTile = -1;
    weather: WeatherBackground | null = null;
    private renderQueued = false;
    private pending = new Map<number, Set<number>>();
    private pattern: CanvasPattern | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d")!;
        this.worldCtx = this.worldCanvas.getContext("2d")!;
        this.worldCtx.imageSmoothingEnabled = false;
        this.gridCtx = this.gridCanvas.getContext("2d")!;
        this.buildBackdropPattern();
        new ResizeObserver(() => this.requestRender()).observe(canvas.parentElement!);
    }

    get worldPxW(): number {
        return (currentWorld?.w ?? 0) * TILE;
    }

    get worldPxH(): number {
        return (currentWorld?.h ?? 0) * TILE;
    }

    ensureBackingStore(): void {
        const w = currentWorld;
        if (!w) return;
        const pw = this.worldPxW;
        const ph = this.worldPxH;
        if (this.worldCanvas.width !== pw || this.worldCanvas.height !== ph) {
            this.worldCanvas.width = pw;
            this.worldCanvas.height = ph;
            this.gridCanvas.width = pw;
            this.gridCanvas.height = ph;
            this.buildGrid();
            if (this.weather) this.weather.invalidate();
        }
    }

    private buildGrid(): void {
        const W = currentWorld?.w ?? 0;
        const H = currentWorld?.h ?? 0;
        const pw = W * TILE;
        const ph = H * TILE;
        const g = this.gridCtx;
        g.clearRect(0, 0, pw, ph);
        g.strokeStyle = "rgba(255,255,255,0.12)";
        g.lineWidth = 1;
        g.beginPath();
        for (let x = 0; x <= W; x++) {
            g.moveTo(x * TILE + 0.5, 0);
            g.lineTo(x * TILE + 0.5, ph);
        }
        for (let y = 0; y <= H; y++) {
            g.moveTo(0, y * TILE + 0.5);
            g.lineTo(pw, y * TILE + 0.5);
        }
        g.stroke();
    }

    private buildBackdropPattern(): void {
        const c = document.createElement("canvas");
        c.width = 64;
        c.height = 64;
        const cx = c.getContext("2d")!;
        cx.fillStyle = "#181c23";
        cx.fillRect(0, 0, 64, 64);
        cx.fillStyle = "#20252e";
        cx.fillRect(0, 0, 32, 32);
        cx.fillRect(32, 32, 32, 32);
        this.pattern = this.ctx.createPattern(c, "repeat");
    }

    requestRender(): void {
        if (this.renderQueued) return;
        this.renderQueued = true;
        requestAnimationFrame(() => {
            this.renderQueued = false;
            this.render();
        });
    }

    private render(): void {
        const w = currentWorld;
        this.ensureBackingStore();
        if (!w) return;
        this.weather?.ensure(this.worldPxW, this.worldPxH);

        const dpr = window.devicePixelRatio || 1;
        const cw = this.canvas.clientWidth;
        const ch = this.canvas.clientHeight;
        if (cw === 0 || ch === 0) return;
        if (this.canvas.width !== cw * dpr || this.canvas.height !== ch * dpr) {
            this.canvas.width = cw * dpr;
            this.canvas.height = ch * dpr;
        }
        const WORLD_PX_W = this.worldPxW;
        const WORLD_PX_H = this.worldPxH;
        const ctx = this.ctx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#0e1116";
        ctx.fillRect(0, 0, cw, ch);
        const { zoom, offX, offY } = this.vp;
        ctx.save();
        ctx.translate(-offX * zoom, -offY * zoom);
        ctx.scale(zoom, zoom);
        const weatherCanvas = this.weather && this.weather.currentId !== WEATHER_NONE ? this.weather.getCanvas() : null;
        if (weatherCanvas) {
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(weatherCanvas, 0, 0, WORLD_PX_W, WORLD_PX_H);
        } else if (this.pattern) {
            ctx.fillStyle = this.pattern;
            ctx.fillRect(0, 0, WORLD_PX_W, WORLD_PX_H);
        }
        ctx.drawImage(this.worldCanvas, 0, 0);
        if (this.showGrid && zoom >= 0.2) ctx.drawImage(this.gridCanvas, 0, 0);
        ctx.restore();

        ctx.strokeStyle = "#f2c94c";
        ctx.lineWidth = 2;
        ctx.strokeRect(-offX * zoom - 1, -offY * zoom - 1, WORLD_PX_W * zoom + 2, WORLD_PX_H * zoom + 2);

        if (this.selectedTile >= 0) {
            const sx = this.selectedTile % w.w;
            const sy = (this.selectedTile / w.w) | 0;
            if (sx < w.w && sy < w.h) {
                ctx.strokeStyle = "#4ea1ff";
                ctx.lineWidth = 2;
                ctx.strokeRect((sx * TILE - offX) * zoom, (sy * TILE - offY) * zoom, TILE * zoom, TILE * zoom);
            }
        }
        if (this.hover) {
            const size = Math.max(1, this.hover.size);
            const half = Math.floor((size - 1) / 2);
            const bx = this.hover.x - half;
            const by = this.hover.y - half;
            const hx = bx * TILE;
            const hy = by * TILE;
            const wd = size * TILE;
            if (this.hover.tool === "erase") {
                ctx.strokeStyle = "rgba(255,80,80,0.9)";
                ctx.lineWidth = 2;
                ctx.strokeRect((hx - offX) * zoom, (hy - offY) * zoom, wd * zoom, wd * zoom);
            } else if (this.hover.item) {
                ctx.fillStyle = "rgba(255,255,255,0.10)";
                ctx.fillRect((hx - offX) * zoom, (hy - offY) * zoom, wd * zoom, wd * zoom);
                ctx.globalAlpha = 0.55;
                this.drawItemAt(ctx, this.hover.item, (hx - offX) * zoom, (hy - offY) * zoom, wd * zoom);
                ctx.globalAlpha = 1;
                ctx.strokeStyle = "rgba(255,255,255,0.5)";
                ctx.lineWidth = 1;
                ctx.strokeRect((hx - offX) * zoom, (hy - offY) * zoom, wd * zoom, wd * zoom);
            } else {
                ctx.strokeStyle = "rgba(255,255,255,0.5)";
                ctx.lineWidth = 1;
                ctx.strokeRect((hx - offX) * zoom, (hy - offY) * zoom, wd * zoom, wd * zoom);
            }
        }
    }

    private drawItemAt(ctx: CanvasRenderingContext2D, item: ItemEntry, dx: number, dy: number, size: number): void {
        const crop = cropCache.get(item.id);
        if (crop) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(crop, dx, dy, size, size);
            return;
        }
        const url = atlasUrlFor(item.tex);
        if (url) {
            const atlas = findAtlas(url);
            if (atlas) {
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(atlas.canvas, item.tx * TILE, item.ty * TILE, TILE, TILE, dx, dy, size, size);
                return;
            }
            makeTileCanvas(item, url).then(() => this.requestRender());
        }
        ctx.fillStyle = `rgb(${item.color[0]},${item.color[1]},${item.color[2]})`;
        ctx.fillRect(dx, dy, size, size);
    }

    redrawTiles(indices: number[]): void {
        for (const i of indices) this.drawTile(i);
        this.requestRender();
    }

    redrawAll(world: World): void {
        this.ensureBackingStore();
        this.weather?.invalidate();
        this.worldCtx.clearRect(0, 0, this.worldPxW, this.worldPxH);
        this.pending.clear();
        for (let i = 0; i < world.tileCount; i++) this.drawTile(i);
        this.requestRender();
    }

    private drawTile(i: number): void {
        const w = currentWorld;
        if (!w || i >= w.tileCount) return;
        const x = (i % w.w) * TILE;
        const y = ((i / w.w) | 0) * TILE;
        const ctx = this.worldCtx;
        ctx.clearRect(x, y, TILE, TILE);
        if (this.showBg) {
            const bgId = w.bg[i];
            if (bgId) this.blitId(ctx, bgId, x, y, i);
        }
        if (this.showFg) {
            const fgId = w.fg[i];
            if (fgId) this.blitId(ctx, fgId, x, y, i);
        }
    }

    private blitId(ctx: CanvasRenderingContext2D, id: number, px: number, py: number, tileIdx: number): void {
        const item = itemById(id);
        if (!item) {
            ctx.fillStyle = "rgba(255,0,255,0.6)";
            ctx.fillRect(px, py, TILE, TILE);
            return;
        }
        const crop = cropCache.get(id);
        if (crop) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(crop, px, py);
            return;
        }
        const url = atlasUrlFor(item.tex);
        if (!url) {
            ctx.fillStyle = `rgb(${item.color[0]},${item.color[1]},${item.color[2]})`;
            ctx.fillRect(px, py, TILE, TILE);
            return;
        }
        const atlas = findAtlas(url);
        if (atlas) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(atlas.canvas, item.tx * TILE, item.ty * TILE, TILE, TILE, px, py, TILE, TILE);
            this.cacheCrop(item, atlas.canvas);
            return;
        }
        ctx.fillStyle = `rgb(${item.color[0]},${item.color[1]},${item.color[2]})`;
        ctx.fillRect(px, py, TILE, TILE);
        let set = this.pending.get(id);
        if (!set) {
            set = new Set();
            this.pending.set(id, set);
            makeTileCanvas(item, url).then(() => {
                const tiles = this.pending.get(id);
                this.pending.delete(id);
                if (tiles) {
                    for (const ti of tiles) this.drawTile(ti);
                    this.requestRender();
                }
            });
        }
        set.add(tileIdx);
    }

    private cacheCrop(item: ItemEntry, atlasCanvas: HTMLCanvasElement): void {
        if (cropCache.has(item.id)) return;
        const c = document.createElement("canvas");
        c.width = TILE;
        c.height = TILE;
        const cx = c.getContext("2d")!;
        cx.imageSmoothingEnabled = false;
        cx.drawImage(atlasCanvas, item.tx * TILE, item.ty * TILE, TILE, TILE, 0, 0, TILE, TILE);
        cropCache.set(item.id, c);
    }

    resolvePendingIds(ids: number[]): void {
        for (const id of ids) {
            const set = this.pending.get(id);
            if (!set) continue;
            this.pending.delete(id);
            for (const tileIdx of set) this.drawTile(tileIdx);
        }
        if (ids.length) this.requestRender();
    }

    clientToTile(clientX: number, clientY: number): { x: number; y: number; i: number } | null {
        const w = currentWorld;
        if (!w) return null;
        const rect = this.canvas.getBoundingClientRect();
        const wx = (clientX - rect.left) / this.vp.zoom + this.vp.offX;
        const wy = (clientY - rect.top) / this.vp.zoom + this.vp.offY;
        const tx = Math.floor(wx / TILE);
        const ty = Math.floor(wy / TILE);
        if (tx < 0 || tx >= w.w || ty < 0 || ty >= w.h) return null;
        return { x: tx, y: ty, i: ty * w.w + tx };
    }

    fitToScreen(): void {
        const cw = this.canvas.clientWidth;
        const ch = this.canvas.clientHeight;
        if (!cw || !ch) return;
        const zoom = Math.min(cw / this.worldPxW, ch / this.worldPxH) * 0.97;
        this.vp.zoom = zoom;
        this.vp.offX = -(cw / zoom - this.worldPxW) / 2;
        this.vp.offY = -(ch / zoom - this.worldPxH) / 2;
        this.requestRender();
    }

    zoomAt(factor: number, clientX: number, clientY: number): void {
        const rect = this.canvas.getBoundingClientRect();
        const cx = clientX - rect.left;
        const cy = clientY - rect.top;
        const oldZoom = this.vp.zoom;
        const wx = cx / oldZoom + this.vp.offX;
        const wy = cy / oldZoom + this.vp.offY;
        const newZoom = Math.min(4, Math.max(0.05, oldZoom * factor));
        this.vp.zoom = newZoom;
        this.vp.offX = wx - cx / newZoom;
        this.vp.offY = wy - cy / newZoom;
        this.requestRender();
    }

    panBy(dxScreen: number, dyScreen: number): void {
        this.vp.offX -= dxScreen / this.vp.zoom;
        this.vp.offY -= dyScreen / this.vp.zoom;
        this.requestRender();
    }

    setHover(h: HoverState | null): void {
        this.hover = h;
        this.requestRender();
    }

    setGrid(v: boolean): void {
        this.showGrid = v;
        this.requestRender();
    }

    setShowFg(v: boolean): void {
        this.showFg = v;
        this.redrawAll(currentWorld!);
    }

    setShowBg(v: boolean): void {
        this.showBg = v;
        this.redrawAll(currentWorld!);
    }

    setSelected(i: number): void {
        this.selectedTile = i;
        this.requestRender();
    }

    get zoomPercent(): number {
        return Math.round(this.vp.zoom * 100);
    }
}

let currentWorld: World | null = null;
export function bindWorld(w: World): void {
    currentWorld = w;
}
export function getBoundWorld(): World | null {
    return currentWorld;
}
