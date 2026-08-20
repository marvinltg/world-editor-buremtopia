import type { ItemEntry } from "./types";

export interface Atlas {
    url: string;
    canvas: HTMLCanvasElement;
    width: number;
    height: number;
}

const MAX_ATLASES = 8;
const atlasCache = new Map<string, Atlas>();
const inflight = new Map<string, Promise<Atlas | null>>();
export const cropCache = new Map<number, HTMLCanvasElement>();
const failed = new Set<string>();

export async function decodeRttexAsync(buf: ArrayBuffer): Promise<{ w: number; h: number; px: Uint8Array }> {
    const bytes = new Uint8Array(buf);
    const magic = String.fromCharCode(...bytes.subarray(0, 6));
    if (magic !== "RTPACK") throw new Error("file bukan RTPACK");
    const ds = new DecompressionStream("deflate");
    const stream = new Blob([bytes.slice(32)] as BlobPart[]).stream().pipeThrough(ds);
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    const tag = String.fromCharCode(...out.subarray(0, 4));
    if (tag !== "RTTX") throw new Error("payload bukan RTTX");
    const dv = new DataView(out.buffer);
    const w = dv.getUint32(8, true);
    const h = dv.getUint32(12, true);
    const px = out.subarray(124, 124 + w * h * 4);
    if (px.length !== w * h * 4) throw new Error("data pixel terpotong");
    return { w, h, px };
}

function makeAtlasCanvas(w: number, h: number, px: Uint8Array): HTMLCanvasElement {
    // buffer RTTEX tersimpan bottom-up (origin OpenGL kiri-bawah),
    // flip vertikal sekali di sini supaya item bisa dipakai dengan (tx*32, ty*32) langsung.
    const src = document.createElement("canvas");
    src.width = w;
    src.height = h;
    const sctx = src.getContext("2d")!;
    const img = sctx.createImageData(w, h);
    img.data.set(px);
    sctx.putImageData(img, 0, 0);

    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const octx = out.getContext("2d")!;
    octx.imageSmoothingEnabled = false;
    octx.translate(0, h);
    octx.scale(1, -1);
    octx.drawImage(src, 0, 0);
    octx.setTransform(1, 0, 0, 1, 0, 0);
    return out;
}

export async function getAtlas(url: string): Promise<Atlas | null> {
    if (failed.has(url)) return null;
    const cached = atlasCache.get(url);
    if (cached) {
        atlasCache.delete(url);
        atlasCache.set(url, cached);
        return cached;
    }
    let p = inflight.get(url);
    if (!p) {
        p = (async () => {
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const buf = await res.arrayBuffer();
                const { w, h, px } = await decodeRttexAsync(buf);
                const atlas: Atlas = { url, canvas: makeAtlasCanvas(w, h, px), width: w, height: h };
                return atlas;
            } catch (e) {
                console.warn("gagal decode atlas", url, e);
                failed.add(url);
                return null;
            } finally {
                inflight.delete(url);
            }
        })();
        inflight.set(url, p);
    }
    const atlas = await p;
    if (atlas) {
        atlasCache.set(url, atlas);
        while (atlasCache.size > MAX_ATLASES) {
            const oldest = atlasCache.keys().next().value as string;
            atlasCache.delete(oldest);
        }
    }
    return atlas;
}

export function findAtlas(url: string): Atlas | undefined {
    return atlasCache.get(url);
}

export async function makeTileCanvas(item: ItemEntry, atlasUrl: string): Promise<HTMLCanvasElement> {
    const key = item.id;
    const hit = cropCache.get(key);
    if (hit) return hit;
    const atlas = await getAtlas(atlasUrl);
    if (!atlas) {
        const c = placeholderCanvas(item.color);
        cropCache.set(key, c);
        return c;
    }
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    try {
        ctx.drawImage(atlas.canvas, item.tx * 32, item.ty * 32, 32, 32, 0, 0, 32, 32);
    } catch {
        return placeholderCanvas(item.color);
    }
    cropCache.set(key, c);
    return c;
}

export function placeholderCanvas(color: [number, number, number]): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
    ctx.fillRect(0, 0, 32, 32);
    return c;
}
