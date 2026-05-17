# fig

Offline CLI for making polished tables, charts, diagrams, and graphs that agents can generate and send quickly.

## Install

From this directory:

```bash
npm install
ln -sf "$PWD/bin/fig.mjs" ~/.local/bin/fig
```

System tools:

- `typst` for tables

DOT graphs render through local WASM Graphviz for PNG/SVG.

Common `flowchart TD` / `graph LR` Mermaid diagrams render through a browserless built-in renderer. More advanced Mermaid syntax falls back to Mermaid CLI, which may require browser system libraries.

## Usage

```bash
fig table data.csv --title "Quarterly Results" -o figures/table.png
fig chart data.csv --x month --y revenue --kind line -o figures/chart.png
fig diagram flow.mmd -o figures/flow.png
fig graph deps.dot -o figures/deps.png
fig spec figure.yaml -o figures/from-spec.png
```

Use stdin for quick one-offs:

```bash
printf "name,value\nA,10\nB,18\n" | fig chart --x name --y value --kind bar -o figures/bar.png
```

## Figure Types

- `table`: CSV, TSV, JSON, or Markdown table to a LaTeX-style Typst-rendered PNG/SVG.
- `chart`: CSV, TSV, or JSON to a local Vega-Lite chart rendered as PNG/SVG.
- `diagram`: common Mermaid flowchart source to PNG/SVG without a browser; advanced Mermaid falls back to Mermaid CLI.
- `graph`: DOT source to PNG/SVG using WASM Graphviz.
- `spec`: YAML/JSON wrapper around repeatable figure definitions.

## Specs

```yaml
type: chart
title: Quarterly Revenue
source: data.csv
kind: bar
x: quarter
y: revenue
format: png
output: figures/revenue.png
```

## Verification

```bash
npm test
npm run smoke
```

Smoke outputs are written under `tmp/smoke/`.
