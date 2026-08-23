import { findAtlas, getAtlas } from "./rttex";

export interface WeatherLayerDef {
    src: string;
    m: "tile" | "cover" | "hills";
    hp: number;
    a: number;
    iw: number;
    ih: number;
}

export interface WeatherDef {
    id: number;
    name: string;
    layers: WeatherLayerDef[];
}

export interface WeatherIndex {
    v: number;
    weathers: WeatherDef[];
}

export const WEATHER_NONE = -1;

let indexCache: WeatherIndex | null = null;
let indexInflight: Promise<WeatherIndex> | null = null;

export async function loadWeatherIndex(): Promise<WeatherIndex> {
    if (indexCache) return indexCache;
    if (!indexInflight) {
        indexInflight = (async () => {
            const res = await fetch("gen/weather_index.json");
            if (!res.ok) throw new Error("weather_index.json tidak ditemukan; jalankan `npm run gen` dulu");
            const idx: WeatherIndex = await res.json();
            indexCache = idx;
            return idx;
        })();
        indexInflight.catch(() => { indexInflight = null; });
    }
    return indexInflight;
}

export function getWeatherDefs(): WeatherDef[] {
    return indexCache?.weathers ?? [];
}

export function composeWeather(def: WeatherDef, w: number, h: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;

    for (const layer of def.layers) {
        const atlas = findAtlas(layer.src);
        if (!atlas) continue;
        ctx.globalAlpha = Math.min(1, Math.max(0, layer.a));
        if (layer.m === "tile") {
            const pat = ctx.createPattern(atlas.canvas, "repeat");
            if (pat) {
                ctx.fillStyle = pat;
                ctx.fillRect(0, 0, w, h);
            }
        } else if (layer.m === "cover") {
            const s = Math.max(w / atlas.width, h / atlas.height);
            const dw = atlas.width * s;
            const dh = atlas.height * s;
            ctx.drawImage(atlas.canvas, (w - dw) / 2, h - dh, dw, dh);
        } else {
            const dh = layer.hp > 0 ? layer.hp * h : atlas.height;
            const s = dh / atlas.height;
            const dw = atlas.width * s;
            for (let x = 0; x < w; x += dw) {
                ctx.drawImage(atlas.canvas, x, h - dh, dw, dh);
            }
        }
        ctx.globalAlpha = 1;
    }
    return c;
}

export class WeatherBackground {
    currentId = WEATHER_NONE;
    onChange: () => void = () => {};

    private canvas: HTMLCanvasElement | null = null;
    private builtKey = "";
    private buildingKey = "";

    setWeather(id: number): void {
        if (id === this.currentId) return;
        this.currentId = id;
        this.canvas = null;
        this.builtKey = "";
        this.onChange();
    }

    invalidate(): void {
        if (!this.canvas) return;
        this.canvas = null;
        this.builtKey = "";
        this.onChange();
    }

    ensure(width: number, height: number): void {
        if (this.currentId === WEATHER_NONE) return;
        const key = `${this.currentId}:${width}x${height}`;
        if (key === this.builtKey || key === this.buildingKey) return;
        const def = getWeatherDefs().find(d => d.id === this.currentId);
        if (!def) return;
        this.buildingKey = key;
        void Promise.all(def.layers.map(l => getAtlas(l.src))).then(atlases => {
            if (atlases.some(a => !a)) {
                console.warn("weather: ada layer gagal dimuat", def.name);
            }
            if (this.buildingKey !== key) return;
            this.canvas = composeWeather(def, width, height);
            this.builtKey = key;
            this.buildingKey = "";
            this.onChange();
        });
    }

    getCanvas(): HTMLCanvasElement | null {
        return this.canvas;
    }
}
