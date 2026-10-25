import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { admitFabricationOrder } from "../src/order.mjs";
import { planFabrication } from "../src/plan.mjs";
import { isRefusal } from "../src/refusal.mjs";

export const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const orderOf = (kind, inputs, extra = {}) => ({ type: "FabricationOrderCandidate", version: 1, kind, buyer: { id: "buyer-1" }, inputs, ...extra });

export function admitted(kind, inputs, extra) {
  const admission = admitFabricationOrder(orderOf(kind, inputs, extra));
  assert.equal(admission.type, "FabricationOrderAdmission", JSON.stringify(admission));
  return admission;
}

export function planned(admission) {
  const plan = planFabrication(admission.specification);
  assert.equal(plan.type, "FabricationPlan", JSON.stringify(plan));
  return plan;
}

export const deliveryOf = (admission, outputs, evidence = {}, producer = { id: "fake-agent", revision: "test" }) => ({
  type: "FabricationDeliveryCandidate", version: 1, artifactId: admission.artifactId,
  specificationDigest: admission.specification.specificationDigest, producer, outputs, evidence,
});

export const must = (record) => { assert.ok(!isRefusal(record), JSON.stringify(record)); return record; };

export const CHART_SPEC = { $schema: "https://vega.github.io/schema/vega-lite/v5.json", data: { values: [{ a: "A", b: 3 }, { a: "B", b: 5 }] }, mark: "bar", encoding: { x: { field: "a", type: "nominal" }, y: { field: "b", type: "quantitative" } } };

export const EXAMPLE_INPUTS = {
  "research-paper": { title: "T", thesis: "Why" },
  "research-paper-text": { title: "T", thesis: "Why" },
  "corpus-research-paper": { title: "T", thesis: "Why", corpus: "sociology" },
  "lean-proof": { statement: "theorem add_comm_example (a b : Nat) : a + b = b + a", theoremName: "add_comm_example", module: "Example.AddComm", tier: "routine" },
  "svg-chart": { spec: CHART_SPEC },
  "svg-diagram": { intent: "Show dependencies.", source: { kind: "dependency-graph", graph: { nodes: [{ id: "a", label: "alpha" }, { id: "b", label: "beta" }], edges: [{ from: "a", to: "b" }] } } },
  ebook: { title: "B", manuscript: { locator: "https://example.org/m.tar", digest: `sha256:${"0".repeat(64)}` } },
  "newsletter-issue": { title: "N", brief: "Brief." },
  "fiction-serial": { manifest: { canon: "c", serial: "s", cadence: "weekly", buttondownNewsletter: "s", language: "en", script: "Latn", freeEpisodes: [1] }, storyBible: { outline: [] }, brief: "Episode." },
};
