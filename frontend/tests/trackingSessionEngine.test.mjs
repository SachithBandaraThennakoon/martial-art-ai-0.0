import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createTechniquePackage } from "../src/tracking/techniquePackage.js";
import {
  REPETITION_STATES,
  SESSION_STATES,
  TrackingSessionEngine
} from "../src/tracking/trackingSessionEngine.js";
import { loadTechniqueSource } from "./helpers/loadTechniqueSource.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const techniqueRoot = path.resolve(testDirectory, "../../backend/data/techniques");

async function loadTechniquePackage(techniqueId) {
  return createTechniquePackage(
    await loadTechniqueSource(techniqueRoot, techniqueId)
  );
}

function feed(engine, timestamps, features, trackingConfidence = 0.96) {
  return timestamps.map((timestampMs) =>
    engine.updateFeatures({
      timestampMs,
      features,
      trackingConfidence
    })
  );
}

const JAB = {
  guard: {
    lead_elbow_angle: 90,
    lead_wrist_guard_distance: 0.2,
    rear_wrist_guard_distance: 0.2,
    torso_lean: 4,
    motion_energy: 0.01
  },
  extension: {
    lead_elbow_angle: 125,
    lead_elbow_angular_velocity: 100,
    lead_wrist_forward_velocity: 0.5,
    rear_wrist_guard_distance: 0.2,
    torso_lean: 5,
    motion_energy: 0.1
  },
  fullExtension: {
    lead_elbow_angle: 160,
    lead_wrist_forward_velocity: 0.02,
    rear_wrist_guard_distance: 0.2,
    torso_lean: 5,
    motion_energy: 0.05
  },
  retraction: {
    lead_elbow_angle: 130,
    lead_elbow_angular_velocity: -100,
    lead_wrist_forward_velocity: -0.3,
    rear_wrist_guard_distance: 0.2,
    motion_energy: 0.08
  },
  recovery: {
    lead_elbow_angle: 95,
    lead_wrist_guard_distance: 0.22,
    rear_wrist_guard_distance: 0.2,
    motion_energy: 0.015
  }
};

test("v2 packages keep a requested model in shadow mode", async () => {
  const source = await loadTechniqueSource(techniqueRoot, "jab");
  source.manifest.temporal_inference.source = "onnx";
  const engine = new TrackingSessionEngine(createTechniquePackage(source));

  const warmingFrames = [0, 40, 80, 120].map((timestampMs) =>
    engine.updateFeatures({
      timestampMs,
      features: JAB.guard,
      trackingConfidence: 0.96,
      learnedModelExpected: true
    })
  );
  assert.equal(warmingFrames.at(-1).step, "GUARD");
  assert.equal(warmingFrames.at(-1).temporal_inference_source, "rules");

  const learnedFrames = [160, 200, 240, 280].map((timestampMs) =>
    engine.updateFeatures({
      timestampMs,
      features: {},
      trackingConfidence: 0.96,
      learnedModelExpected: true,
      learnedStatePrediction: {
        state: "GUARD",
        confidence: 0.96,
        probabilities: { __UNKNOWN__: 0.01, GUARD: 0.96 }
      }
    })
  );
  assert.equal(learnedFrames.at(-1).step, "GUARD");
  assert.equal(learnedFrames.at(-1).learned_model_mode, "shadow");
});

test("catalog rule mode keeps Jab independent from learned predictions", async () => {
  const engine = new TrackingSessionEngine(
    await loadTechniquePackage("jab"),
    { mode: "practice" }
  );
  const frames = [0, 40, 80, 120].map((timestampMs) =>
    engine.updateFeatures({
      timestampMs,
      features: JAB.guard,
      trackingConfidence: 0.96,
      learnedModelExpected: true,
      learnedStatePrediction: {
        state: "FULL_EXTENSION",
        confidence: 0.99,
        probabilities: { FULL_EXTENSION: 0.99 }
      }
    })
  );

  assert.equal(frames.at(-1).step, "GUARD");
  assert.equal(frames.at(-1).canonical_phase, "PREPARATION");
  assert.equal(frames.at(-1).learned_model_mode, "shadow");
  assert.equal(frames.at(-1).temporal_inference_source, "rules");
});

