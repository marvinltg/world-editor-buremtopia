import { World, MAX_WORLD_W, MAX_WORLD_H } from "./world";
import { WorldRenderer, bindWorld } from "./renderer";
import { loadItems, atlasUrlFor, itemById } from "./items";
import { makeTileCanvas } from "./rttex";
import { ItemBrowser } from "./ui";
import { exportWorld, parseWorld, validateName, exportLuaScriptWorld, importLuaScriptWorld } from "./serialize";
import type { ItemEntry, Tool } from "./types";

const root = document.getElementById("app")!;
const world = new World();
bindWorld(world);

const renderer = new WorldRenderer(root.querySelector<HTMLCanvasElement>("#world-canvas")!);
world.onChange((indices, full) => {
    if (full) renderer.redrawAll(world);
    else renderer.redrawTiles(indices);
    updateButtons();
});

function hasUnsavedChanges(): boolean {
    if (world.undoDepth > 0 || world.redoDepth > 0) return true;
    for (let i = 0; i < world.tileCount; i++) {
        if (world.fg[i] !== 0 || world.bg[i] !== 0) return true;
    }
    return false;
}

window.addEventListener("beforeunload", (e) => {
    if (hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = "";
    }
});

const statusEl = root.querySelector<HTMLElement>("#status-msg")!;
let statusTimer: number | null = null;
function status(msg: string, error = false): void {
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", error);
    if (statusTimer !== null) window.clearTimeout(statusTimer);
    if (msg) statusTimer = window.setTimeout(() => { statusEl.textContent = ""; }, 5000);
}

const toastEl = root.querySelector<HTMLElement>("#canvas-toast")!;
let toastTimer: number | null = null;
function toast(msg: string): void {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 1800);
}
let lastFail = "";
let lastFailAt = 0;
function fail(msg: string): void {
    status(msg, true);
    const now = Date.now();
    if (msg !== lastFail || now - lastFailAt > 1500) {
        toast(msg);
        lastFail = msg;
        lastFailAt = now;
    }
}

let tool: Tool = "place-fg";
let selected: ItemEntry | null = null;
let brushSize = 1;
let placedItems: Map<number, Set<number>> = new Map(); // tileIdx -> Set of itemIds placed there
const brushInput = document.getElementById("brush-size") as HTMLInputElement;
const brushVal = document.getElementById("brush-val")!;
brushInput.addEventListener("input", () => {
    let v = parseInt(brushInput.value, 10);
    if (!Number.isFinite(v)) v = 1;
    brushSize = Math.min(16, Math.max(1, v));
    brushVal.textContent = String(brushSize);
    renderer.requestRender();
});

const selCanvas = root.querySelector<HTMLCanvasElement>("#selected-item canvas")!;
const selName = root.querySelector<HTMLElement>("#sel-name")!;
const selId = root.querySelector<HTMLElement>("#sel-id")!;
const zoomLabel = root.querySelector<HTMLElement>("#zoom-label")!;
const nameInput = root.querySelector<HTMLInputElement>("#world-name")!;
const undoBtn = root.querySelector<HTMLButtonElement>("#btn-undo")!;
const redoBtn = root.querySelector<HTMLButtonElement>("#btn-redo")!;
const eraseFgChk = root.querySelector<HTMLInputElement>("#erase-fg")!;
const eraseBgChk = root.querySelector<HTMLInputElement>("#erase-bg")!;
const eraseOptions = root.querySelector<HTMLElement>("#erase-options")!;
const lockTilesChk = root.querySelector<HTMLInputElement>("#chk-lock-tiles")!;
const showFgChk = root.querySelector<HTMLInputElement>("#chk-show-fg")!;
const showBgChk = root.querySelector<HTMLInputElement>("#chk-show-bg")!;

function updateButtons(): void {
    undoBtn.disabled = world.undoDepth === 0;
    redoBtn.disabled = world.redoDepth === 0;
    zoomLabel.textContent = `${renderer.zoomPercent}%`;
}

interface UsedItemInfo {
    item: ItemEntry;
    count: number;
    layers: Set<0 | 1>;
}

