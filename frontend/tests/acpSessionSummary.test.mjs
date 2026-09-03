import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAcpSessionSummary,
  compactAcpFrameEvidence
} from "../src/temporal/acpSessionSummary.js";

const forecast = {
  model_name: "ACP-STGAT",
  status: "ready_stabilized",
  bands: {
    level1: { start_frame: 1, end_frame: 6, summary: { intent: "movement_likely", confidence: 0.9 } },
    level2: { start_frame: 1, end_frame: 12, summary: { intent: "movement_likely", confidence: 0.75 } },
    awareness: { start_frame: 4, end_frame: 12, summary: { intent: "movement_likely", confidence: 0.7 } },
    level3: { start_frame: 1, end_frame: 30, summary: { intent: "movement_likely", confidence: 0.55 } }
  }
};

test("ACP frame evidence stays compact and marks transitions advisory", () => {
  const evidence = compactAcpFrameEvidence({
    acpForecast: forecast,
    forecastAwareness: { trusted: true, risk: 0.6 },
    predictedTransition: { transition: "completion_candidate", confidence: 0.7 }
  });

  assert.equal(evidence.bands.level1.available_frames, 0);
  assert.equal(evidence.transition.advisory_only, true);
  assert.equal(evidence.warning.trusted, true);
});

test("ACP session summary reports coverage without claiming repetitions", () => {
  const readyEvidence = compactAcpFrameEvidence({
    acpForecast: forecast,
    predictedTransition: { transition: "completion_candidate", confidence: 0.7 }
  });
  const summary = buildAcpSessionSummary([
    { acpEvidence: readyEvidence },
    { acpEvidence: readyEvidence },
    { acpEvidence: { ...readyEvidence, status: "loading" } },
    {}
  ]);

  assert.equal(summary.forecast_samples, 2);
  assert.equal(summary.coverage_percentage, 50);
  assert.equal(summary.dominant_transition, "completion_candidate");
  assert.equal(summary.affects_rep_count, false);
});

test("ACP session summary ignores duplicated 30 FPS tape samples", () => {
  const readyEvidence = compactAcpFrameEvidence({ acpForecast: forecast });
  const summary = buildAcpSessionSummary([
    { sourceTimestampMs: 100, acpEvidence: readyEvidence },
    { sourceTimestampMs: 100, acpEvidence: readyEvidence },
    { sourceTimestampMs: 200, acpEvidence: readyEvidence }
  ]);

  assert.equal(summary.observed_samples, 2);
  assert.equal(summary.forecast_samples, 2);
  assert.equal(summary.coverage_percentage, 100);
});
