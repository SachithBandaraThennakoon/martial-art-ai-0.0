import assert from "node:assert/strict";
import test from "node:test";

import { sampleUniformPoseFrames } from "../src/temporal/uniformFrameSampler.js";

const frame = (timestamp, x) => ({
  timestamp,
  landmarks: [{ x, y: x * 2, z: 0, visibility: 1 }]
});

test("ACP-STGAT input is resampled from 15 FPS to a uniform 30 FPS cadence", () => {
  const sampled = sampleUniformPoseFrames(
    [frame(0, 0), frame(1 / 15, 2), frame(2 / 15, 4)],
    5,
    30
  );

  assert.deepEqual(
    sampled.map((item) => Number(item.timestamp.toFixed(4))),
    [0, 0.0333, 0.0667, 0.1, 0.1333]
  );
  assert.deepEqual(
    sampled.map((item) => Number(item.landmarks[0].x.toFixed(4))),
    [0, 1, 2, 3, 4]
  );
});

test("missing model history is padded with the earliest available pose", () => {
  const sampled = sampleUniformPoseFrames([frame(1, 0.5)], 3, 30);

  assert.equal(sampled.length, 3);
  assert.deepEqual(sampled.map((item) => item.landmarks[0].x), [0.5, 0.5, 0.5]);
  assert.equal(sampled[2].timestamp, 1);
});
