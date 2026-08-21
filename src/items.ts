import type { AtlasIndex, ItemEntry, ItemsIndex } from "./types";

let items: ItemEntry[] = [];
let byId = new Map<number, ItemEntry>();
let atlasIndex: AtlasIndex = {};
let ready = false;

export interface LoadedItems {
    items: ItemEntry[];
    atlasIndex: AtlasIndex;
}

export async function loadItems(progress?: (msg: string) => void): Promise<LoadedItems> {
    progress?.("Mengunduh index item...");
    const [itemsRes, atlasRes] = await Promise.all([
        fetch("gen/items_index.json"),
        fetch("gen/atlas_index.json")
    ]);
    if (!itemsRes.ok || !atlasRes.ok) throw new Error("index item tidak ditemukan; jalankan `npm run gen` dulu");
    const idx: ItemsIndex = await itemsRes.json();
    atlasIndex = await atlasRes.json();

    items = idx.items.map(row => ({
        id: row[0],
        name: row[1],
        tex: row[2],
        tx: row[3],
        ty: row[4],
        layer: (row[5] ? 1 : 0) as 0 | 1,
        rarity: row[6],
        color: row[7]
    }));
    byId = new Map(items.map(i => [i.id, i]));
    ready = true;
    return { items, atlasIndex };
}

export function atlasUrlFor(tex: string): string | undefined {
    return atlasIndex[tex];
}

export function itemById(id: number): ItemEntry | undefined {
    return byId.get(id);
}

export function isReady(): boolean {
    return ready;
}

export function searchItems(query: string, limit = 400): ItemEntry[] {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, limit);
    if (q.length < 2) return [];
    if (/^\d+$/.test(q)) {
        const id = parseInt(q, 10);
        const exact = byId.get(id);
        if (exact) return [exact];
        return items.filter(i => String(i.id).startsWith(q)).slice(0, limit);
    }
    // Partial match: name contains query
    return items.filter(it => it.name.toLowerCase().includes(q)).slice(0, limit);
}
