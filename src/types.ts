export interface ItemEntry {
    id: number;
    name: string;
    tex: string;
    tx: number;
    ty: number;
    layer: 0 | 1;
    rarity: number;
    color: [number, number, number];
}

export interface ItemsIndex {
    v: number;
    fields: string[];
    items: [number, string, string, number, number, number, number, [number, number, number]][];
}

export type AtlasIndex = Record<string, string>;

export type Tool = "place-fg" | "place-bg" | "erase" | "fill" | "pick";

export interface TileOp {
    i: number;
    l: 0 | 1;
    old: number;
    nw: number;
}