test("admin both mode keeps rules primary and exposes learned shadow scores", async () => {
  const engine = new TrackingSessionEngine(
    await loadTechniquePackage("jab"),
    { mode: "practice", analysisEngine: "both" }
  );
  const frame = [0, 40, 80, 120].map((timestampMs) =>
    engine.updateFeatures({
      timestampMs,
      features: JAB.guard,
      trackingConfidence: 0.96,
      learnedStatePrediction: {
        state: "FULL_EXTENSION",
        confidence: 0.99,
        probabilities: { FULL_EXTENSION: 0.99 }
      }
    })
  ).at(-1);

  assert.equal(frame.step, "GUARD");
  assert.equal(frame.analysis_engine, "both");
  assert.equal(frame.temporal_inference_source, "rules");
  assert.equal(frame.learned_model_mode, "shadow");
  assert.equal(frame.model_state_scores.FULL_EXTENSION, 0.99);
  assert.deepEqual(frame.shadow_state_scores, frame.model_state_scores);
});

test("admin model mode cannot override v2 production decisions", async () => {
  const engine = new TrackingSessionEngine(
    await loadTechniquePackage("jab"),
    { mode: "practice", analysisEngine: "model" }
  );
  const frame = [0, 40, 80, 120].map((timestampMs) =>
    engine.updateFeatures({
      timestampMs,
      features: JAB.fullExtension,
      trackingConfidence: 0.96,
      learnedModelExpected: true,
      learnedStatePrediction: {
        state: "GUARD",
        confidence: 0.98,
        probabilities: { GUARD: 0.98 }
      }
    })
  ).at(-1);

  assert.equal(frame.step, "GUARD");
  assert.equal(frame.analysis_engine, "model");
  assert.equal(frame.temporal_inference_source, "rules");
  assert.equal(frame.learned_model_mode, "shadow");
  assert.deepEqual(frame.model_state_scores, { GUARD: 0.98, EXTENSION: 0, FULL_EXTENSION: 0, RETRACTION: 0, RECOVERY: 0 });
});

test("catalog rule mode normalizes the Jab entry transition", async () => {
  const engine = new TrackingSessionEngine(
    await loadTechniquePackage("jab"),
    { mode: "practice" }
  );
  feed(engine, [0, 40, 80, 120], JAB.guard);

  const entryCandidate = feed(engine, [300], JAB.extension).at(-1);
  assert.equal(entryCandidate.step, "GUARD");
  assert.equal(entryCandidate.canonical_phase, "PREPARATION");

  const entryConfirmed = feed(engine, [360], JAB.extension).at(-1);
  assert.equal(entryConfirmed.step, "EXTENSION");
  assert.equal(entryConfirmed.canonical_phase, "EXTENSION");

  const execution = feed(engine, [400], JAB.extension).at(-1);
  assert.equal(execution.step, "EXTENSION");
  assert.equal(execution.canonical_phase, "EXTENSION");
});

test("whole-session engine produces repetition boundaries and final summary", async () => {
  const engine = new TrackingSessionEngine(
    await loadTechniquePackage("jab"),
    { mode: "practice" }
  );
  engine.start(0);

  const ready = feed(engine, [0, 40, 80, 120], JAB.guard).at(-1);
  assert.equal(ready.session_state, SESSION_STATES.ACTIVE);
  assert.equal(ready.rep_state, REPETITION_STATES.WAITING);

  engine.recordCue({ cue: 1, timestampMs: 250 });
  const started = feed(engine, [300, 360], JAB.extension).at(-1);
  assert.equal(started.rep_id, 1);
  assert.equal(started.rep_state, REPETITION_STATES.REP_STARTED);
  assert.equal(started.cue_timing_ms, 50);

  feed(engine, [430, 470], JAB.fullExtension);
  feed(engine, [540, 570, 600], JAB.retraction);
  feed(engine, [680, 720, 760, 800], JAB.recovery);
  const completed = feed(engine, [920, 960, 1000, 1040], JAB.guard).at(-1);
  assert.equal(completed.rep_state, REPETITION_STATES.WAITING);

  const lost = engine.updateFeatures({
    timestampMs: 1080,
    features: JAB.guard,
    trackingConfidence: 0.2
  });
  assert.equal(lost.session_state, SESSION_STATES.ACTIVE);
  assert.equal(lost.detector.tracking_gap_tolerated, true);
  const recovered = engine.updateFeatures({
    timestampMs: 1120,
    features: JAB.guard,
    trackingConfidence: 0.96
  });
  assert.equal(recovered.session_state, SESSION_STATES.ACTIVE);

  const summary = engine.end(1200);
  assert.equal(summary.session_state, SESSION_STATES.SESSION_COMPLETE);
  assert.equal(summary.total_repetitions, 1);
  assert.equal(summary.completed_repetitions, 1);
  assert.equal(summary.aborted_repetitions, 0);
  assert.equal(summary.average_response_time_ms, 50);
  assert.ok(summary.average_accuracy > 0);
  assert.equal(summary.post_session_corrected, false);
  assert.equal(summary.corrected_timeline, null);
  assert.equal(summary.raw_timeline.tracking_loss_intervals.length, 0);
  assert.ok(summary.raw_timeline.frames.length > 0);
  assert.ok(summary.raw_timeline.events.some(
    (event) => event.type === "repetition_completed"
  ));
});

