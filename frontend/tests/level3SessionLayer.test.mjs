import assert from "node:assert/strict";
import test from "node:test";

import {
  getPredictedSessionTransition,
  Level3SessionLayer
} from "../src/temporal/level3SessionLayer.js";

function states(timestamp, {
  score = 0.9,
  mistakeRisk = 0.05,
  motionEnergy = 0.02,
  mistake = null,
  techniqueName = "Jab"
} = {}) {
  return {
    level1State: {
      timestamp,
      tracking: { confidence: 0.95 }
    },
    level2State: {
      action_context: {
        technique_name: techniqueName,
        step_probability: score,
        mistake_risk: mistakeRisk,
        motion_energy: motionEnergy,
        likely_mistake: mistake
      }
    },
    techniqueName
  };
}

test("Level 3 waits for a session trend before recommending progression", () => {
  const layer = new Level3SessionLayer({ updateIntervalMs: 0, minSamplesForDecision: 3 });

  const first = layer.update(states(0));
  const second = layer.update(states(0.5));
  const third = layer.update(states(1));

  assert.equal(first.session_context.recommendation, "collecting");
  assert.equal(second.session_context.ready_for_level_4, false);
  assert.equal(third.session_context.recommendation, "advance_step");
  assert.equal(third.session_context.ready_for_level_4, true);
  assert.equal(third.debug.samples, 3);
});

test("Level 3 honors a configured fatigue threshold", () => {
  const layer = new Level3SessionLayer({
    updateIntervalMs: 0,
    minSamplesForDecision: 1,
    fatigueRiskThreshold: 0.2
  });

  const state = layer.update(states(1, { mistakeRisk: 0.5 }));

  assert.equal(state.session_context.recommendation, "slow_down");
  assert.equal(state.session_context.session_state, "fatigue_watch");
});

test("Level 3 clears session evidence when the technique changes", () => {
  const layer = new Level3SessionLayer({ updateIntervalMs: 0, minSamplesForDecision: 2 });

  layer.update(states(1, { techniqueName: "Jab" }));
  const jab = layer.update(states(2, { techniqueName: "Jab" }));
  const kick = layer.update(states(3, { techniqueName: "Front Kick" }));

  assert.equal(jab.debug.samples, 2);
  assert.equal(kick.debug.samples, 1);
  assert.equal(kick.session_context.technique_name, "Front Kick");
  assert.equal(kick.session_context.recommendation, "collecting");
});

test("Level 3 detects a repeated session mistake", () => {
  const layer = new Level3SessionLayer({
    updateIntervalMs: 0,
    minSamplesForDecision: 3,
    repeatedMistakeMinCount: 3
  });
  const mistake = { body_part: "left_elbow", issue: "too_open" };

  layer.update(states(1, { score: 0.5, mistake }));
  layer.update(states(2, { score: 0.5, mistake }));
  const state = layer.update(states(3, { score: 0.5, mistake }));

  assert.deepEqual(state.session_context.repeated_mistake, {
    body_part: "left_elbow",
    issue: "too_open",
    count: 3
  });
  assert.equal(state.session_context.recommendation, "repeat_step");
});

test("Level 3 captures sparse events even between scoring updates", () => {
  const layer = new Level3SessionLayer({ updateIntervalMs: 1000 });
  const firstInput = states(1);
  firstInput.level2State.action_context.temporal_segmentation = {
    motion_phase: "preparation"
  };
  layer.update(firstInput);

  const eventInput = states(1.2);
  eventInput.level2State.action_context.temporal_segmentation = {
    motion_phase: "peak_extension",
    event: {
      id: "1200:1",
      type: "peak_extension",
      timestamp_ms: 1200
    }
  };
  const throttledState = layer.update(eventInput);
  const nextState = layer.update(states(2));

  assert.equal(throttledState.debug.samples, 1);
  assert.equal(nextState.session_context.latest_event.type, "peak_extension");
  assert.equal(nextState.session_context.event_counts.peak_extension, 1);
});

test("Level 3 excludes tracking-loss frames from mastery and fatigue history", () => {
  const layer = new Level3SessionLayer({ updateIntervalMs: 0, minSamplesForDecision: 2 });
  const reliable = states(1, { score: 0.8, mistakeRisk: 0.1 });
  layer.update(reliable);

  const lost = states(2, { score: 0.1, mistakeRisk: 1, motionEnergy: 1 });
  lost.level1State.tracking.confidence = 0.54;
  lost.level2State.action_context.temporal_segmentation = {
    motion_phase: "tracking_lost"
  };
  const ignored = layer.update(lost);
  const recovered = layer.update(states(3, { score: 0.8, mistakeRisk: 0.1 }));

  assert.equal(ignored.debug.tracking_sample_ignored, true);
  assert.equal(ignored.debug.samples, 1);
  assert.equal(recovered.debug.samples, 2);
  assert.ok(recovered.session_context.fatigue_risk < 0.2);
});

test("Level 3 treats a full-horizon return as an advisory completion candidate", () => {
  const transition = getPredictedSessionTransition(
    { temporal_segmentation: { motion_phase: "peak_extension" } },
    {
      intent: "movement_likely",
      return_likely: true,
      confidence: 0.78,
      peak_eta_ms: 466
    }
  );

  assert.equal(transition.transition, "completion_candidate");
  assert.equal(transition.next_phase, "recovery");
  assert.equal(transition.advisory_only, true);
});

test("Level 3 does not turn a forecast into an observed repetition", () => {
  const layer = new Level3SessionLayer({ updateIntervalMs: 0, minSamplesForDecision: 1 });
  const input = states(1);
  input.level2State.action_context.temporal_segmentation = { motion_phase: "peak_extension" };
  input.acpForecast = {
    model_name: "ACP-STGAT",
    status: "ready",
    bands: {
      level3: {
        horizon_ms: 1000,
        frames: Array.from({ length: 30 }),
        summary: {
          intent: "movement_likely",
          return_likely: true,
          confidence: 0.8,
          peak_eta_ms: 500
        }
      }
    }
  };

  const state = layer.update(input);

  assert.equal(state.session_context.predicted_transition.transition, "completion_candidate");
  assert.equal(state.session_context.repetition_summary.repetitions_completed, 0);
});
