#!/usr/bin/env node
import { Command } from "commander";
import { parse as parseCsv } from "csv-parse/sync";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { Graphviz } from "@hpcc-js/wasm/graphviz";
import opentype from "opentype.js";
import * as vega from "vega";
import * as vegaLite from "vega-lite";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT_DIR = "figures";
const DEFAULT_WIDTH = 1120;
const DEFAULT_HEIGHT = 720;

configureFontconfig();

const program = new Command();
program
  .name("fig")
  .description("Offline CLI for professional tables, charts, diagrams, and graphs.")
  .version("0.1.0");

program
  .command("table [file]")
  .description("Render CSV/TSV/JSON/Markdown table data as a LaTeX-style image via Typst.")
  .option("-o, --output <path>", "Output path")
  .option("--format <format>", "png or svg", "png")
  .option("--title <text>", "Figure title")
  .option("--note <text>", "Footnote text")
  .option("--columns <list>", "Comma-separated columns to include")
  .option("--data <text>", "Inline CSV/TSV/JSON/Markdown data")
  .action(async (file, opts) => {
    const output = resolveOutput(opts.output, "table", opts.format);
    const rows = await readData(file, opts);
    const columns = resolveColumns(rows, opts.columns);
    await renderTable({ rows, columns, output, title: opts.title, note: opts.note, format: opts.format });
    console.log(output);
  });

program
  .command("chart [file]")
  .description("Render CSV/TSV/JSON data as an offline Vega-Lite chart.")
  .option("-o, --output <path>", "Output path")
  .option("--format <format>", "png or svg", "png")
  .requiredOption("--x <field>", "X field")
  .option("--y <field>", "Y field")
  .option("--kind <kind>", "bar, line, area, scatter, or histogram", "bar")
  .option("--title <text>", "Figure title")
  .option("--subtitle <text>", "Subtitle")
  .option("--data <text>", "Inline CSV/TSV/JSON data")
  .option("--color <field>", "Color/group field")
  .option("--spec <path>", "Also write the generated Vega-Lite spec JSON")
  .action(async (file, opts) => {
    const output = resolveOutput(opts.output, `${opts.kind}-chart`, opts.format);
    const rows = await readData(file, opts);
    const spec = makeVegaLiteSpec(rows, opts);
    if (opts.spec) writeJson(opts.spec, spec);
    await renderChart({ spec, output, format: opts.format });
    console.log(output);
  });

program
  .command("diagram [file]")
  .description("Render a Mermaid flowchart locally, with Mermaid CLI fallback for advanced syntax.")
  .option("-o, --output <path>", "Output path")
  .option("--format <format>", "png or svg", "png")
  .option("--data <text>", "Inline Mermaid source")
  .action(async (file, opts) => {
    const output = resolveOutput(opts.output, "diagram", opts.format);
    await renderDiagram({ source: await readText(file, opts.data), output, format: opts.format });
    console.log(output);
  });

program
  .command("graph [file]")
  .description("Render a DOT/Graphviz graph using local WASM Graphviz.")
  .option("-o, --output <path>", "Output path")
  .option("--format <format>", "png or svg", "png")
  .option("--data <text>", "Inline DOT source")
  .action(async (file, opts) => {
    const output = resolveOutput(opts.output, "graph", opts.format);
    await renderGraph({ source: await readText(file, opts.data), output, format: opts.format });
    console.log(output);
  });

program
  .command("spec <file>")
  .description("Render a YAML/JSON figure spec.")
  .option("-o, --output <path>", "Output path override")
  .action(async (file, opts) => {
    const spec = parseSpec(readFileSync(file, "utf8"));
    const merged = {
      ...spec,
      output: opts.output ?? spec.output
    };
    const output = await renderSpec(merged);
    console.log(output);
  });

program
  .command("examples")
  .description("Print quick examples.")
  .action(() => {
    console.log(`fig table data.csv --title "Results" -o table.png
printf "name,value\\nA,10\\nB,18\\n" | fig chart --x name --y value --kind bar -o chart.png
fig chart data.csv --x month --y revenue --kind line --spec chart.vl.json -o chart.png
fig diagram flow.mmd -o flow.png
fig graph deps.dot -o deps.png
fig spec figure.yaml -o figure.png`);
  });

