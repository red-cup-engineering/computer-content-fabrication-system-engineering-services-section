import assert from "node:assert/strict";
import { test } from "node:test";
import { renderVegaLiteSpecAsSvg } from "@red-cup-engineering/chart-specification-rendering-service/render-vega-lite-spec-as-svg";
import { renderMarkdown, renderPasteHtml } from "@red-cup-engineering/email-newsletter-engineering-services-section";
import { address, truthReading } from "@red-cup-engineering/signcell/cell";
import { assayFabricatedArtifact } from "../src/assay.mjs";
import { CHART_SPEC, EXAMPLE_INPUTS, admitted, deliveryOf, sha256Hex } from "./helpers.mjs";

const verdictOf = (assay, id) => assay.verdicts.find((verdict) => verdict.assay === id);
const text = (projection, mediaType, value) => ({ projection, mediaType, text: value });

async function chartDelivery(admission, tamper) {
  const { svg } = await renderVegaLiteSpecAsSvg({ spec: CHART_SPEC });
  return deliveryOf(admission, [text("svg", "image/svg+xml", tamper ? svg.replace("<svg", "<svg data-x=\"1\"") : svg), { projection: "spec", mediaType: "application/json", json: CHART_SPEC }]);
}

test("svg-chart: validated, byte-deterministic, safe - one SignCell cell per assay and artifact, subject the artifact's ni", async () => {
  const admission = admitted("svg-chart", EXAMPLE_INPUTS["svg-chart"]);
  const assay = await assayFabricatedArtifact({ admission, delivery: await chartDelivery(admission) });
  assert.equal(assay.type, "FabricationAssayResult");
  assert.equal(assay.passed, true);
  assert.deepEqual(assay.verdicts.map(({ assay: id }) => id), ["vega-lite-valid", "svg-byte-deterministic", "svg-safe"]);
  const nis = new Set(assay.outputs.map(({ ni }) => ni));
  for (const cell of assay.cells) {
    assert.ok(nis.has(cell.subject), "the subject is a delivered artifact's ni");
    assert.equal(cell.object, admission.specification.specificationDigest);
    assert.equal(cell.for.length, 1);
    assert.deepEqual(cell.against, []);
    assert.equal(cell.for[0].assay, cell.predicate);
  }
  // vega-lite-valid and svg-byte-deterministic are traced to the chart and its spec; the JSON is addressed semantically
  assert.equal(assay.cells.filter((cell) => cell.predicate === "svg-byte-deterministic").length, 2);
  assert.match(assay.outputs.find(({ projection }) => projection === "spec").ni, /^ni:\/\/\/sha-256;/u);
  assert.equal(assay.verdicts.every(({ reading }) => reading === "true"), true);
});

test("svg-chart: an SVG that is not what the specification renders fails, and its cell is told against", async () => {
  const admission = admitted("svg-chart", EXAMPLE_INPUTS["svg-chart"]);
  const assay = await assayFabricatedArtifact({ admission, delivery: await chartDelivery(admission, true) });
  assert.equal(assay.passed, false);
  const verdict = verdictOf(assay, "svg-byte-deterministic");
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reading, "false");
  const cell = assay.cells.find((item) => item.predicate === "svg-byte-deterministic");
  assert.deepEqual(cell.for, []);
  assert.equal(cell.against.length, 1);
  assert.equal(address(cell), verdict.cells[0] ?? address(cell));
  assert.equal(truthReading(cell), "false");
});

test("svg-safe: script, event handlers, foreign objects and external references fail", async () => {
  const admission = admitted("svg-chart", EXAMPLE_INPUTS["svg-chart"]);
  for (const bad of ['<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>', '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>', "<html></html>"]) {
    const assay = await assayFabricatedArtifact({ admission, delivery: deliveryOf(admission, [text("svg", "image/svg+xml", bad), { projection: "spec", mediaType: "application/json", json: CHART_SPEC }]) });
    assert.equal(verdictOf(assay, "svg-safe").ok, false, bad);
  }
});

test("delivery frame: missing, unexpected and mistyped projections, a wrong binding and a malformed output are refused", async () => {
  const admission = admitted("svg-chart", EXAMPLE_INPUTS["svg-chart"]);
  const good = await chartDelivery(admission);
  const code = async (delivery) => (await assayFabricatedArtifact({ admission, delivery })).code;
  assert.equal(await code({ ...good, outputs: good.outputs.slice(1) }), "MISSING_PROJECTION");
  assert.equal(await code({ ...good, outputs: [...good.outputs, text("extra", "text/plain", "x")] }), "UNEXPECTED_PROJECTION");
  assert.equal(await code({ ...good, outputs: [text("svg", "text/plain", "x"), good.outputs[1]] }), "MEDIA_TYPE_MISMATCH");
  assert.equal(await code({ ...good, outputs: [...good.outputs, good.outputs[0]] }), "DUPLICATE_PROJECTION");
  assert.equal(await code({ ...good, specificationDigest: "ni:///sha-256;" + "A".repeat(43) }), "DELIVERY_BINDING_MISMATCH");
  assert.equal(await code({ ...good, outputs: [{ projection: "svg", mediaType: "image/svg+xml", text: "x", json: {} }, good.outputs[1]] }), "INVALID_DELIVERY");
  assert.equal((await assayFabricatedArtifact({ admission: { ...admission, orderDocument: "tampered" }, delivery: good })).code, "ORDER_DOCUMENT_MISMATCH");
  assert.equal((await assayFabricatedArtifact({ admission: { ...admission, specification: { ...admission.specification, requirements: [] } }, delivery: good })).code, "INVALID_SPECIFICATION");
});

