import assert from "node:assert/strict";
import { test } from "node:test";
import { renderVegaLiteSpecAsSvg } from "@red-cup-engineering/chart-specification-rendering-service/render-vega-lite-spec-as-svg";
import { carrierExecutor, dispatchFabricationWork, fabricationWorkOrder, produceFabrication, unboundExecutor } from "../src/executor.mjs";
import { CHART_SPEC, EXAMPLE_INPUTS, admitted, orderOf, planned } from "./helpers.mjs";

const NOW = "2026-10-25T00:00:00Z";
const workOrderOf = () => { const admission = admitted("svg-chart", EXAMPLE_INPUTS["svg-chart"]); return fabricationWorkOrder(admission, planned(admission)); };

async function deliveryFor(workOrder, { good = true } = {}) {
  const { svg } = await renderVegaLiteSpecAsSvg({ spec: workOrder.order.inputs.spec });
  return { type: "FabricationDeliveryCandidate", version: 1, artifactId: workOrder.artifactId, specificationDigest: workOrder.specificationDigest, producer: { id: "fake", revision: "1" },
    outputs: [{ projection: "svg", mediaType: "image/svg+xml", text: good ? svg : "<svg/><script/>" }, { projection: "spec", mediaType: "application/json", json: workOrder.order.inputs.spec }] };
}

test("the work order carries the plan's steps, deliverables and assays under a lot, and the agent steps the executor owns", () => {
  const workOrder = workOrderOf();
  assert.match(workOrder.lot, /^urn:work-lot:fabrication:svg-chart-/u);
  assert.deepEqual(workOrder.agentSteps, ["specify-chart"]);
  assert.deepEqual(workOrder.assays, ["vega-lite-valid", "svg-byte-deterministic", "svg-safe"]);
});

test("no executor is bound by default: the port refuses rather than pretend to produce", async () => {
  const refused = await dispatchFabricationWork(unboundExecutor, workOrderOf());
  assert.equal(refused.type, "FabricationDispatchRefusal");
  assert.equal(refused.code, "EXECUTOR_UNBOUND");
  assert.equal((await dispatchFabricationWork(undefined, workOrderOf())).code, "EXECUTOR_UNBOUND");
  assert.equal((await dispatchFabricationWork(unboundExecutor, { type: "nope" })).code, "INVALID_WORK_ORDER");
});

test("dispatch: a fake executor's delivery is checked against the work order's artifact and specification; executor failure is a refusal", async () => {
  const workOrder = workOrderOf();
  const ok = await dispatchFabricationWork({ dispatch: (order) => deliveryFor(order) }, workOrder);
  assert.equal(ok.type, "FabricationDispatch");
  assert.equal(ok.lot, workOrder.lot);
  assert.equal((await dispatchFabricationWork({ dispatch: async (order) => ({ ...(await deliveryFor(order)), artifactId: "svg-chart-0000000000000000" }) }, workOrder)).code, "DELIVERY_BINDING_MISMATCH");
  const failed = await dispatchFabricationWork({ dispatch: () => { throw new Error("session lost"); } }, workOrder);
  assert.equal(failed.code, "EXECUTOR_FAILED");
  assert.match(failed.message, /session lost/u);
});

test("carrierExecutor makes an agent-harness carrier a port: the host allocates the duty, the carrier runs it, the outcome carries the delivery", async () => {
  const seen = [];
  const carrier = async (item) => { seen.push(item); return { result: { value: { output: await deliveryFor(item.workOrder) } } }; };
  const executor = carrierExecutor({ carrier, allocate: (workOrder) => ({ allocation: "allocation-1", scope: workOrder.lot, workOrder }) });
  const dispatched = await dispatchFabricationWork(executor, workOrderOf());
  assert.equal(dispatched.type, "FabricationDispatch");
  assert.equal(seen[0].allocation, "allocation-1");
  assert.throws(() => carrierExecutor({ carrier }), TypeError);
  const empty = await dispatchFabricationWork(carrierExecutor({ carrier: async () => ({ result: { value: {} } }), allocate: () => ({}) }), workOrderOf());
  assert.equal(empty.code, "EXECUTOR_FAILED");
});

test("produceFabrication: order -> work order -> dispatch -> assay -> receipt, and the market hears the outcome", async () => {
  const outcomes = [];
  const run = await produceFabrication(orderOf("svg-chart", EXAMPLE_INPUTS["svg-chart"], { budget: { amount: "$5.00" } }), { executor: { dispatch: (order) => deliveryFor(order) }, record: async (outcome) => { outcomes.push(outcome); }, now: NOW });
  assert.equal(run.outcome, "accepted");
  assert.equal(run.attempts.length, 1);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].outcome, "accepted");
  assert.equal(run.attempts[0].receipt.type, "FabricationDeliveryReceipt");
});

test("produceFabrication: a delivery that fails its assay is a refused outcome, recorded, and the work is placed again", async () => {
  const outcomes = []; let calls = 0; let earlier;
  const run = await produceFabrication(orderOf("svg-chart", EXAMPLE_INPUTS["svg-chart"]), {
    executor: { dispatch: async (order) => { calls += 1; earlier = order.earlierFailures; return deliveryFor(order, { good: calls > 1 }); } },
    record: async (outcome) => { outcomes.push(outcome.outcome); }, now: NOW,
  });
  assert.equal(run.outcome, "accepted");
  assert.deepEqual(outcomes, ["refused", "accepted"]);
  assert.equal(earlier[0].code, "ASSAY_FAILED", "the second attempt carries the first one's failures");
});

test("produceFabrication: three refused deliveries end not-accepted; an unrecordable book and an admission refusal are kept as the receipt", async () => {
  const bad = await produceFabrication(orderOf("svg-chart", EXAMPLE_INPUTS["svg-chart"]), { executor: { dispatch: (order) => deliveryFor(order, { good: false }) }, record: async () => { throw new Error("book closed"); }, now: NOW });
  assert.equal(bad.outcome, "not-accepted");
  assert.equal(bad.attempts.length, 3);
  assert.equal(bad.attempts[0].outcomeRecorded, "book closed");
  const refused = await produceFabrication(orderOf("svg-chart", {}), { now: NOW });
  assert.equal(refused.outcome, "refused-at-admission");
  assert.equal(refused.refusal.code, "MISSING_INPUTS");
  const unbound = await produceFabrication(orderOf("svg-chart", { spec: CHART_SPEC }), { now: NOW });
  assert.equal(unbound.outcome, "not-accepted");
  assert.equal(unbound.attempts[0].outcome, "dispatch-refused");
});