program.parseAsync().catch(error => {
  console.error(`fig: ${error.message}`);
  process.exit(1);
});

async function renderSpec(spec) {
  if (!spec.type) throw new Error("Spec requires a type field.");
  if (spec.type === "table") {
    const rows = await readData(spec.source, { data: spec.data });
    const columns = resolveColumns(rows, Array.isArray(spec.columns) ? spec.columns.map(c => c.key ?? c).join(",") : spec.columns);
    const output = resolveOutput(spec.output, "table", spec.format ?? "png");
    await renderTable({ rows, columns, output, title: spec.title, note: spec.note, format: spec.format ?? "png" });
    return output;
  }
  if (spec.type === "chart") {
    const rows = await readData(spec.source, { data: spec.data });
    const output = resolveOutput(spec.output, `${spec.kind ?? "bar"}-chart`, spec.format ?? "png");
    const chartSpec = makeVegaLiteSpec(rows, { ...spec, kind: spec.kind ?? "bar" });
    await renderChart({ spec: chartSpec, output, format: spec.format ?? "png" });
    return output;
  }
  if (spec.type === "diagram") {
    const output = resolveOutput(spec.output, "diagram", spec.format ?? "png");
    await renderDiagram({ source: spec.data ?? readFileSync(spec.source, "utf8"), output, format: spec.format ?? "png" });
    return output;
  }
  if (spec.type === "graph") {
    const output = resolveOutput(spec.output, "graph", spec.format ?? "png");
    await renderGraph({ source: spec.data ?? readFileSync(spec.source, "utf8"), output, format: spec.format ?? "png" });
    return output;
  }
  throw new Error(`Unsupported spec type: ${spec.type}`);
}

async function readText(file, inline) {
  if (inline != null) return inline;
  if (file && file !== "-") return readFileSync(file, "utf8");
  return await new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => data += chunk);
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function readData(file, opts = {}) {
  const rows = parseData(await readText(file, opts.data), file);
  if (!rows.length) throw new Error("No rows found.");
  return rows;
}

function parseData(text, file = "") {
  const trimmed = String(text).trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : parsed.data ?? parsed.rows ?? [];
  }
  if (/^\s*\|.+\|\s*$/m.test(trimmed)) return parseMarkdownTable(trimmed);
  const delimiter = file.endsWith(".tsv") || trimmed.includes("\t") ? "\t" : ",";
  return parseCsv(trimmed, { columns: true, skip_empty_lines: true, trim: true, delimiter });
}

function parseMarkdownTable(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith("|"));
  const cells = line => line.replace(/^\||\|$/g, "").split("|").map(c => c.trim());
  const headers = cells(lines[0]);
  return lines.slice(2).map(line => Object.fromEntries(cells(line).map((v, i) => [headers[i] ?? `col${i + 1}`, v])));
}

function parseSpec(text) {
  return text.trim().startsWith("{") ? JSON.parse(text) : YAML.parse(text);
}

function resolveColumns(rows, columns) {
  if (columns) return columns.split(",").map(c => c.trim()).filter(Boolean);
  return Object.keys(rows[0] ?? {});
}

