import assert from "node:assert/strict";
import { test } from "node:test";
import { admitArtifactFabricationRealizationReceipt } from "@red-cup-engineering/computer-data-engineering-services-section/artifact-fabrication";
import { renderVegaLiteSpecAsSvg } from "@red-cup-engineering/chart-specification-rendering-service/render-vega-lite-spec-as-svg";
import { assayFabricatedArtifact } from "../src/assay.mjs";
import { receiveFabricationDelivery } from "../src/delivery.mjs";
import { CHART_SPEC, EXAMPLE_INPUTS, admitted, deliveryOf } from "./helpers.mjs";

const RECEIVED = "2026-10-25T00:00:00Z";
async function chart(tamper = false) {
  const admission = admitted("svg-chart", EXAMPLE_INPUTS["svg-chart"]);
  const { svg } = await renderVegaLiteSpecAsSvg({ spec: CHART_SPEC });
  const delivery = deliveryOf(admission, [{ projection: "svg", mediaType: "image/svg+xml", text: tamper ? `${svg}<!-- drift -->` : svg }, { projection: "spec", mediaType: "application/json", json: CHART_SPEC }]);
  return { admission, delivery, assay: await assayFabricatedArtifact({ admission, delivery }) };
}

test("a delivery that passed every assay is received: receipt, cells, PROV and a market outcome", async () => {
  const { admission, delivery, assay } = await chart();
  const got = await receiveFabricationDelivery({ admission, delivery, assay, receivedAt: RECEIVED });
  assert.equal(got.type, "FabricationDeliveryReceipt", JSON.stringify(got));
  // the receipt is the data layer's, and re-admits to itself
  const again = admitArtifactFabricationRealizationReceipt(admission.specification, {
    type: "ArtifactFabricationRealizationReceiptCandidate", version: 1, artifactId: got.receipt.artifactId, specificationDigest: got.receipt.specificationDigest,
    realizations: got.receipt.realizations, acceptances: got.receipt.acceptances,
  });
  assert.deepEqual(again, got.receipt);
  assert.deepEqual(got.receipt.realizations.map(({ projectionId }) => projectionId), ["spec", "svg"]);
  for (const realization of got.receipt.realizations) assert.match(realization.evidence.digest, /^ni:\/\/\/sha-256;/u);
  assert.deepEqual(got.receipt.acceptances.map(({ acceptanceObligationId }) => acceptanceObligationId).sort(), ["svg-byte-deterministic", "svg-safe", "vega-lite-valid"]);
  assert.equal(got.cells.length, assay.cells.length);
  assert.equal(got.provenance.closed, true);
  assert.match(got.provenance.canonicalNi, /^ni:\/\/\/sha-256;/u);
  assert.ok(got.provenance.manifest.entities.some(({ ni }) => ni === assay.outputs.find(({ projection }) => projection === "svg").ni));
  assert.equal(got.marketOutcome.outcome, "accepted");
  assert.equal(got.marketOutcome.receipt, got.receiptDigest);
  // receiving is deterministic
  assert.deepEqual(await receiveFabricationDelivery({ admission, delivery, assay, receivedAt: RECEIVED }), got);
});

test("a delivery with a failed assay is refused, naming each failure", async () => {
  const { admission, delivery, assay } = await chart(true);
  assert.equal(assay.passed, false);
  const refused = await receiveFabricationDelivery({ admission, delivery, assay, receivedAt: RECEIVED });
  assert.equal(refused.type, "FabricationDeliveryRefusal");
  assert.equal(refused.code, "ASSAY_FAILED");
  assert.deepEqual(refused.detail.failures.map(({ assay: id }) => id), ["svg-byte-deterministic"]);
});

test("an assay of other bytes, another artifact, or with cells that do not show its verdict is refused", async () => {
  const { admission, delivery, assay } = await chart();
  const { delivery: other } = await chart(true);
  assert.equal((await receiveFabricationDelivery({ admission, delivery: other, assay, receivedAt: RECEIVED })).code, "ASSAY_OF_OTHER_BYTES");
  assert.equal((await receiveFabricationDelivery({ admission, delivery, assay: { ...assay, artifactId: "svg-chart-0000000000000000" }, receivedAt: RECEIVED })).code, "ASSAY_BINDING_MISMATCH");
  const forged = { ...assay, verdicts: assay.verdicts.map((verdict) => (verdict.assay === "svg-safe" ? { ...verdict, ok: false } : verdict)) };
  assert.equal((await receiveFabricationDelivery({ admission, delivery, assay: forged, receivedAt: RECEIVED })).code, "INVALID_ASSAY");
  const dropped = { ...assay, cells: assay.cells.filter((cell) => cell.predicate !== "svg-safe") };
  assert.equal((await receiveFabricationDelivery({ admission, delivery, assay: dropped, receivedAt: RECEIVED })).code, "INVALID_ASSAY");
  assert.equal((await receiveFabricationDelivery({ admission, delivery, assay, receivedAt: "yesterday" })).code, "INVALID_REQUEST");
  assert.equal((await receiveFabricationDelivery({ admission, delivery, assay: { type: "nope" }, receivedAt: RECEIVED })).code, "INVALID_ASSAY");
});