const LEAN_SOURCE = "import Mathlib\ntheorem add_comm_example (a b : Nat) : a + b = b + a := by\n  omega\n";
const leanCheck = (over = {}) => ({ kind: "metroplat.lean.check-result", id: "t", state: "succeeded", inspection: { declaration: "add_comm_example", axioms: ["propext"], dependencies: [] }, ...over });
const leanDelivery = (admission, source, check) => deliveryOf(admission, [text("proof", "text/x-lean4", source), { projection: "check", mediaType: "application/json", json: check }]);

test("lean-proof: a clean lean-check of the stated theorem is accepted", async () => {
  const admission = admitted("lean-proof", EXAMPLE_INPUTS["lean-proof"]);
  const assay = await assayFabricatedArtifact({ admission, delivery: leanDelivery(admission, LEAN_SOURCE, leanCheck()) });
  assert.equal(assay.passed, true, JSON.stringify(assay.verdicts));
  assert.deepEqual(assay.verdicts.map(({ assay: id }) => id), ["lean-check-clean", "statement-unchanged", "axioms-allowed"]);
});

test("lean-proof: a failed check, a changed statement, sorry and a foreign axiom are each caught", async () => {
  const admission = admitted("lean-proof", EXAMPLE_INPUTS["lean-proof"]);
  const run = async (source, check) => assayFabricatedArtifact({ admission, delivery: leanDelivery(admission, source, check) });
  assert.equal(verdictOf(await run(LEAN_SOURCE, leanCheck({ state: "failed" })), "lean-check-clean").ok, false);
  assert.equal(verdictOf(await run(LEAN_SOURCE.replace("a + b = b + a", "a + b = a + b"), leanCheck()), "statement-unchanged").ok, false);
  assert.equal(verdictOf(await run(LEAN_SOURCE.replace("omega", "sorry"), leanCheck()), "axioms-allowed").ok, false);
  assert.equal(verdictOf(await run(LEAN_SOURCE, leanCheck({ inspection: { declaration: "add_comm_example", axioms: ["propext", "sorryAx"], dependencies: [] } })), "axioms-allowed").ok, false);
  assert.equal(verdictOf(await run(LEAN_SOURCE, leanCheck({ inspection: { declaration: "add_comm_example", axioms: ["Classical.choice", "myAxiom"], dependencies: [] } })), "axioms-allowed").ok, false);
  assert.equal(verdictOf(await run(LEAN_SOURCE, leanCheck({ inspection: { declaration: "other", axioms: [], dependencies: [] } })), "axioms-allowed").ok, false);
  // a sorry that only appears in a comment is not a sorry
  assert.equal(verdictOf(await run(`${LEAN_SOURCE}-- no sorry here\n`, leanCheck()), "axioms-allowed").ok, true);
});

const ISSUE = { title: "This week", dek: "Three notes.", sections: [{ heading: "One", "body-markdown": "A claim [@a].", sources: ["a"] }], references: { a: { id: "a", type: "webpage", title: "A source", URL: "https://example.org/a" } } };
const issueDelivery = (admission, issue, over = {}) => deliveryOf(admission, [
  { projection: "issue", mediaType: "application/json", json: issue },
  text("markdown", "text/markdown", over.markdown ?? renderMarkdown(issue)),
  text("html", "text/html", over.html ?? renderPasteHtml(issue)),
]);

test("newsletter-issue: the email-newsletter section validates the issue and its renderings reproduce", async () => {
  const admission = admitted("newsletter-issue", EXAMPLE_INPUTS["newsletter-issue"]);
  const ok = await assayFabricatedArtifact({ admission, delivery: issueDelivery(admission, ISSUE) });
  assert.equal(ok.passed, true, JSON.stringify(ok.verdicts));
  const drifted = await assayFabricatedArtifact({ admission, delivery: issueDelivery(admission, ISSUE, { markdown: "# edited by hand\n" }) });
  assert.equal(verdictOf(drifted, "renderings-reproduce").ok, false);
  const broken = await assayFabricatedArtifact({ admission, delivery: issueDelivery(admission, { ...ISSUE, sections: [{ heading: "One", "body-markdown": "x", sources: ["missing"] }] }, { markdown: "x\n", html: "<p>x</p>" }) });
  assert.equal(verdictOf(broken, "issue-valid").ok, false);
});