function getUsedItemsWithCounts(): UsedItemInfo[] {
    const counts = new Map<number, { count: number; layers: Set<0 | 1> }>();
    
    for (let i = 0; i < world.tileCount; i++) {
        const fgId = world.fg[i];
        const bgId = world.bg[i];
        
        if (fgId !== 0) {
            const entry = counts.get(fgId) || { count: 0, layers: new Set<0 | 1>() };
            entry.count++;
            entry.layers.add(0);
            counts.set(fgId, entry);
        }
        if (bgId !== 0) {
            const entry = counts.get(bgId) || { count: 0, layers: new Set<0 | 1>() };
            entry.count++;
            entry.layers.add(1);
            counts.set(bgId, entry);
        }
    }
    
    const result: UsedItemInfo[] = [];
    for (const [id, data] of counts) {
        const item = itemById(id);
        if (item) {
            result.push({ item, count: data.count, layers: data.layers });
        }
    }
    
    result.sort((a, b) => b.count - a.count);
    return result;
}

function getUsedItems(): Map<number, ItemEntry> {
    const used = new Map<number, ItemEntry>();
    for (const info of getUsedItemsWithCounts()) {
        used.set(info.item.id, info.item);
    }
    return used;
}

async function renderItemThumb(item: ItemEntry, size: number): Promise<HTMLCanvasElement> {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const bg = `rgb(${item.color[0]},${item.color[1]},${item.color[2]})`;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
    const url = atlasUrlFor(item.tex);
    if (url) {
        try {
            const tile = await makeTileCanvas(item, url);
            ctx.clearRect(0, 0, size, size);
            ctx.drawImage(tile, 0, 0, size, size);
        } catch { /* keep placeholder */ }
    }
    return canvas;
}

async function selectItem(item: ItemEntry): Promise<void> {
    selected = item;
    selName.textContent = item.name;
    selId.textContent = `ID ${item.id} · ${item.layer === 1 ? "Background" : "Foreground"}`;
    const url = atlasUrlFor(item.tex);
    const ctx = selCanvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 32, 32);
    if (!url) {
        ctx.fillStyle = `rgb(${item.color[0]},${item.color[1]},${item.color[2]})`;
        ctx.fillRect(0, 0, 32, 32);
        return;
    }
    const tile = await makeTileCanvas(item, url);
    ctx.clearRect(0, 0, 32, 32);
    ctx.drawImage(tile, 0, 0);
    if (tool === "erase" || tool === "pick") setTool(item.layer === 1 ? "place-bg" : "place-fg");
    renderer.requestRender();
}

const browser = new ItemBrowser(root as HTMLElement, item => { void selectItem(item); });

function setTool(t: Tool): void {
    tool = t;
    for (const btn of root.querySelectorAll<HTMLElement>(".tool")) {
        btn.classList.toggle("active", btn.dataset.tool === t);
    }
    eraseOptions.style.display = t === "erase" ? "flex" : "none";
}

for (const btn of root.querySelectorAll<HTMLElement>(".tool")) {
    btn.addEventListener("click", () => setTool(btn.dataset.tool as Tool));
}

root.querySelector("#btn-undo")!.addEventListener("click", () => { if (world.undo()) world.flushEmit(); });
root.querySelector("#btn-redo")!.addEventListener("click", () => { if (world.redo()) world.flushEmit(); });
root.querySelector("#chk-grid")!.addEventListener("change", e => {
    renderer.setGrid((e.target as HTMLInputElement).checked);
});

showFgChk.addEventListener("change", e => {
    renderer.setShowFg((e.target as HTMLInputElement).checked);
});

showBgChk.addEventListener("change", e => {
    renderer.setShowBg((e.target as HTMLInputElement).checked);
});

const sizeWInput = root.querySelector<HTMLInputElement>("#world-w")!;
const sizeHInput = root.querySelector<HTMLInputElement>("#world-h")!;
const btnResize = root.querySelector<HTMLButtonElement>("#btn-resize")!;
const tpSize = root.querySelector<HTMLElement>("#tp-size")!;
const tpTiles = root.querySelector<HTMLElement>("#tp-tiles")!;

