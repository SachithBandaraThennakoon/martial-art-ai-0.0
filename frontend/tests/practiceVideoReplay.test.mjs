import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPracticeVideoReplayFrames,
  isUsablePracticeVideoReplay
} from "../src/utils/practiceVideoReplay.js";

const pose = (wristX) => Array.from({ length: 33 }, (_, index) => ({
  x: index === 15 ? wristX : 0.5,
  y: 0.5,
  z: 0,
  visibility: 0.95
}));

test("recorded-video poses become timestamped authoritative tape evidence", () => {
  const steps = [
    { angles: [{ body_part: "elbow_left", min: 70, max: 110 }] },
    { angles: [{ body_part: "elbow_left", min: 150, max: 177 }] }
  ];
  const frames = buildPracticeVideoReplayFrames({
    captureOffsetMs: 1200,
    steps,
    frames: [
      { elapsedMs: 0, pose: pose(0.4), angles: { elbow_left: 90 }, trackingConfidence: 0.95 },
      { elapsedMs: 67, pose: pose(0.7), angles: { elbow_left: 165 }, trackingConfidence: 0.95 }
    ]
  });

  assert.equal(frames[0].elapsedMs, 1200);
  assert.equal(frames[1].sourceTimestampMs, 1267);
  assert.equal(frames[0].displayPoseSource, "recorded-video");
  assert.equal(frames[0].stepScores[0] > frames[0].stepScores[1], true);
  assert.equal(frames[1].stepScores[1] > frames[1].stepScores[0], true);
  assert.equal(frames[1].motionScore > 0, true);
});

test("video replay requires enough unique analyzed frames", () => {
  const good = isUsablePracticeVideoReplay({
    durationMs: 4000,
    frames: Array.from({ length: 60 }, () => ({}))
  });
  const sparse = isUsablePracticeVideoReplay({
    durationMs: 4000,
    frames: Array.from({ length: 12 }, () => ({}))
  });

  assert.equal(good.usable, true);
  assert.equal(good.effectiveFps, 15);
  assert.equal(sparse.usable, false);
});