test("fiction-serial: the manifest validates and the fiction issue renders reproducibly", async () => {
  const admission = admitted("fiction-serial", EXAMPLE_INPUTS["fiction-serial"]);
  const issue = { canon: "c", serial: "s", episode: 1, title: "Arrival", previously: "", body: "She arrived.", next: "Tomorrow.", access: "free" };
  const assay = await assayFabricatedArtifact({ admission, delivery: issueDelivery(admission, issue) });
  assert.equal(assay.passed, true, JSON.stringify(assay.verdicts));
  const badManifest = admitted("fiction-serial", { ...EXAMPLE_INPUTS["fiction-serial"], manifest: { canon: "c" } });
  const refused = await assayFabricatedArtifact({ admission: badManifest, delivery: issueDelivery(badManifest, issue) });
  assert.equal(verdictOf(refused, "serial-manifest-valid").ok, false);
});

test("ebook: acceptance is the ebook section's, on an independent proof; the bytes must be the ones its record names", async () => {
  const admission = admitted("ebook", EXAMPLE_INPUTS.ebook);
  const epub = Buffer.from("epub-bytes"); const pdf = Buffer.from("pdf-bytes");
  const edition = { type: "EbookEditionFabricationResult", status: "fabricated-awaiting-acceptance", artifacts: { epub: { sha256: sha256Hex(epub) }, screenPdf: { sha256: `sha256:${sha256Hex(pdf)}` } } };
  const outputs = [{ projection: "epub", mediaType: "application/epub+zip", bytesBase64: epub.toString("base64") }, { projection: "screen-pdf", mediaType: "application/pdf", bytesBase64: pdf.toString("base64") }, { projection: "edition", mediaType: "application/json", json: edition }];
  const accepted = []; const ports = { ebook: { accept: (fabrication, proof) => { accepted.push([fabrication, proof]); return { status: proof.proofer === proof.writer ? "refused" : "accepted", code: "PROOFER_IS_WRITER" }; } } };
  const proof = { type: "EbookEditionProof", proofer: "reader", writer: "author" };
  const good = await assayFabricatedArtifact({ admission, delivery: deliveryOf(admission, outputs, { proof }) }, { ports });
  assert.equal(good.passed, true, JSON.stringify(good.verdicts));
  assert.equal(accepted[0][0].type, "EbookEditionFabricationResult");
  const self = await assayFabricatedArtifact({ admission, delivery: deliveryOf(admission, outputs, { proof: { ...proof, proofer: "author" } }) }, { ports });
  assert.equal(verdictOf(self, "edition-accepted").ok, false);
  const swapped = await assayFabricatedArtifact({ admission, delivery: deliveryOf(admission, [{ ...outputs[0], bytesBase64: Buffer.from("other").toString("base64") }, outputs[1], outputs[2]], { proof }) }, { ports });
  assert.equal(verdictOf(swapped, "edition-bytes-addressed").ok, false);
  const unbound = await assayFabricatedArtifact({ admission, delivery: deliveryOf(admission, outputs, { proof }) });
  assert.equal(verdictOf(unbound, "edition-accepted").ok, false);
});

test("corpus-research-paper: the corpus assay reads CAIRN through a port and counts distinct records", async () => {
  const admission = admitted("corpus-research-paper", { ...EXAMPLE_INPUTS["corpus-research-paper"], minimumRecords: 2 });
  const records = (ids, corpus = "sociology") => ({ projection: "corpus-citations", mediaType: "application/json", json: { corpus, records: ids.map((id) => ({ id })) } });
  const ports = { readCorpusRecord: async ({ corpus, id }) => ({ exists: corpus === "sociology" && id !== "ghost" }) };
  const base = (extra) => deliveryOf(admission, ["pdf", "html", "docx", "jats", "claims", "provenance"].map((projection) => text(projection, { pdf: "application/pdf", html: "text/html", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", jats: "application/jats+xml", claims: "application/json", provenance: "application/ld+json" }[projection], "x")).concat(extra));
  const run = async (extra, p = ports) => verdictOf(await assayFabricatedArtifact({ admission, delivery: base(extra) }, { ports: p }), "corpus-grounded");
  assert.equal((await run(records(["r1", "r2"]))).ok, true);
  assert.equal((await run(records(["r1", "r1"]))).ok, false, "one distinct record is below the minimum");
  assert.equal((await run(records(["r1", "ghost"]))).ok, false, "a record absent from the corpus");
  assert.equal((await run(records(["r1", "r2"], "governance"))).ok, false, "citations of another corpus");
  assert.equal((await run(records(["r1", "r2"]), {})).ok, false, "no reader bound");
});

test("a profile assay with no check is refused, not passed", async () => {
  const { kindProfiles } = await import("../src/kinds.mjs");
  const admission = admitted("svg-chart", EXAMPLE_INPUTS["svg-chart"]);
  const profile = kindProfiles().get("svg-chart");
  const profiles = new Map([["svg-chart", { ...profile, assays: [...profile.assays, { id: "mystery-check", statement: "x", uses: [] }] }]]);
  const refused = await assayFabricatedArtifact({ admission, delivery: await chartDelivery(admission) }, { profiles });
  assert.equal(refused.code, "UNKNOWN_ASSAY");
});
