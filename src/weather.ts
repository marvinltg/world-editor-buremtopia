// Minimal empty weather module to avoid import errors
export const WEATHER_NONE = -1;

export async function loadWeatherIndex(): Promise<{ v: number; weathers: any[] }> {
    return { v: 1, weathers: [] };
}

export function getWeatherDefs(): any[] {
    return [];
}

export function composeWeather(def: any, w: number, h: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
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
        // no-op
    }

    getCanvas(): HTMLCanvasElement | null {
        return null;
    }
}