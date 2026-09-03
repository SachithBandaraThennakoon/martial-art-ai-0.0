import assert from "node:assert/strict";
import test from "node:test";

import { OutboundPeakReturnDetector } from "../src/tracking/detectors/outboundPeakReturnDetector.js";

const detectorConfig = {
  start: {
    all: [
      { feature: "axis_velocity", operator: "gte", value: 0.2 },
      { feature: "elbow_velocity", operator: "gte", value: 20 }
    ],
    confirmation: { min_frames: 2, min_ms: 40 }
  },
  peak: {
    signal: "axis_velocity",
    exit_velocity: -0.03,
    confirmation: { min_frames: 1, min_ms: 0 }
  },
  return: {
    feature: "guard_distance",
    operator: "lte",
    value: 0.65,
    confirmation: { min_frames: 2, min_ms: 40 }
  },
  minimum_rep_ms: 200,
  maximum_rep_ms: 1200,
  minimum_inter_rep_ms: 100,
  tracking_gap: { maximum_ms: 120, strategy: "hold" }
};

function createDetector() {
  return new OutboundPeakReturnDetector(detectorConfig);
}

function frame(axis_velocity, elbow_velocity, guard_distance) {
  return { axis_velocity, elbow_velocity, guard_distance };
}

function feed(detector, samples) {
  return samples.flatMap(([timestampMs, features, trackingConfidence = 0.96]) =>
    detector.update({
      timestampMs,
      features,
      trackingConfidence,
      trackingThreshold: 0.55
    }).events
  );
}

function oneRep(startMs = 0, peakScale = 1) {
  return [
    [startMs, frame(0, 0, 0.3)],
    [startMs + 50, frame(0.35 * peakScale, 60 * peakScale, 0.5)],
    [startMs + 100, frame(0.45 * peakScale, 80 * peakScale, 0.8)],
    [startMs + 180, frame(-0.12, -50, 0.85)],
    [startMs + 260, frame(-0.25, -80, 0.62)],
    [startMs + 310, frame(-0.08, -25, 0.4)]
  ];
}

test("outbound-peak-return detects five ordered non-overlapping attempts", () => {
  const detector = createDetector();
  const samples = Array.from({ length: 5 }, (_, index) => oneRep(index * 500)).flat();
  const events = feed(detector, samples);
  const starts = events.filter((event) => event.type === "REP_START");
  const peaks = events.filter((event) => event.type === "PEAK");
  const ends = events.filter((event) => event.type === "REP_END");
  assert.equal(starts.length, 5);
  assert.equal(peaks.length, 5);
  assert.equal(ends.length, 5);
  starts.forEach((start, index) => {
    assert.ok(start.timestamp_ms < peaks[index].timestamp_ms);
    assert.ok(peaks[index].timestamp_ms < ends[index].timestamp_ms);
    if (index) assert.ok(ends[index - 1].timestamp_ms < start.timestamp_ms);
  });
});

test("smaller but meaningful outbound motion remains a detected attempt", () => {
  const events = feed(createDetector(), oneRep(0, 0.75));
  assert.equal(events.filter((event) => event.type === "REP_END").length, 1);
});

test("a short direction reversal cannot complete a Jab practice repetition", () => {
  const detector = new OutboundPeakReturnDetector({
    ...detectorConfig,
    minimum_rep_ms: 450
  });
  const events = feed(detector, oneRep());

  assert.equal(events.some((event) => event.type === "REP_START"), true);
  assert.equal(events.some((event) => event.type === "REP_END"), false);
});

test("small noisy movement is not a repetition", () => {
  const events = feed(createDetector(), [
    [0, frame(0.02, 3, 0.31)],
    [50, frame(0.08, 8, 0.34)],
    [100, frame(-0.04, -5, 0.32)],
    [150, frame(0.03, 4, 0.31)]
  ]);
  assert.equal(events.some((event) => event.type === "REP_START"), false);
});

test("an extension without return is retained as an active detected attempt", () => {
  const detector = createDetector();
  const events = feed(detector, oneRep().slice(0, 4));
  assert.equal(events.filter((event) => event.type === "REP_START").length, 1);
  assert.equal(events.filter((event) => event.type === "PEAK").length, 1);
  assert.equal(events.some((event) => event.type === "REP_END"), false);
  assert.equal(detector.state, "RETURNING");
});

