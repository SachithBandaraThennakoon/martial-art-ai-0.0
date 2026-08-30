import assert from "node:assert/strict";
import test from "node:test";

import {
  getPracticeCueDeadlineMs,
  getPracticeCueDelayMs,
  summarizePracticeSourceTiming
} from "../src/utils/practiceTiming.js";

test("cue deadlines stay anchored when a prior callback runs late", () => {
  assert.equal(
    getPracticeCueDeadlineMs({
      scheduleStartedAtMs: 1000,
      cueNumber: 3,
      countGapMs: 2000
    }),
    5000
  );
  assert.equal(
    getPracticeCueDelayMs({
      nowMs: 3275,
      scheduleStartedAtMs: 1000,
      cueNumber: 3,
      countGapMs: 2000
    }),
    1725
  );
});

test("source timing exposes duplicated 30 fps capture over a sparse camera stream", () => {
  const summary = summarizePracticeSourceTiming([
    { sourceTimestampMs: 1000 },
    { sourceTimestampMs: 1000 },
    { sourceTimestampMs: 1200 },
    { sourceTimestampMs: 1200 },
    { sourceTimestampMs: 1400 }
  ]);

  assert.deepEqual(summary, {
    recordedFrames: 5,
    uniqueSourceFrames: 3,
    duplicateFrameRatio: 0.4,
    effectiveFps: 5,
    medianSourceGapMs: 200,
    p90SourceGapMs: 200,
    maxSourceGapMs: 200
  });
});
