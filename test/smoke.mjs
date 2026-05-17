import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const fig = path.join(root, "bin", "fig.mjs");
const out = path.join(root, "tmp", "smoke");
mkdirSync(out, { recursive: true });

function run(args) {
  execFileSync("node", [fig, ...args], { cwd: root, stdio: "inherit" });
}

function optional(args, label) {
  const result = spawnSync("node", [fig, ...args], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`optional smoke skipped/failed: ${label}`);
  }
}

run(["table", "test/fixtures/models.csv", "--title", "Model Scores", "-o", path.join(out, "table.png")]);
run(["chart", "test/fixtures/months.csv", "--x", "month", "--y", "revenue", "--kind", "bar", "--spec", path.join(out, "bar.vl.json"), "-o", path.join(out, "bar.png")]);
run(["chart", "test/fixtures/months.csv", "--x", "month", "--y", "revenue", "--kind", "line", "-o", path.join(out, "line.svg"), "--format", "svg"]);
run(["spec", "examples/chart.yaml", "-o", path.join(out, "spec-chart.png")]);
optional(["diagram", "test/fixtures/flow.mmd", "-o", path.join(out, "diagram.png")], "diagram");
optional(["graph", "test/fixtures/deps.dot", "-o", path.join(out, "graph.png")], "graph");
