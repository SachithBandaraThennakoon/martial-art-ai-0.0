import assert from "node:assert/strict";
import test from "node:test";

import { shouldLoadTemporalPredictor } from "../src/performance/studioPerformanceConfig.js";

test("temporal ONNX waits for an active session with reliable tracking", () => {
  const base = {
    enabled: true,
    sessionActive: true,
    sessionPaused: false,
    trackingConfidence: 0.9
  };

  assert.equal(shouldLoadTemporalPredictor(base), true);
  assert.equal(shouldLoadTemporalPredictor({ ...base, enabled: false }), false);
  assert.equal(shouldLoadTemporalPredictor({ ...base, sessionActive: false }), false);
  assert.equal(shouldLoadTemporalPredictor({ ...base, sessionPaused: true }), false);
  assert.equal(
    shouldLoadTemporalPredictor({ ...base, trackingConfidence: 0.64 }),
    false
  );
});
