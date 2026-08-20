import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)));
await build({
    entryPoints: [resolve(root, "..", "src", "serialize.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: resolve(root, "serialize.test.mjs"),
});
await build({
    entryPoints: [resolve(root, "..", "src", "world.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: resolve(root, "world.test.mjs"),
});

const { exportWorld, parseWorld } = await import(pathToFileURL(resolve(root, "serialize.test.mjs")).href);
const { World, TILE_COUNT, WORLD_W, WORLD_H } = await import(pathToFileURL(resolve(root, "world.test.mjs")).href);

const world = new World();
world.fg[3600 + 5] = 6;
world.fg[3601 + 5] = 2;
world.bg[3601 + 5] = 14;
world.extra.set(3600 + 5, { txt: "Hello", doorDestination: "START", doorId: "1", open: 1, flags: 0x40, raw: { id: 1234, wl: 5 } });
const { blob, filename } = exportWorld({ name: "START", fg: world.fg, bg: world.bg, extra: world.extra }, { worldName: "START" });
console.log("filename:", filename, "size:", blob.size);
const json = JSON.parse(await blob.text());
console.log("blocks:", json.blocks.length === TILE_COUNT ? "OK 6000" : "FAIL");
console.log("tile 3605:", JSON.stringify(json.blocks[3605]));
console.log("tile 3606:", JSON.stringify(json.blocks[3606]));
console.log("tile 0:", JSON.stringify(json.blocks[0]));

const round = parseWorld(JSON.stringify(json));
const ok =
    round.state.fg[3605] === 6 &&
    round.state.fg[3606] === 2 &&
    round.state.bg[3606] === 14 &&
    round.state.extra.get(3605).txt === "Hello" &&
    round.state.extra.get(3605).raw.id === 1234 &&
    round.state.fg.length === TILE_COUNT;
console.log("roundtrip:", ok ? "OK" : "FAIL");

const real = readFileSync("C:/Users/HYPE AMD/Downloads/buremtopia/x64/EXE/worlds/GROWGANOTH_.json", "utf8");
const realParsed = parseWorld(real);
console.log("import GROWGANOTH_.json:", realParsed.stats.fgCount, "fg,", realParsed.stats.bgCount, "bg");
const reexport = exportWorld({ name: "GROWGANOTH", fg: realParsed.state.fg, bg: realParsed.state.bg, extra: realParsed.state.extra }, { worldName: "GROWGANOTH" });
const rejson = JSON.parse(await reexport.blob.text());
const orig = JSON.parse(real);
let diff = 0;
for (let i = 0; i < TILE_COUNT; i++) {
    const a = JSON.stringify(orig.blocks[i]);
    const b = JSON.stringify(rejson.blocks[i]);
    if (a !== b) { if (diff < 3) console.log("diff @", i, a, "->", b); diff++; }
}
console.log("re-export identical blocks:", diff === 0 ? "OK" : `${diff} beda`);

let badCaught = false;
try { exportWorld({ name: "X", fg: new Uint16Array(10), bg: new Uint16Array(10), extra: new Map() }, { worldName: "BAD NAME!" }); }
catch (e) { badCaught = true; console.log("validasi error tertangkap:", (e.message || e).toString().split("\n")[0]); }
if (!badCaught) console.log("FAIL validasi");