test("an 80 ms tracking gap preserves one repetition", () => {
  const detector = createDetector();
  const events = feed(detector, [
    [0, frame(0, 0, 0.3)],
    [50, frame(0.35, 60, 0.5)],
    [100, frame(0.45, 80, 0.8)],
    [140, frame(0, 0, 0.8), 0.2],
    [220, frame(-0.12, -50, 0.85)],
    [280, frame(-0.25, -80, 0.6)],
    [330, frame(-0.08, -25, 0.4)]
  ]);
  assert.equal(events.filter((event) => event.type === "REP_START").length, 1);
  assert.equal(events.filter((event) => event.type === "REP_END").length, 1);
});

test("a session that opens with the arm extended must return to guard before counting", () => {
  const detector = new OutboundPeakReturnDetector({
    ...detectorConfig,
    ready: {
      feature: "guard_distance",
      operator: "lte",
      value: 0.65,
      confirmation: { min_frames: 2, min_ms: 40 }
    },
    maximum_rep_ms: 2400
  });
  const events = feed(detector, [
    [0, frame(0, 0, 1.3)],
    [50, frame(0.5, 60, 1.2)],
    [100, frame(0.4, 50, 1.1)],
    [200, frame(-0.8, -80, 0.62)],
    [250, frame(-0.2, -20, 0.58)],
    ...oneRep(400)
  ]);
  assert.equal(events.filter((event) => event.type === "REP_START").length, 1);
  assert.equal(events.filter((event) => event.type === "REP_END").length, 1);
});

function sampledRep(fps) {
  const intervalMs = 1000 / fps;
  const samples = [];
  for (let timestampMs = 0; timestampMs <= 800; timestampMs += intervalMs) {
    let features = frame(0, 0, 0.35);
    if (timestampMs >= 200 && timestampMs < 400) {
      features = frame(0.42, 70, 0.82);
    } else if (timestampMs >= 400 && timestampMs < 620) {
      features = frame(-0.2, -55, timestampMs < 520 ? 0.84 : 0.55);
    }
    samples.push([Number(timestampMs.toFixed(3)), features]);
  }
  return samples;
}

test("timestamp-based confirmation produces the same rep at 15 and 30 fps", () => {
  const counts = [15, 30].map((fps) => {
    const events = feed(createDetector(), sampledRep(fps));
    return {
      starts: events.filter((event) => event.type === "REP_START").length,
      ends: events.filter((event) => event.type === "REP_END").length
    };
  });

  assert.deepEqual(counts, [
    { starts: 1, ends: 1 },
    { starts: 1, ends: 1 }
  ]);
});

test("a completed Jab must settle in guard before a new extension can start", () => {
  const detector = new OutboundPeakReturnDetector({
    ...detectorConfig,
    ready: {
      feature: "lead_wrist_guard_distance",
      operator: "lte",
      value: 0.65,
      confirmation: { min_frames: 2, min_ms: 40 }
    },
    start: {
      ...detectorConfig.start,
      minimum_guard_excursion: 0.08,
      minimum_elbow_extension: 6
    }
  });
  const sample = (axis, elbowVelocity, guard, elbowAngle) => ({
    ...frame(axis, elbowVelocity, guard),
    lead_wrist_guard_distance: guard,
    lead_elbow_angle: elbowAngle
  });
  const events = feed(detector, [
    [0, sample(0, 0, 0.4, 100)],
    [50, sample(0, 0, 0.4, 100)],
    [150, sample(0.4, 60, 0.6, 115)],
    [200, sample(0.5, 70, 0.85, 140)],
    [280, sample(-0.15, -40, 0.9, 145)],
    [400, sample(-0.25, -60, 0.58, 120)],
    [450, sample(-0.08, -20, 0.42, 105)],
    // Immediate retraction bounce: not enough stable guard time to re-arm.
    [500, sample(0, 0, 0.4, 103)],
    [550, sample(0.35, 40, 0.58, 110)],
    [650, sample(0, 0, 0.4, 102)],
    [700, sample(0, 0, 0.4, 102)],
    // Stable-guard jitter lacks meaningful displacement and elbow extension.
    [800, sample(0.3, 35, 0.43, 104)],
    [850, sample(0.32, 38, 0.44, 105)],
    // A real second extension still counts.
    [1100, sample(0.4, 60, 0.62, 116)],
    [1150, sample(0.5, 70, 0.9, 142)],
    [1230, sample(-0.15, -40, 0.92, 145)],
    [1360, sample(-0.25, -60, 0.58, 120)],
    [1410, sample(-0.08, -20, 0.42, 105)]
  ]);

  assert.equal(events.filter((event) => event.type === "REP_START").length, 2);
  assert.equal(events.filter((event) => event.type === "REP_END").length, 2);
});