function resolveOutput(output, stem, format = "png") {
  if (output) {
    mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    return output;
  }
  mkdirSync(DEFAULT_OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  return path.join(DEFAULT_OUT_DIR, `${stem}-${stamp}.${format}`);
}

async function renderTable({ rows, columns, output, title, note, format }) {
  if (!["png", "svg"].includes(format)) throw new Error("Tables support png or svg output.");
  const typst = requireBinary("typst", [], "Typst is required for fig table.");
  const source = writeTemp("table.typ", tableTypst(rows, columns, { title, note }));
  const args = ["compile", source, output, "--format", format];
  if (format === "png") args.push("--ppi", "180");
  execFileSync(typst, args, { stdio: "inherit" });
}

function tableTypst(rows, columns, { title, note }) {
  const align = columns.map(c => inferNumeric(rows, c) ? "right" : "left").join(", ");
  const tracks = columns.map(() => "auto").join(", ");
  const cells = [
    `table.header(${columns.map(c => `[${typStrong(labelize(c))}]`).join(", ")}),`,
    "table.hline(stroke: 0.45pt),",
    ...rows.flatMap(row => columns.map(c => `[${typInline(row[c] ?? "")}],`)),
    `table.cell(colspan: ${columns.length}, inset: 0pt)[#v(1.4pt)],`,
    "table.hline(stroke: 0.9pt),"
  ].join("\n    ");

  const titleBlock = title ? `text(size: 12.5pt, weight: "bold")[${typInline(title)}],` : "";
  const noteBlock = note ? `,\n    v(5pt),\n    text(size: 8.2pt, fill: rgb("#5f6368"))[${typInline(note)}]` : "";

  return `#set page(width: auto, height: auto, margin: 0.14in)
#set text(font: "Libertinus Serif", size: 11pt)
#set par(justify: false)

#align(center)[
  #stack(
    dir: ttb,
    spacing: 8pt,
    ${titleBlock}
    table(
      columns: (${tracks}),
      align: (${align}),
      stroke: none,
      inset: (x: 5.5pt, y: 3.2pt),
      table.hline(stroke: 0.9pt),
      ${cells}
    )${noteBlock}
  )
]`;
}

function typInline(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]").replaceAll("$", "\\$");
}

function typStrong(value) {
  return `*${typInline(value)}*`;
}

function makeVegaLiteSpec(rows, opts) {
  const kind = opts.kind ?? "bar";
  const mark = kind === "scatter" ? { type: "point", filled: true, size: 120, opacity: 0.86 } : { type: kind, tooltip: true };
  const encoding = {
    x: { field: opts.x, type: inferVegaType(rows, opts.x), axis: { labelAngle: 0, title: labelize(opts.x) } },
    ...(opts.y ? { y: { field: opts.y, type: inferVegaType(rows, opts.y), axis: { title: labelize(opts.y) } } } : {}),
    ...(opts.color ? { color: { field: opts.color, type: inferVegaType(rows, opts.color), legend: { title: labelize(opts.color) } } } : {})
  };

  if (kind === "histogram") {
    return baseVegaLiteSpec(opts, rows, {
      mark: { type: "bar", tooltip: true },
      encoding: {
        x: { field: opts.x, type: "quantitative", bin: { maxbins: Number(opts.bins ?? 12) }, axis: { title: labelize(opts.x) } },
        y: { aggregate: "count", type: "quantitative", axis: { title: "Count" } }
      }
    });
  }

  return baseVegaLiteSpec(opts, rows, { mark, encoding });
}

function baseVegaLiteSpec(opts, rows, partial) {
  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    width: DEFAULT_WIDTH - 190,
    height: DEFAULT_HEIGHT - 190,
    padding: { left: 118, right: 30, top: 34, bottom: 68 },
    title: opts.subtitle
      ? { text: opts.title ?? "Figure", subtitle: opts.subtitle, anchor: "start" }
      : opts.title,
    data: { values: coerceRows(rows) },
    config: {
      background: "white",
      view: { stroke: null },
      axis: {
        domainColor: "#34383d",
        gridColor: "#d9dee5",
        labelColor: "#5f6368",
        labelFont: "Open Sans",
        labelFontSize: 15,
        titleColor: "#34383d",
        titleFont: "Open Sans",
        titleFontSize: 16,
        titlePadding: 12
      },
      title: {
        color: "#202124",
        font: "Open Sans",
        fontSize: 28,
        subtitleColor: "#5f6368",
        subtitleFont: "Open Sans",
        subtitleFontSize: 17,
        offset: 20
      },
      legend: {
        labelFont: "Open Sans",
        labelFontSize: 14,
        titleFont: "Open Sans",
        titleFontSize: 15
      },
      range: {
        category: ["#2f6f8f", "#0b6b61", "#c7503c", "#8a6f2a", "#6c5a89", "#d08c38"]
      },
      bar: { color: "#2f6f8f", cornerRadiusTopLeft: 4, cornerRadiusTopRight: 4 },
      line: { color: "#0b6b61", strokeWidth: 4 },
      area: { color: "#4aa39a", opacity: 0.25 },
      point: { color: "#c7503c" }
    },
    ...partial
  };
}