function updateWorldInfo(): void {
    tpSize.textContent = `${world.w} × ${world.h}`;
    tpTiles.textContent = String(world.tileCount);
    sizeWInput.value = String(world.w);
    sizeHInput.value = String(world.h);
}

function applySize(): void {
    const nw = parseInt(sizeWInput.value, 10);
    const nh = parseInt(sizeHInput.value, 10);
    const cw = Number.isFinite(nw) ? Math.min(MAX_WORLD_W, Math.max(1, nw)) : world.w;
    const chh = Number.isFinite(nh) ? Math.min(MAX_WORLD_H, Math.max(1, nh)) : world.h;
    if (cw === world.w && chh === world.h) {
        updateWorldInfo();
        return;
    }
    if (hasUnsavedChanges() && !confirm(`Ubah ukuran world ke ${cw}x${chh}? Isi di luar area baru & undo/redo akan hilang.`)) {
        updateWorldInfo();
        return;
    }
    const changed = world.resize(cw, chh);
    placedItems.clear();
    if (!changed) return;
    if (bedrockChk.checked) applyBedrock(true, false);
    updateWorldInfo();
    renderer.fitToScreen();
    status(`Ukuran world: ${world.w} x ${world.h} (${world.tileCount} tile)`);
}

btnResize.addEventListener("click", applySize);

// Bedrock
const bedrockChk = root.querySelector<HTMLInputElement>("#chk-bedrock")!;

function bedrockTopY(): number {
    return Math.max(1, world.h - 7);
}

function applyBedrock(on: boolean, recordUndo: boolean): number {
    const topY = bedrockTopY();
    if (recordUndo) world.beginOp();
    let changed = 0;
    for (let y = topY; y < world.h; y++) {
        for (let x = 0; x < world.w; x++) {
            const i = y * world.w + x;
            if (on) {
                world.setLocked(i, true);
                if (world.fg[i] !== 0 && world.fg[i] !== 8) continue;
                if (world.fg[i] === 8) continue;
                world.setTile(i, 0, 8);
                changed++;
            } else {
                world.setLocked(i, false);
                if (world.fg[i] !== 8) continue;
                world.setTile(i, 0, 0);
                changed++;
            }
        }
    }
    if (recordUndo) {
        if (!world.endOp()) changed = 0;
    }
    world.flushEmit();
    return changed;
}

bedrockChk.addEventListener("change", () => {
    const topY = bedrockTopY();
    const changed = applyBedrock(bedrockChk.checked, true);
    status(bedrockChk.checked ? `Bedrock default dipasang (${changed} tile, y ${topY}-${world.h - 1})` : "Bedrock default dihapus");
});
root.querySelector("#btn-fit")!.addEventListener("click", () => { renderer.fitToScreen(); updateButtons(); });
root.querySelector("#btn-clear")!.addEventListener("click", () => {
    if (!confirm("Hapus semua tile?")) return;
    world.clear();
    status("World dibersihkan");
});

const exportBtn = root.querySelector("#btn-export")!;
exportBtn.addEventListener("click", () => {
    const name = nameInput.value.trim().toUpperCase();
    const err = validateName(name);
    if (err) { status(err, true); nameInput.focus(); return; }
    try {
        const { blob, filename } = exportWorld(
            { name, w: world.w, h: world.h, fg: world.fg, bg: world.bg, extra: world.extra },
            { worldName: name }
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        status(`Exported ${filename} (${(blob.size / 1024).toFixed(1)} KB, ${world.w}x${world.h}, ${world.tileCount} tile)`);
    } catch (e) {
        status((e as Error).message, true);
    }
});

// Lua-script world export button and file input
const luaExportBtn = root.querySelector<HTMLButtonElement>("#btn-lua-export")!;
const luaFileInput = root.querySelector<HTMLInputElement>("#lua-file-input")!;
luaExportBtn.addEventListener("click", () => {
    luaFileInput.click();
});
luaFileInput.addEventListener("change", async () => {
    const file = luaFileInput.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".txt")) {
        status("File harus berekstensi .txt", true);
        luaFileInput.value = "";
        return;
    }
    try {
        const text = await file.text();
        const content = exportLuaScriptWorld(world);
        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${world.name}_${world.w}x${world.h}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        status(`Exported ${a.download} (${(blob.size / 1024).toFixed(1)} KB)`);
    } catch (e) {
        status((e as Error).message, true);
    }
    luaFileInput.value = "";
});

