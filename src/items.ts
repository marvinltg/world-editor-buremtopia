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

function subsequenceScore(nameLower: string, q: string): number {
    let qi = 0;
    for (let i = 0; i < nameLower.length && qi < q.length; i++) {
        if (nameLower[i] === q[qi]) qi++;
    }
    if (qi < q.length) return -1;
    return qi * 100 + q.length;
}

export function searchItems(query: string, limit = 400): ItemEntry[] {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, limit);
    if (/^\d+$/.test(q)) {
        const id = parseInt(q, 10);
        const exact = byId.get(id);
        if (exact) return [exact];
        return items.filter(i => String(i.id).startsWith(q)).slice(0, limit);
    }
    const scored: { it: ItemEntry; s: number }[] = [];
    for (const it of items) {
        const nl = it.name.toLowerCase();
        const idx = nl.indexOf(q);
        let s: number;
        if (idx === 0) s = 0;
        else if (idx > 0) s = 100 + idx;
        else {
            const wordIdx = nl.split(" ").findIndex(wl => wl.startsWith(q));
            if (wordIdx >= 0) s = 400 + wordIdx;
            else {
                const seq = subsequenceScore(nl, q);
                if (seq < 0) continue;
                s = 2000 + seq;
            }
        }
        scored.push({ it, s });
    }
    scored.sort((a, b) => a.s - b.s || a.it.id - b.it.id);
    return scored.slice(0, limit).map(x => x.it);
}
