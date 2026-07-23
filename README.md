# SNDK Build Matrix Mapper

A browser-based tool that converts QSI/WD **Line Validation (LV) Build Matrix BOM CSVs** into the flat, one-row-per-build **SNDK Build Matrix update** CSV format — no spreadsheet macros required.

🔗 Live app: https://oppmtmb.github.io/Build_Matrix_Mapper/

## What it does

Drop in one or more LV Build Matrix / NPBR Qual Matrix BOM files (CSV or Excel) and the app will:

- Parse the vertical header block (SKU, A198, A190, Capacity, Build Qty, Stage, FF, etc.) and the component BOM rows beneath it.
- Detect and split **Leg 1 / Leg 2** (and multi-leg) build structures automatically.
- Map each BOM row to the correct component column (PCB, BGA, DRAM, ASIC, PMIC, Inductors, Diodes, TIM, Enclosures, Screw, Carton, etc.) using designator, description, and part-number matching rules.
- Apply part-number prefix rules (e.g. `9*` vs `825*` PN) to the right output columns.
- Flag low-confidence matches for Stage / FF / Project so they can be reviewed before export.
- Let you inline-edit any mapped cell or column value before exporting.
- Export a single CSV matching the 62-column **SNDK Build Matrix** template, ready to paste/import into the master tracker.

## Tech stack

- [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite 6](https://vitejs.dev/) — dev server & build
- [PapaParse](https://www.papaparse.com/) — CSV parsing
- [SheetJS (xlsx)](https://sheetjs.com/) — Excel file support
- [Tailwind CSS 4](https://tailwindcss.com/) — styling
- [lucide-react](https://lucide.dev/) — icons

## Getting started

```bash
# install dependencies
bun install   # or: npm install

# start the dev server (http://localhost:3000)
bun run dev   # or: npm run dev

# type-check
bun run lint  # or: npm run lint

# production build
bun run build # or: npm run build
```

> An `.env.example` is included for an optional `GEMINI_API_KEY` (scaffolded from the [google-gemini/aistudio-repository-template](https://github.com/google-gemini/aistudio-repository-template) this project was generated from). It is not required for the core CSV mapping functionality.

## Project structure

```
src/
  App.tsx           # UI: file upload, build list, mapping table, inline edit, export
  utils/parser.ts   # Core parsing/mapping logic and EXPORT_HEADERS definition
  main.tsx          # App entry point
public/             # Static assets
test_sheet.csv      # Sample LV Build Matrix input for testing
```

## Input format

The parser expects an LV Build Matrix / NPBR Qual Matrix style CSV: a vertical header block (SKU / A198 / A190 / Capacity / Build Qty, optionally split into Leg 1 / Leg 2 columns) followed by a component BOM table with designator (location), description, and part-number columns. See `test_sheet.csv` for a sample.

## Output format

A flat CSV with one row per build, using the fixed 62-column SNDK Build Matrix header set defined in `EXPORT_HEADERS` (`src/utils/parser.ts`), covering build identity fields (Project, Stage, Gen, FF, Capacity, Build#, Leg#, DCN/ECR, WO#, PNs) and per-component columns (PCB, BGA, DRAM, ASIC, PMIC, passives, connectors, enclosure, packaging, etc.).