// Lua-script world import button and file input
const luaImportBtn = root.querySelector<HTMLButtonElement>("#btn-lua-import")!;
const luaImportFileInput = root.querySelector<HTMLInputElement>("#lua-import-file")!;
luaImportBtn.addEventListener("click", () => {
    luaImportFileInput.click();
});
luaImportFileInput.addEventListener("change", async () => {
    const file = luaImportFileInput.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".txt")) {
        status("File harus berekstensi .txt", true);
        luaImportFileInput.value = "";
        return;
    }
    try {
        const text = await file.text();
        const state = importLuaScriptWorld(text);
        world.replaceWhole(state.fg, state.bg, state.extra, state.name || "IMPORTED", state.w, state.h);
        placedItems.clear();
        if (bedrockChk.checked) applyBedrock(true, false);
        const fromFile = file.name.replace(/_?\.txt$/i, "");
        if (/^[A-Za-z0-9_-]+$/.test(fromFile) && fromFile.length <= 24) nameInput.value = fromFile.toUpperCase();
        updateWorldInfo();
        renderer.fitToScreen();
        status(`Imported ${file.name}: ${state.w}x${state.h}, ${world.tileCount} tile`);
    } catch (e) {
        status((e as Error).message, true);
    }
    luaImportFileInput.value = "";
});

// JPG export functionality
const jpgExportBtn = root.querySelector<HTMLButtonElement>("#btn-jpg-export")!;
jpgExportBtn.addEventListener("click", () => {
    // Render world to canvas if needed
    renderer.requestRender();
    // Wait a frame for rendering to complete
    setTimeout(() => {
        const canvas = renderer.canvas;
        if (!canvas || canvas.width === 0 || canvas.height === 0) {
            status("Gagal: canvas tidak valid", true);
            return;
        }
        // Convert to JPEG
        const dataURL = canvas.toDataURL("image/jpeg", 0.92);
        const link = document.createElement("a");
        link.href = dataURL;
        link.download = `${world.name}_${world.w}x${world.h}.jpg`;
        link.click();
        URL.revokeObjectURL(dataURL);
        status(`Exported JPG: ${world.w}x${world.h} (${((dataURL.length - 22) / 1024).toFixed(1)} KB)`);
    }, 100);
});

const importInput = root.querySelector<HTMLInputElement>("#file-import")!;
root.querySelector("#btn-import")!.addEventListener("click", () => importInput.click());
importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    importInput.value = "";
    if (!file) return;
    try {
        const text = await file.text();
        const { state, stats } = parseWorld(text);
        world.replaceWhole(state.fg, state.bg, state.extra, state.name || file.name.replace(/_?\.json$/i, "").toUpperCase(), state.w, state.h);
        placedItems.clear();
        if (bedrockChk.checked) applyBedrock(true, false);
        const fromFile = file.name.replace(/_?\.json$/i, "");
        if (/^[A-Za-z0-9_-]+$/.test(fromFile) && fromFile.length <= 24) nameInput.value = fromFile.toUpperCase();
        updateWorldInfo();
        renderer.fitToScreen();
        status(`Imported ${file.name}: ${stats.w}x${stats.h}, ${stats.fgCount} fg, ${stats.bgCount} bg, ${stats.extraCount} extra`);
    } catch (e) {
        status((e as Error).message, true);
    }
});

const canvas = renderer.canvas;
let spaceDown = false;
let panning = false;
let painting = false;
let lastPan: { x: number; y: number } | null = null;
let hoverTile: { x: number; y: number; i: number } | null = null;
let lastPainted = -1;

const tpX = root.querySelector<HTMLElement>("#tp-x")!;
const tpY = root.querySelector<HTMLElement>("#tp-y")!;
const tpFg = root.querySelector<HTMLElement>("#tp-fg")!;
const tpBg = root.querySelector<HTMLElement>("#tp-bg")!;
const tpIdx = root.querySelector<HTMLElement>("#tp-idx")!;