test("ending an active session preserves an incomplete repetition as aborted", async () => {
  const engine = new TrackingSessionEngine(await loadTechniquePackage("jab"));
  feed(engine, [0, 40, 80, 120], JAB.guard);
  feed(engine, [300, 360], JAB.extension);

  const summary = engine.end(500);
  assert.equal(summary.total_repetitions, 1);
  assert.equal(summary.completed_repetitions, 0);
  assert.equal(summary.aborted_repetitions, 1);
  assert.equal(summary.repetitions[0].status, "session_ended");
});

test("a paused whole-session engine freezes transitions until it resumes", async () => {
  const engine = new TrackingSessionEngine(await loadTechniquePackage("jab"));
  feed(engine, [0, 40, 80, 120], JAB.guard);

  engine.pause(150);
  const frameBeforePause = engine.timeline.getTimeline().frames.length;
  const paused = feed(engine, [180, 220, 260], JAB.extension).at(-1);
  assert.equal(engine.sessionState, SESSION_STATES.PAUSED);
  assert.equal(engine.timeline.getTimeline().frames.length, frameBeforePause);
  assert.equal(paused.step, "GUARD");

  engine.resume(300);
  const resumed = feed(engine, [320, 380], JAB.extension).at(-1);
  assert.equal(engine.sessionState, SESSION_STATES.ACTIVE);
  assert.equal(resumed.rep_id, 1);
  assert.equal(resumed.step, "EXTENSION");
});

test("Jab session analysis confirms persistent hand and face errors", async () => {
  const engine = new TrackingSessionEngine(
    await loadTechniquePackage("jab"),
    { mode: "practice" }
  );
  const auxiliaryErrors = {
    lead_fist_closure_score: 20,
    rear_fist_closure_score: 25,
    face_forward_score: 30
  };

  feed(engine, [0, 40, 80, 120], JAB.guard);
  feed(engine, [300, 360], { ...JAB.extension, ...auxiliaryErrors });
  feed(engine, [420, 480, 540, 600, 660, 720, 780], {
    ...JAB.extension,
    ...auxiliaryErrors
  });

  const errorIds = new Set(
    engine.errorEvaluator.getOccurrences().map((error) => error.error_id)
  );
  assert.equal(errorIds.has("open_lead_hand_during_strike"), true);
  assert.equal(errorIds.has("open_rear_guard_hand"), true);
  assert.equal(errorIds.has("looking_away_during_strike"), true);
});

test("missing optional hand and face data does not create Jab form errors", async () => {
  const engine = new TrackingSessionEngine(
    await loadTechniquePackage("jab"),
    { mode: "practice" }
  );

  feed(engine, [0, 40, 80, 120], JAB.guard);
  feed(engine, [300, 360, 420, 480, 540, 600, 660, 720], JAB.extension);

  const optionalErrorIds = new Set([
    "open_lead_hand_during_strike",
    "open_rear_guard_hand",
    "looking_away_during_strike"
  ]);
  assert.equal(
    engine.errorEvaluator.getOccurrences().some(
      (error) => optionalErrorIds.has(error.error_id)
    ),
    false
  );
});

test("serialized null hand and face evidence remains unavailable", async () => {
  const engine = new TrackingSessionEngine(
    await loadTechniquePackage("jab"),
    { mode: "practice" }
  );
  const missingAuxiliaryEvidence = {
    lead_fist_closure_score: null,
    rear_fist_closure_score: null,
    face_forward_score: null
  };

  feed(engine, [0, 40, 80, 120], { ...JAB.guard, ...missingAuxiliaryEvidence });
  feed(engine, [300, 360, 420, 480, 540, 600, 660, 720], {
    ...JAB.extension,
    ...missingAuxiliaryEvidence
  });

  const falseErrorIds = new Set([
    "open_lead_hand_during_strike",
    "open_rear_guard_hand",
    "looking_away_during_strike"
  ]);
  assert.equal(
    engine.errorEvaluator.getOccurrences().some(
      (error) => falseErrorIds.has(error.error_id)
    ),
    false
  );
});
