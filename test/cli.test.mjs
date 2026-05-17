import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const fig = path.join(root, "bin", "fig.mjs");

function tmp(name) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fig-test-"));
  return path.join(dir, name);
}

function expectFile(file) {
  assert.equal(existsSync(file), true);
  assert.ok(statSync(file).size > 1000);
}

test("prints examples", () => {
  const output = execFileSync("node", [fig, "examples"], { cwd: root, encoding: "utf8" });
  assert.match(output, /fig table/);
  assert.match(output, /fig chart/);
});

test("renders a Typst table", () => {
  const output = tmp("table.png");
  execFileSync("node", [fig, "table", "test/fixtures/models.csv", "--title", "Scores", "-o", output], { cwd: root, stdio: "pipe" });
  expectFile(output);
});

test("renders a Vega-Lite chart and spec", () => {
  const output = tmp("chart.png");
  const spec = tmp("chart.vl.json");
  execFileSync("node", [fig, "chart", "test/fixtures/months.csv", "--x", "month", "--y", "revenue", "--kind", "line", "--spec", spec, "-o", output], { cwd: root, stdio: "pipe" });
  expectFile(output);
  expectFile(spec);
});

test("renders a browserless Mermaid flowchart", () => {
  const output = tmp("diagram.png");
  execFileSync("node", [fig, "diagram", "test/fixtures/flow.mmd", "-o", output], { cwd: root, stdio: "pipe" });
  expectFile(output);
});

test("renders a DOT graph with WASM Graphviz", () => {
  const output = tmp("graph.png");
  execFileSync("node", [fig, "graph", "test/fixtures/deps.dot", "-o", output], { cwd: root, stdio: "pipe" });
  expectFile(output);
});

test("rejects PDF output", () => {
  const result = spawnSync("node", [fig, "graph", "test/fixtures/deps.dot", "--format", "pdf"], { cwd: root, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Graphs support png or svg output/);
});