function describeId(id: number): string {
    if (!id) return "-";
    const it = itemById(id);
    return it ? `${it.name} (${id})` : `? (${id})`;
}

function updateTileInfo(i: number | null): void {
    if (i === null || i < 0) {
        tpX.textContent = tpY.textContent = tpFg.textContent = tpBg.textContent = tpIdx.textContent = "-";
        return;
    }
    tpX.textContent = String(i % world.w);
    tpY.textContent = String((i / world.w) | 0);
    tpFg.textContent = describeId(world.fg[i]);
    tpBg.textContent = describeId(world.bg[i]);
    tpIdx.textContent = String(i);
}

function forEachBrushTile(i: number, fn: (idx: number) => void): void {
    if (brushSize <= 1) {
        fn(i);
        return;
    }
    const half = Math.floor((brushSize - 1) / 2);
    const cx = i % world.w;
    const cy = (i / world.w) | 0;
    for (let dy = -half; dy < brushSize - half; dy++) {
        for (let dx = -half; dx < brushSize - half; dx++) {
            const x = cx + dx;
            const y = cy + dy;
            if (x < 0 || x >= world.w || y < 0 || y >= world.h) continue;
            fn(y * world.w + x);
        }
    }
}

function applyTool(i: number): void {
    if (world.isLocked(i)) {
        fail(`Tile (${i % world.w}, ${(i / world.w) | 0}) terkunci: bedrock default aktif, matikan toggle Bedrock untuk mengubahnya`);
        return;
    }
    const lockTiles = lockTilesChk?.checked ?? false;
    
    if (tool === "place-fg" || tool === "place-bg") {
        if (!selected) { status("Pilih item dulu", true); return; }
        const item = selected;
        const layer = tool === "place-bg" ? 1 : 0;
        if (item.layer !== layer) {
            fail(`${item.name} adalah item ${item.layer === 1 ? "background" : "foreground"} — pakai tool ${item.layer === 1 ? "BG" : "FG"}`);
            return;
        }
        let changed = false;
        forEachBrushTile(i, idx => {
            // Lock tiles: prevent overwriting existing content on same layer
            if (lockTiles) {
                const hasFg = world.fg[idx] !== 0;
                const hasBg = world.bg[idx] !== 0;
                if (layer === 0 && hasFg) return; // FG exists, can't place FG
                if (layer === 1 && hasBg) return; // BG exists, can't place BG
            }
            if (world.paint(idx, "place", layer, item.id)) changed = true;
            if (!placedItems.has(idx)) placedItems.set(idx, new Set());
            placedItems.get(idx)!.add(item.id);
        });
        if (changed) lastPainted = i;
    } else if (tool === "erase") {
        const eraseFg = eraseFgChk?.checked ?? true;
        const eraseBg = eraseBgChk?.checked ?? true;
        if (!eraseFg && !eraseBg) return;
        
        let changed = false;
        forEachBrushTile(i, idx => {
            if (eraseFg && world.fg[idx] !== 0) {
                world.setTile(idx, 0, 0);
                changed = true;
            }
            if (eraseBg && world.bg[idx] !== 0) {
                world.setTile(idx, 1, 0);
                changed = true;
            }
            if (changed && placedItems.has(idx)) {
                const remaining = new Set<number>();
                if (eraseFg === false && world.fg[idx] !== 0) {
                    // Keep FG items
                    for (const id of placedItems.get(idx)!) {
                        const it = itemById(id);
                        if (it && it.layer === 0) remaining.add(id);
                    }
                }
                if (eraseBg === false && world.bg[idx] !== 0) {
                    // Keep BG items
                    for (const id of placedItems.get(idx)!) {
                        const it = itemById(id);
                        if (it && it.layer === 1) remaining.add(id);
                    }
                }
                if (remaining.size > 0) placedItems.set(idx, remaining);
                else placedItems.delete(idx);
            } else if (changed) {
                placedItems.delete(idx);
            }
        });
        if (changed) lastPainted = i;
    } else if (tool === "pick") {
        const fgId = world.fg[i];
        const bgId = world.bg[i];
        const target = fgId || bgId;
        if (!target) { fail("Tile kosong, tidak ada item untuk dipilih"); return; }
        const item = itemById(target);
        if (item) {
            void selectItem(item);
            browser.markSelected(item.id);
            setTool(item.layer === 1 ? "place-bg" : "place-fg");
            status(`Dipilih: ${item.name}`);
        }
    }
}

