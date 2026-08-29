import test from "node:test";
import assert from "node:assert/strict";

import {
  createDiagnosticTraceRecorder,
  downloadDiagnosticTrace
} from "../src/services/diagnosticTraceRecorder.js";

test("diagnostic trace synchronizes the reasoning chain without recording every render", () => {
  let time = 1000;
  const recorder = createDiagnosticTraceRecorder({
    sampleIntervalMs: 200,
    now: () => time,
    wallClock: () => "2026-08-28T12:00:00.000Z"
  });
  recorder.start({ technique: "Jab" });

  const frame = {
    timestamp: time,
    filteredPose: [{ x: 0.123456, y: 0.5, z: -0.1, visibility: 0.95 }],
    trackingConfidence: 0.91,
    motionEnergy: 0.2,
    angles: { elbow_left: 87.345 },
    handPoints: {
      left: [{ x: 0.25, y: 0.4, z: 0, visibility: 0.8 }],
      right: null
    }
  };
  const context = {
    step: { id: "guard", index: 0, name: "Guard stance" },
    session: { active: true, paused: false, state: "ACTIVE" },
    compositeForm: {
      accuracy: 79,
      coverage: 90,
      scorable: true,
      corrections: [{
        bodyPart: "ankle_right",
        label: "Rear ankle",
        kind: "angle",
        direction: "decrease",
        current: 145,
        ideal: 115,
        min: 95,
        max: 130,
        score: 52,
        weight: 1.25
      }],
      groupScores: { balance: 52 }
    },
    masteryThreshold: 80,
    level1State: { motion_context: { phase: "stable" } },
    level2State: { action_context: { action: "guard" } },
    level3State: { session_context: { trend: "stable" } },
    level4State: { user_context: { experience: "guest" } },
    situationAwarenessState: {
      situation_context: {
        reasoning: { decision_score: 0.82 },
        next_action: { command: "correct" },
        feedback_decision: { action: "speak" }
      }
    }
  };

  assert.equal(recorder.frame(frame, context), true);
  time += 100;
  assert.equal(recorder.frame({ ...frame, timestamp: time }, context), false);
  time += 100;
  assert.equal(recorder.frame({ ...frame, timestamp: time }, context), true);
  recorder.event("user_response", { message: "next step" });
  recorder.stop();

  const document = recorder.document();
  const snapshots = document.records.filter((record) => record.type === "snapshot");
  const pipelineSnapshots = document.records.filter(
    (record) => record.type === "pipeline_snapshot"
  );
  assert.equal(document.schema, "xmartialart-diagnostic-trace/v1");
  assert.equal(snapshots.length, 2);
  assert.equal(pipelineSnapshots.length, 1);
  assert.equal(snapshots[0].perception.angles.elbow_left, 87.34);
  assert.deepEqual(snapshots[0].perception.pose[0], [0.1235, 0.5, -0.1, 0.95]);
  assert.deepEqual(snapshots[0].perception.hand_points.left[0], [0.25, 0.4, 0, 0.8]);
  assert.deepEqual(snapshots[0].perception.hand_points.right, []);
  assert.equal(snapshots[0].comparison.accuracy, 79);
  assert.equal(snapshots[0].comparison.corrections[0].ideal, 115);
  assert.equal(snapshots[0].comparison.corrections[0].direction, "decrease");
  assert.equal(snapshots[0].comparison.groups.balance, 52);
  assert.equal(snapshots[0].layers.level3.context.trend, "stable");
  assert.equal(snapshots[0].reasoning.decision_score, 0.82);
  assert.equal(snapshots[0].plan.command, "correct");
  assert.equal(
    pipelineSnapshots[0].pipeline.stage_2_target_comparison.composite_form.accuracy,
    79
  );
  assert.equal(
    pipelineSnapshots[0].pipeline.stage_6_level3_session.session_context.trend,
    "stable"
  );
  assert.equal(document.records.some((record) => record.kind === "user_response"), true);
});

test("full pipeline snapshots safely preserve debug arrays and circular state", () => {
  let time = 0;
  const recorder = createDiagnosticTraceRecorder({
    sampleIntervalMs: 200,
    pipelineIntervalMs: 1000,
    now: () => time,
    wallClock: () => "2026-08-28T12:00:00.000Z"
  });
  const level1State = {
    debug: { predictedFrames: [{ horizon_ms: 100, values: new Float32Array([0.1, 0.2]) }] }
  };
  level1State.debug.owner = level1State;
  recorder.start({ technique: "Jab" });
  recorder.frame({ timestamp: time, angles: {} }, { level1State });

  const pipeline = recorder.document().records.find(
    (record) => record.type === "pipeline_snapshot"
  ).pipeline;
  assert.deepEqual(
    pipeline.stage_3_level1_motion.debug.predictedFrames[0].values,
    [0.1, 0.2]
  );
  assert.equal(pipeline.stage_3_level1_motion.debug.owner, "[circular]");
  assert.doesNotThrow(() => JSON.stringify(recorder.document()));
});

test("diagnostic trace stays bounded during a long session", () => {
  let time = 0;
  const recorder = createDiagnosticTraceRecorder({
    sampleIntervalMs: 0,
    maxRecords: 4,
    now: () => time,
    wallClock: () => "2026-08-28T12:00:00.000Z"
  });
  recorder.start({ technique: "Jab" });
  for (let index = 0; index < 8; index += 1) {
    time += 1;
    recorder.event("tick", { index });
  }

  assert.equal(recorder.size(), 4);
  assert.deepEqual(
    recorder.document().records.map((record) => record.index),
    [4, 5, 6, 7]
  );
});

test("diagnostic download uses the browser document after building the trace", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalWorker = globalThis.Worker;
  const originalCompressionStream = globalThis.CompressionStream;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  let clicked = false;

  try {
    globalThis.Worker = undefined;
    globalThis.CompressionStream = undefined;
    globalThis.document = {
      createElement: () => ({
        click: () => {
          clicked = true;
        }
      })
    };
    globalThis.window = { setTimeout: (callback) => callback() };
    URL.createObjectURL = () => "blob:diagnostic-trace";
    URL.revokeObjectURL = () => {};

    await downloadDiagnosticTrace({
      document: () => ({ schema: "test", records: [] }),
      filename: () => "trace.json"
    });

    assert.equal(clicked, true);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.Worker = originalWorker;
    globalThis.CompressionStream = originalCompressionStream;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  }
});