async function renderChart({ spec, output, format }) {
  if (!["png", "svg"].includes(format)) throw new Error("Charts support png or svg output.");
  const compiled = vegaLite.compile(spec).spec;
  const view = new vega.View(vega.parse(compiled), { renderer: "none" });
  const svg = await view.toSVG();
  if (format === "svg") {
    writeFileSync(output, svg);
    return;
  }
  await svgToPng(svg, output);
}

async function renderDiagram({ source, output, format }) {
  if (!["png", "svg"].includes(format)) throw new Error("Diagrams support png or svg output.");
  if (isSimpleMermaidFlow(source)) {
    const svg = simpleFlowSvg(source);
    await writeSvgOutput(svg, output, format);
    return;
  }

  const mmdc = optionalBinary("mmdc", [path.join(PACKAGE_ROOT, "node_modules", ".bin", "mmdc")]);
  if (!mmdc) throw new Error("This Mermaid syntax needs Mermaid CLI. For browserless local rendering, use flowchart/graph TD/LR syntax.");
  const input = writeTemp("diagram.mmd", source);
  try {
    execFileSync(mmdc, ["-i", input, "-o", output, "-b", "white"], { stdio: "pipe" });
  } catch (error) {
    throw new Error(`Mermaid CLI failed. Browserless fallback supports common flowchart syntax only. ${String(error.stderr ?? error.message).trim()}`);
  }
}

async function renderGraph({ source, output, format }) {
  if (!["png", "svg"].includes(format)) throw new Error("Graphs support png or svg output.");
  const graphviz = await Graphviz.load();
  const svg = graphviz.layout(applyDefaultGraphFonts(source), "svg", "dot");
  await writeSvgOutput(svg, output, format);
}

async function writeSvgOutput(svg, output, format) {
  if (format === "svg") {
    writeFileSync(output, svg);
    return;
  }
  await svgToPng(svg, output);
}

async function svgToPng(svg, output) {
  await sharp(Buffer.from(textToPaths(svg)), { density: 288 }).png({ quality: 100, compressionLevel: 9 }).toFile(output);
}