canvas.addEventListener("pointerdown", e => {
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || spaceDown) {
        panning = true;
        lastPan = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = "grabbing";
        return;
    }
    if (e.button !== 0) return;
    const t = renderer.clientToTile(e.clientX, e.clientY);
    if (!t) return;
    if (tool === "fill") {
        if (!selected) { fail("Pilih item dulu"); return; }
        const layer = selected.layer;
        if (world.isLocked(t.i)) {
            fail(`Tile (${t.x}, ${t.y}) terkunci: bedrock default aktif, matikan toggle Bedrock untuk mengubahnya`);
            return;
        }
        world.beginOp();
        world.fill(t.i, layer, selected.id);
        world.endOp();
        world.flushEmit();
        return;
    }
    if (tool === "pick") {
        renderer.setSelected(t.i);
        updateTileInfo(t.i);
        applyTool(t.i);
        return;
    }
    painting = true;
    lastPainted = -1;
    renderer.setSelected(t.i);
    updateTileInfo(t.i);
    world.beginOp();
    applyTool(t.i);
});

canvas.addEventListener("pointermove", e => {
    if (panning && lastPan) {
        renderer.panBy(e.clientX - lastPan.x, e.clientY - lastPan.y);
        lastPan = { x: e.clientX, y: e.clientY };
        updateButtons();
        return;
    }
    const t = renderer.clientToTile(e.clientX, e.clientY);
    hoverTile = t;
    updateTileInfo(t ? t.i : null);
    renderer.setHover(
        t
            ? {
                  x: t.x,
                  y: t.y,
                  item: tool === "place-fg" || tool === "place-bg" ? selected : null,
                  tool,
                  size: brushSize
              }
            : null
    );
    if (painting && t && t.i !== lastPainted) {
        applyTool(t.i);
    }
});

function endStroke(): void {
    if (painting) {
        painting = false;
        world.endOp();
        world.flushEmit();
    }
    if (panning) {
        panning = false;
        lastPan = null;
        canvas.style.cursor = "default";
    }
}
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointerleave", () => {
    renderer.setHover(null);
    endStroke();
});

canvas.addEventListener(
    "wheel",
    e => {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0015);
        renderer.zoomAt(factor, e.clientX, e.clientY);
        updateButtons();
    },
    { passive: false }
);

window.addEventListener("keydown", e => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === "Space") {
        spaceDown = true;
        canvas.style.cursor = "grab";
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) { if (world.redo()) world.flushEmit(); }
        else if (world.undo()) world.flushEmit();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        if (world.redo()) world.flushEmit();
        return;
    }
    const map: Record<string, Tool> = { b: "place-fg", v: "place-bg", e: "erase", f: "fill", i: "pick" };
    const t = map[e.key.toLowerCase()];
    if (t) setTool(t);
    if (e.key === "0") { renderer.fitToScreen(); updateButtons(); }
});
window.addEventListener("keyup", e => {
    if (e.code === "Space") {
        spaceDown = false;
        if (!panning) canvas.style.cursor = "default";
    }
});

async function boot(): Promise<void> {
    try {
        browser.setStatus("Mengunduh index item...");
        const [{ items }] = await Promise.all([
            loadItems(m => browser.setStatus(m)),
        ]);
        browser.setStats(items.length);
        browser.search("");
        applyBedrock(true, false);
        updateWorldInfo();
        renderer.fitToScreen();
        updateButtons();
        const dirt = itemById(2);
        if (dirt) void selectItem(dirt);
        status(`Siap: ${items.length} item placeable, world ${world.w}x${world.h} (maks ${MAX_WORLD_W}x${MAX_WORLD_H}), bedrock y ${bedrockTopY()}-${world.h - 1}`);
    } catch (e) {
        browser.setStatus("Gagal memuat: " + (e as Error).message);
        status((e as Error).message, true);
    }
}

void boot();