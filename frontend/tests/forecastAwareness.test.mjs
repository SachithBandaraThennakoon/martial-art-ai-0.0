import assert from "node:assert/strict";
import test from "node:test";

import { deriveForecastAwareness } from "../src/temporal/forecastAwareness.js";
import { SituationAwarenessLayer } from "../src/situationAwareness/SituationAwarenessLayer.js";

function elbowPose(angleDeg) {
  const radians = angleDeg * (Math.PI / 180);
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1
  }));
  landmarks[11] = { x: 0.4, y: 0.5, z: 0, visibility: 1 };
  landmarks[13] = { x: 0.5, y: 0.5, z: 0, visibility: 1 };
  landmarks[15] = {
    x: 0.5 - Math.cos(radians) * 0.1,
    y: 0.5 + Math.sin(radians) * 0.1,
    z: 0,
    visibility: 1
  };
  return landmarks;
}

function prediction(angles) {
  return {
    source: "onnx",
    status: "ready_stabilized",
    prediction_horizon_ms: 1000,
    future_landmark_frames: angles.map((angle, index) => ({
      horizon_ms: (index + 1) * 100,
      landmarks: elbowPose(angle)
    }))
  };
}

test("trusted sustained future angle violations produce a forecast warning", () => {
  const forecast = deriveForecastAwareness({
    prediction: prediction([90, 95, 120, 130, 140, 150, 155, 160, 160, 160]),
    requiredParts: [{ body_part: "elbow_left", min: 50, max: 105 }],
    trackingConfidence: 0.94,
    predictionConfidence: 0.91,
    agreementError: 0.02,
    sourceCounts: { level2: 1 }
  });

  assert.equal(forecast.status, "trusted");
  assert.equal(forecast.trusted, true);
  assert.equal(forecast.likely_mistake.body_part, "elbow_left");
  assert.equal(forecast.likely_mistake.issue, "too_open");
  assert.ok(forecast.risk >= 0.62);
});

test("a disagreeing forecast cannot affect awareness", () => {
  const forecast = deriveForecastAwareness({
    prediction: prediction([130, 140, 150, 160, 160, 160]),
    requiredParts: [{ body_part: "elbow_left", min: 50, max: 105 }],
    trackingConfidence: 0.94,
    predictionConfidence: 0.91,
    agreementError: 0.2,
    sourceCounts: { level2: 2 }
  });

  assert.equal(forecast.trusted, false);
  assert.equal(forecast.status, "untrusted");
  assert.equal(forecast.risk, 0);
  assert.equal(forecast.likely_mistake, null);
});

test("situation awareness emits non-blocking guidance for a trusted future risk", () => {
  const layer = new SituationAwarenessLayer({ updateIntervalMs: 0 });
  const update = (timestamp) => layer.update({
    level1State: { timestamp, tracking: { confidence: 0.95 } },
    level2State: {
      action_context: {
        mistake_risk: 0.2,
        likely_mistake: null,
        forecast_awareness: {
          trusted: true,
          risk: 0.82,
          horizon_ms: 1000,
          agreement_error: 0.02,
          likely_mistake: {
            body_part: "elbow_left",
            issue: "too_open",
            first_risk_ms: 500
          }
        }
      }
    },
    level3State: {
      session_context: {
        fatigue_risk: 0.1,
        mastery_score: 0.4,
        recommendation: "continue",
        trend: "stable"
      }
    },
    level4State: {
      user_context: { progression: {}, personalization: {} }
    }
  });
  update(1);
  update(1.45);
  const state = update(1.9);

  assert.equal(state.situation_context.situation_state, "anticipating");
  assert.equal(state.situation_context.raw_state, "anticipating");
  assert.equal(state.situation_context.feedback_decision.type, "predictive_guidance");
  assert.equal(state.situation_context.feedback_decision.should_pause_progression, false);
  assert.equal(state.situation_context.next_action.command, "prepare_correction");
});

test("advance-ready awareness remains advisory until composite mastery confirms the step", () => {
  const layer = new SituationAwarenessLayer({ updateIntervalMs: 0 });
  const update = (timestamp) => layer.update({
    level1State: { timestamp, tracking: { confidence: 0.95 } },
    level2State: {
      action_context: { mistake_risk: 0.1, likely_mistake: null, forecast_awareness: {} }
    },
    level3State: {
      session_context: {
        consistency_score: 0.9,
        fatigue_risk: 0.1,
        mastery_score: 0.9,
        recommendation: "progress",
        trend: "stable"
      }
    },
    level4State: {
      user_context: { progression: { ready_for_next_technique: true }, personalization: {} }
    }
  });
  update(1);
  update(1.45);
  update(1.9);
  const state = update(2.35);

  assert.equal(state.situation_context.situation_state, "advance_ready");
  assert.equal(state.situation_context.feedback_decision.type, "mastery_candidate");
  assert.equal(state.situation_context.feedback_decision.should_speak, false);
  assert.equal(state.situation_context.next_action.command, "verify_mastery");
  assert.equal(state.situation_context.next_action.allow_next_step, false);
});

