import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAcpForecastBands,
  getAcpHorizonBaseWeight,
  reliabilityFromPoseError,
  summarizeAcpTrajectory
} from "../src/temporal/acpForecastPolicy.js";

function pose(wristOffset = 0) {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  landmarks[11] = { x: 0.4, y: 0.35, z: 0 };
  landmarks[12] = { x: 0.6, y: 0.35, z: 0 };
  landmarks[23] = { x: 0.44, y: 0.65, z: 0 };
  landmarks[24] = { x: 0.56, y: 0.65, z: 0 };
  landmarks[15] = { x: 0.4 + wristOffset, y: 0.5, z: 0 };
  landmarks[16] = { x: 0.6, y: 0.5, z: 0 };
  return landmarks;
}

function predictedFrames() {
  return Array.from({ length: 30 }, (_, index) => {
    const horizonFrame = index + 1;
    const triangularOffset = horizonFrame <= 15
      ? horizonFrame * 0.012
      : (30 - horizonFrame) * 0.012;
    return {
      horizon_frame: horizonFrame,
      horizon_ms: horizonFrame * (1000 / 30),
      landmarks: pose(triangularOffset)
    };
  });
}

test("ACP policy exposes consumer-specific 6, 12, 9, and 30-frame bands", () => {
  const bands = buildAcpForecastBands({
    frames: predictedFrames(),
    sourceLandmarks: pose(),
    trackingConfidence: 1
  });

  assert.equal(bands.level1.frames.length, 6);
  assert.equal(bands.level2.frames.length, 12);
  assert.equal(bands.awareness.frames.length, 9);
  assert.equal(bands.awareness.frames[0].horizon_frame, 4);
  assert.equal(bands.level3.frames.length, 30);
});

test("ACP policy reduces trust as the prediction horizon grows", () => {
  assert.ok(getAcpHorizonBaseWeight(1) > getAcpHorizonBaseWeight(12));
  assert.ok(getAcpHorizonBaseWeight(12) > getAcpHorizonBaseWeight(30));
  assert.ok(reliabilityFromPoseError(0.02) > reliabilityFromPoseError(0.3));
});

test("ACP trajectory summary preserves fast hand motion and recognizes a return", () => {
  const frames = predictedFrames().map((frame) => ({ ...frame, weight: 0.8 }));
  const summary = summarizeAcpTrajectory(frames, pose());

  assert.equal(summary.intent, "movement_likely");
  assert.equal(summary.peak_horizon_frame, 15);
  assert.equal(summary.return_likely, true);
});
