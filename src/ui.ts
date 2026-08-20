import type { ItemEntry } from "./types";
import { atlasUrlFor, searchItems } from "./items";
import { makeTileCanvas } from "./rttex";

const PAGE_SIZE = 120;

export class ItemBrowser {
    private listEl: HTMLElement;
    private statusEl: HTMLElement;
    private statsEl: HTMLElement;
    private searchEl: HTMLInputElement;
    private results: ItemEntry[] = [];
    private renderedCount = 0;
    private renderedIds = new Set<number>();
    private observer: IntersectionObserver;
    private debouncer: number | null = null;
    private sentinel: HTMLElement;
    onSelect: ((item: ItemEntry) => void) | null = null;

    constructor(root: HTMLElement, onSelect: (item: ItemEntry) => void) {
        this.listEl = root.querySelector("#item-list")!;
        this.statusEl = root.querySelector("#item-status")!;
        this.statsEl = root.querySelector("#item-stats")!;
        this.searchEl = root.querySelector("#item-search")!;
        this.onSelect = onSelect;

        this.sentinel = document.createElement("div");
        this.sentinel.className = "sentinel";
        this.sentinel.textContent = "Memuat...";

        this.observer = new IntersectionObserver(
            entries => {
                for (const e of entries) {
                    if (!e.isIntersecting) continue;
                    const el = e.target as HTMLElement;
                    if (el === this.sentinel) {
                        this.renderMore();
                        continue;
                    }
                    const id = Number(el.dataset.itemId);
                    this.loadThumb(el, id);
                }
            },
            { root: this.listEl, rootMargin: "300px", threshold: 0 }
        );

        this.searchEl.addEventListener("input", () => {
            if (this.debouncer !== null) window.clearTimeout(this.debouncer);
            this.debouncer = window.setTimeout(() => {
                this.debouncer = null;
                this.search(this.searchEl.value);
            }, 120);
        });
    }

    setStatus(msg: string): void {
        this.statusEl.textContent = msg;
        this.statusEl.hidden = msg === "";
    }

    setStats(total: number): void {
        this.statsEl.textContent = `${total} item placeable`;
    }

    search(query: string): void {
        const q = query.trim();
        if (q.length === 1) {
            this.setStatus("Ketik minimal 2 karakter");
            return;
        }
        this.results = searchItems(q);
        this.renderedCount = 0;
        this.renderedIds.clear();
        this.observer.disconnect();
        this.listEl.innerHTML = "";
        if (this.results.length === 0) {
            this.setStatus(`Tidak ada item untuk "${q}"`);
            return;
        }
        this.setStatus("");
        this.renderMore();
    }

    private renderMore(): void {
        const start = this.renderedCount;
        const end = Math.min(start + PAGE_SIZE, this.results.length);
        if (start >= end) {
            this.sentinel.textContent = "";
            return;
        }
        const frag = document.createDocumentFragment();
        for (let k = start; k < end; k++) {
            const it = this.results[k];
            const card = document.createElement("div");
            card.className = "item-card";
            card.dataset.itemId = String(it.id);
            card.title = `${it.name} (ID ${it.id})`;

            const thumbWrap = document.createElement("div");
            thumbWrap.className = "thumb";
            thumbWrap.dataset.itemId = String(it.id);
            thumbWrap.style.background = `rgb(${it.color[0]},${it.color[1]},${it.color[2]})`;
            const cv = document.createElement("canvas");
            cv.width = 32;
            cv.height = 32;
            thumbWrap.appendChild(cv);

            const meta = document.createElement("div");
            meta.className = "meta";
            const nm = document.createElement("div");
            nm.className = "name";
            nm.textContent = it.name;
            const idRow = document.createElement("div");
            idRow.className = "id";
            const tag = it.layer === 1 ? "BG" : "FG";
            idRow.textContent = `${it.id} · ${tag}`;
            meta.appendChild(nm);
            meta.appendChild(idRow);

            card.appendChild(thumbWrap);
            card.appendChild(meta);
            card.addEventListener("click", () => {
                this.onSelect?.(it);
                this.markSelected(it.id);
            });
            this.observer.observe(thumbWrap);
            frag.appendChild(card);
        }
        this.sentinel.textContent = "";
        frag.appendChild(this.sentinel);
        this.listEl.appendChild(frag);
        this.renderedCount = end;
        if (end < this.results.length) {
            this.sentinel.textContent = "Memuat...";
            this.observer.observe(this.sentinel);
        }
    }

    private async loadThumb(el: HTMLElement, id: number): Promise<void> {
        if (this.renderedIds.has(id)) return;
        this.renderedIds.add(id);
        this.observer.unobserve(el);
        const item = this.results.find(i => i.id === id);
        if (!item) return;
        const cv = el.querySelector("canvas");
        if (!cv) return;
        const ctx = cv.getContext("2d")!;
        ctx.imageSmoothingEnabled = false;
        const url = atlasUrlFor(item.tex);
        if (!url) {
            ctx.fillStyle = `rgb(${item.color[0]},${item.color[1]},${item.color[2]})`;
            ctx.fillRect(0, 0, 32, 32);
            return;
        }
        try {
            const tile = await makeTileCanvas(item, url);
            ctx.clearRect(0, 0, 32, 32);
            ctx.drawImage(tile, 0, 0);
        } catch {
            ctx.fillStyle = `rgb(${item.color[0]},${item.color[1]},${item.color[2]})`;
            ctx.fillRect(0, 0, 32, 32);
        }
    }

    markSelected(id: number): void {
        for (const el of this.listEl.querySelectorAll(".item-card.selected")) {
            el.classList.remove("selected");
        }
        const el = this.listEl.querySelector<HTMLElement>(`.item-card[data-item-id="${id}"]`);
        el?.classList.add("selected");
        el?.scrollIntoView({ block: "nearest" });
    }
}