test("mixed raw labels produce correction feedback only after one target forms a stable cluster", () => {
  const layer = new SituationAwarenessLayer({ updateIntervalMs: 0 });
  const update = (timestamp, correcting) => layer.update({
    level1State: { timestamp, tracking: { confidence: 0.94 } },
    level2State: {
      action_context: {
        technique_name: "Jab",
        current_step_id: "extend",
        mistake_risk: correcting ? 0.74 : 0.2,
        likely_mistake: correcting
          ? { body_part: "elbow_left", issue: "too_closed" }
          : null,
        forecast_awareness: {}
      }
    },
    level3State: {
      session_context: {
        fatigue_risk: 0.1,
        mastery_score: 0.35,
        recommendation: "continue",
        trend: "stable"
      }
    },
    level4State: {
      user_context: { progression: {}, personalization: {} }
    }
  });

  const first = update(1, true);
  update(1.3, false);
  update(1.6, true);
  update(1.75, false);
  const stable = update(2.2, true);

  assert.equal(first.situation_context.raw_state, "correcting");
  assert.equal(first.situation_context.stable_state, "observing");
  assert.equal(first.situation_context.feedback_decision.should_speak, false);
  assert.equal(stable.situation_context.raw_state, "correcting");
  assert.equal(stable.situation_context.stable_state, "correcting");
  assert.equal(stable.situation_context.stability.cluster.support, 3);
  assert.equal(stable.situation_context.feedback_decision.type, "correction");
  assert.equal(stable.situation_context.attention_target.body_part, "elbow_left");
});

test("an explicit tracking-lost phase outranks fatigue and correction decisions", () => {
  const layer = new SituationAwarenessLayer({ updateIntervalMs: 0 });
  const state = layer.update({
    level1State: { timestamp: 1, tracking: { confidence: 0.54 } },
    level2State: {
      action_context: {
        mistake_risk: 0.9,
        likely_mistake: { body_part: "elbow_left", issue: "too_open" },
        temporal_segmentation: { motion_phase: "tracking_lost" },
        forecast_awareness: {}
      }
    },
    level3State: {
      session_context: {
        fatigue_risk: 0.9,
        mastery_score: 0.5,
        recommendation: "slow_down",
        trend: "dropping"
      }
    },
    level4State: { user_context: { progression: {}, personalization: {} } }
  });

  assert.equal(state.situation_context.situation_state, "tracking_unclear");
  assert.equal(state.situation_context.attention_target.body_part, "camera");
  assert.equal(state.situation_context.next_action.command, "fix_tracking");
});

test("sustained tracking interruption suppresses feedback and asks once after stable return", () => {
  const layer = new SituationAwarenessLayer({ updateIntervalMs: 0 });
  const update = (timestamp, confidence) => layer.update({
    level1State: { timestamp, tracking: { confidence } },
    level2State: {
      action_context: { mistake_risk: 0.1, likely_mistake: null, forecast_awareness: {} }
    },
    level3State: {
      session_context: {
        fatigue_risk: 0.1,
        mastery_score: 0.4,
        recommendation: "continue",
        trend: "stable"
      }
    },
    level4State: { user_context: { progression: {}, personalization: {} } }
  });

  update(1, 0.2);
  const held = update(3.2, 0.2);
  const distracted = update(6.1, 0.2);
  const returning = update(6.5, 0.9);
  const resumed = update(7.6, 0.9);
  const engaged = update(8.1, 0.9);

  assert.equal(held.situation_context.situation_state, "attention_hold");
  assert.equal(held.situation_context.feedback_decision.should_speak, false);
  assert.equal(distracted.situation_context.situation_state, "attention_paused");
  assert.equal(returning.situation_context.situation_state, "returning");
  assert.equal(resumed.situation_context.situation_state, "resume_ready");
  assert.equal(resumed.situation_context.feedback_decision.message, "Ready to continue?");
  assert.equal(resumed.situation_context.next_action.command, "confirm_resume");
  assert.equal(engaged.situation_context.situation_state, "observing");
});