function isSimpleMermaidFlow(source) {
  return /^\s*(flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/m.test(source);
}

function simpleFlowSvg(source) {
  const { direction, nodes, edges } = parseSimpleFlow(source);
  const ids = [...nodes.keys()];
  const horizontal = direction === "LR" || direction === "RL";
  const nodeW = 190;
  const nodeH = 66;
  const gapX = 96;
  const gapY = 72;
  const margin = 56;
  const positions = new Map();

  ids.forEach((id, index) => {
    const x = horizontal ? margin + index * (nodeW + gapX) : margin;
    const y = horizontal ? margin : margin + index * (nodeH + gapY);
    positions.set(id, { x, y });
  });

  const width = horizontal ? Math.max(420, margin * 2 + ids.length * nodeW + Math.max(0, ids.length - 1) * gapX) : margin * 2 + nodeW;
  const height = horizontal ? margin * 2 + nodeH : Math.max(260, margin * 2 + ids.length * nodeH + Math.max(0, ids.length - 1) * gapY);
  const shapes = ids.map(id => {
    const node = nodes.get(id);
    const p = positions.get(id);
    const label = escapeXml(node.label);
    if (node.shape === "decision") {
      const points = `${p.x + nodeW / 2},${p.y} ${p.x + nodeW},${p.y + nodeH / 2} ${p.x + nodeW / 2},${p.y + nodeH} ${p.x},${p.y + nodeH / 2}`;
      return `<polygon points="${points}" fill="#fff8e7" stroke="#8a6f2a" stroke-width="2"/><text x="${p.x + nodeW / 2}" y="${p.y + nodeH / 2 + 6}" text-anchor="middle" class="label">${label}</text>`;
    }
    return `<rect x="${p.x}" y="${p.y}" width="${nodeW}" height="${nodeH}" rx="8" fill="#f7f9fb" stroke="#5f6b7a" stroke-width="2"/><text x="${p.x + nodeW / 2}" y="${p.y + nodeH / 2 + 6}" text-anchor="middle" class="label">${label}</text>`;
  }).join("\n");

  const arrows = edges.map(edge => {
    const a = positions.get(edge.from);
    const b = positions.get(edge.to);
    if (!a || !b) return "";
    const start = horizontal
      ? { x: a.x + nodeW, y: a.y + nodeH / 2 }
      : { x: a.x + nodeW / 2, y: a.y + nodeH };
    const end = horizontal
      ? { x: b.x, y: b.y + nodeH / 2 }
      : { x: b.x + nodeW / 2, y: b.y };
    const mid = horizontal
      ? `M ${start.x} ${start.y} L ${end.x - 14} ${end.y}`
      : `M ${start.x} ${start.y} L ${end.x} ${end.y - 14}`;
    const label = edge.label ? `<text x="${(start.x + end.x) / 2}" y="${(start.y + end.y) / 2 - 8}" text-anchor="middle" class="edge-label">${escapeXml(edge.label)}</text>` : "";
    return `<path d="${mid}" fill="none" stroke="#34383d" stroke-width="2" marker-end="url(#arrow)"/>${label}`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#34383d"/>
    </marker>
    <style>
      .label{font-family:Open Sans,Arial,sans-serif;font-size:17px;fill:#202124}
      .edge-label{font-family:Open Sans,Arial,sans-serif;font-size:14px;fill:#5f6368}
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#fff"/>
  ${arrows}
  ${shapes}
</svg>`;
}

function parseSimpleFlow(source) {
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("%%"));
  const header = lines.shift() ?? "flowchart TD";
  const direction = header.match(/\b(TD|TB|BT|LR|RL)\b/)?.[1] ?? "TD";
  const nodes = new Map();
  const edges = [];

  for (const line of lines) {
    const parts = line.split(/-->|---|==>/);
    if (parts.length < 2) continue;
    const from = parseNodeRef(parts[0]);
    const to = parseNodeRef(parts[1].replace(/^\|([^|]+)\|/, ""));
    const label = parts[1].match(/^\|([^|]+)\|/)?.[1];
    if (from) mergeNode(nodes, from);
    if (to) mergeNode(nodes, to);
    if (from && to) edges.push({ from: from.id, to: to.id, label });
  }

  return { direction, nodes, edges };
}

function mergeNode(nodes, node) {
  const current = nodes.get(node.id);
  if (!current || current.label === current.id && node.label !== node.id) {
    nodes.set(node.id, node);
  }
}

function configureFontconfig() {
  if (process.env.FONTCONFIG_FILE) return;

  const fontDir = path.join(PACKAGE_ROOT, "assets");
  if (!existsSync(fontDir)) return;

  const dir = path.join(os.tmpdir(), "fig-cli-fontconfig");
  mkdirSync(dir, { recursive: true });
  const configFile = path.join(dir, "fonts.conf");
  const cacheDir = path.join(os.tmpdir(), "fig-cli-font-cache");
  writeFileSync(configFile, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>${xmlEscape(fontDir)}</dir>
  <dir>/usr/share/fonts</dir>
  <cachedir>${xmlEscape(cacheDir)}</cachedir>
  <config></config>
</fontconfig>
`);
  process.env.FONTCONFIG_FILE = configFile;
}

function applyDefaultGraphFonts(source) {
  if (/fontname\s*=/i.test(source)) return source;
  const insertAt = source.indexOf("{");
  if (insertAt < 0) return source;
  const defaults = '\n  graph [fontname="Open Sans", fontsize=10];\n  node [fontname="Open Sans", fontsize=10, margin="0.20,0.10"];\n  edge [fontname="Open Sans", fontsize=9];\n';
  return `${source.slice(0, insertAt + 1)}${defaults}${source.slice(insertAt + 1)}`;
}

function xmlEscape(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function textToPaths(svg) {
  const fonts = loadPathFonts();
  if (!fonts.normal) return svg;

  return svg.replace(/<text\s+([^>]*)>([\s\S]*?)<\/text>/g, (_match, rawAttrs, rawText) => {
    const attrs = parseXmlAttrs(rawAttrs);
    const text = decodeXml(rawText.replace(/<[^>]+>/g, "").trim());
    if (!text) return "";

    const style = parseStyle(attrs.style ?? "");
    const size = parseFloat(String(attrs["font-size"] ?? style["font-size"] ?? "16").replace("px", "")) || 16;
    const weight = String(attrs["font-weight"] ?? style["font-weight"] ?? "").toLowerCase();
    const font = /bold|[6-9]00/.test(weight) && fonts.bold ? fonts.bold : fonts.normal;
    const fill = attrs.fill ?? style.fill ?? "#202124";
    const anchor = attrs["text-anchor"] ?? style["text-anchor"];
    const x = Number(attrs.x ?? 0);
    const y = Number(attrs.y ?? 0);
    const width = font.getAdvanceWidth(text, size);
    const dx = anchor === "middle" ? -width / 2 : anchor === "end" ? -width : 0;
    const transform = attrs.transform ? ` transform="${xmlEscape(attrs.transform)}"` : "";
    const opacity = attrs.opacity ? ` opacity="${xmlEscape(attrs.opacity)}"` : "";
    const pointerEvents = attrs["pointer-events"] ? ` pointer-events="${xmlEscape(attrs["pointer-events"])}"` : "";
    return `<path d="${font.getPath(text, x + dx, y, size).toPathData(2)}" fill="${xmlEscape(fill)}"${opacity}${transform}${pointerEvents}/>`;
  });
}

let pathFonts;

function loadPathFonts() {
  if (pathFonts) return pathFonts;
  const fontFile = path.join(PACKAGE_ROOT, "assets", "OpenSans.ttf");
  pathFonts = {
    normal: loadFont(fontFile),
    bold: loadFont(fontFile)
  };
  return pathFonts;
}

function loadFont(file) {
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function parseXmlAttrs(rawAttrs) {
  return Object.fromEntries([...rawAttrs.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
}

function parseStyle(style) {
  return Object.fromEntries(style.split(";").map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf(":");
    return index >= 0 ? [part.slice(0, index).trim(), part.slice(index + 1).trim()] : [part, ""];
  }));
}

function decodeXml(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function parseNodeRef(value) {
  const trimmed = value.trim().replace(/;$/, "");
  const match = trimmed.match(/^([A-Za-z0-9_:-]+)(?:\[(.+?)\]|\{(.+?)\}|\((.+?)\))?$/);
  if (!match) return null;
  const [, id, box, decision, round] = match;
  return { id, label: box ?? decision ?? round ?? id, shape: decision ? "decision" : "box" };
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function coerceRows(rows) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, coerceValue(value)])));
}

function coerceValue(value) {
  if (value == null || value === "") return value;
  const number = Number(String(value).replace(/[$,%]/g, ""));
  return Number.isFinite(number) && String(value).trim() !== "" ? number : value;
}

function inferNumeric(rows, column) {
  const values = rows.map(r => r[column]).filter(v => v !== "" && v != null);
  return values.length > 0 && values.every(v => Number.isFinite(Number(String(v).replace(/[$,%]/g, ""))));
}

function inferVegaType(rows, column) {
  return inferNumeric(rows, column) ? "quantitative" : "nominal";
}

function labelize(field) {
  return String(field).replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
}

function writeJson(file, value) {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTemp(name, content) {
  const dir = path.join(os.tmpdir(), "fig-cli");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${name}`);
  writeFileSync(file, content);
  return file;
}

function requireBinary(binary, extraCandidates, message) {
  const found = optionalBinary(binary, extraCandidates);
  if (found) return found;
  throw new Error(message);
}

function optionalBinary(binary, extraCandidates) {
  for (const candidate of extraCandidates) {
    if (existsSync(candidate)) return candidate;
  }
  const result = spawnSync("bash", ["-lc", `command -v ${shellQuote(binary)}`], { encoding: "utf8" });
  if (result.status === 0) return result.stdout.trim();
  return null;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
