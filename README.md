# Growtopia World Planner

A web-based visual world editor for Growtopia (GTPS3 format). Design 100×60 tile worlds with real Growtopia items and export as compatible world JSON.

## Features

- **Visual World Canvas** - 100×60 tile grid (6000 tiles) with zoom, pan, and grid overlay
- **Real Item Database** - 16,000+ items from official Growtopia data with RTTEX texture rendering
- **Dual Layer Editing** - Separate Foreground (FG) and Background (BG) layers
- **Tools**: Place FG/BG, Erase (per-layer), Fill, Eyedropper (Pick)
- **Brush Size** - 1×1 to 16×16 tile brush
- **Undo/Redo** - Full history (100 operations)
- **Lock Tiles** - Prevent overwriting existing tiles on same layer
- **Layer Visibility** - Toggle FG/BG visibility independently
- **Bedrock Layer** - Auto-place bedrock at world bottom (y 53-59)
- **Exact Search** - Find items by ID or partial name (min 2 chars)
- **Import/Export** - GTPS3 JSON format compatible with Growtopia servers
- **Unsaved Changes Warning** - Browser confirmation on page reload/close

## Quick Start

```bash
# Install dependencies
npm install

# Generate item index & atlases (required first time)
npm run gen

# Start dev server
npm run dev

# Build for production
npm run build
```

## Project Structure

```
world-editor/
├── index.html          # Main HTML entry
├── package.json
├── tsconfig.json
├── vite.config.ts
├── README.md
├── public/
│   ├── gen/            # Generated item/atlas indexes
│   └── rttex/          # RTTEX texture files
├── data/
│   ├── items.json      # Raw Growtopia item definitions (16k+ items)
│   └── items.dat       # Binary item data
├── scripts/
│   └── build-data.mjs  # Generates public/gen from data/
└── src/
    ├── main.ts         # Application entry & UI logic
    ├── world.ts        # World state (100×60 tiles, undo/redo)
    ├── renderer.ts     # Canvas rendering (tiles, grid, hover preview)
    ├── items.ts        # Item loading, search, atlas handling
    ├── rttex.ts        # RTTEX decoding & texture caching
    ├── ui.ts           # Item browser (virtualized, lazy-loaded)
    ├── serialize.ts    # GTPS3 JSON import/export
    ├── types.ts        # TypeScript interfaces
    └── style.css       # Complete UI styling
```

## Controls

| Action | Key / UI |
|--------|----------|
| Place FG | `B` or click FG tool |
| Place BG | `V` or click BG tool |
| Erase | `E` or click Erase tool |
| Fill | `F` or click Fill tool |
| Pick (Eyedropper) | `I` or click Pick tool |
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Y` / `Ctrl+Shift+Z` |
| Pan | `Space` + drag or Middle mouse |
| Zoom | Mouse wheel |
| Fit to screen | `0` or Fit button |

## Data Pipeline

1. **Source**: `data/items.json` - Official Growtopia item definitions
2. **Build**: `npm run gen` runs `scripts/build-data.mjs`:
   - Filters placeable items (excludes actions: 0,1,4,8,19,20,37,63,72,115,129)
   - Separates FG/BG by action type
   - Extracts average color per item for placeholders
   - Copies RTTEX files to `public/rttex/`
   - Generates `public/gen/items_index.json` & `atlas_index.json`
3. **Runtime**: Items lazy-loaded via `fetch()` from `public/gen/`

## Export Format (GTPS3 JSON)

```json
{
  "name": "WORLDNAME",
  "blocks": [
    { "f": 2, "b": 8 },
    { "f": 2 },
    null,
    ...
  ],
  "owner": "WORLDNAME",
  "weather": 0,
  "music_bpm": 100,
  ...
}
```

- `blocks` array: 6000 entries (100×60), row-major order
- Each entry: `f` (foreground ID), `b` (background ID), plus optional `t` (sign text), `dd`/`di` (doors), `fl` (flags), `o` (open state)
- Null entries for empty tiles

## Requirements

- Node.js 18+
- Modern browser with ES modules, Canvas API, fetch, ResizeObserver

## License

Internal tool for Growtopia world planning.