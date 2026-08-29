import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDegreeAwareAngleFeedback,
  revalidateQueuedAngleFeedback
} from "../src/services/feedbackMessageFormatter.js";

test("small angle corrections speak a rounded degree adjustment", () => {
  const feedback = formatDegreeAwareAngleFeedback({
    bodyPart: "knee_left",
    current: 143,
    ideal: 125,
    min: 115,
    max: 135,
    kind: "angle"
  });

  assert.equal(feedback.voiceMessage, "Bend your lead knee about 20 degrees.");
  assert.equal(
    feedback.displayMessage,
    "Lead knee: 143° → target 115–135° (ideal 125°, adjustment −20°)."
  );
  assert.equal(feedback.details.adjustment_degrees, -20);
});

test("large angle corrections state current and ideal degrees concisely", () => {
  const feedback = formatDegreeAwareAngleFeedback({
    bodyPart: "elbow_left",
    current: 112,
    ideal: 165,
    min: 155,
    max: 177,
    kind: "angle"
  });

  assert.equal(feedback.voiceMessage, "Lead elbow: 112 degrees. Aim for 165.");
  assert.ok(feedback.voiceMessage.split(/\s+/).length <= 9);
  assert.deepEqual(feedback.details.target_range, [155, 177]);
  assert.equal(feedback.details.adjustment_degrees, 55);
});

test("queued angle feedback is refreshed from current measurements", () => {
  const result = revalidateQueuedAngleFeedback(
    { kind: "angle", body_part: "elbow_left" },
    {
      situationAwarenessState: {
        situation_context: {
          stable_state: "correcting",
          attention_target: { body_part: "elbow_left" }
        }
      },
      compositeForm: {
        corrections: [{
          bodyPart: "elbow_left",
          current: 130,
          ideal: 165,
          min: 155,
          max: 177,
          kind: "angle"
        }]
      }
    }
  );

  assert.equal(result.valid, true);
  assert.equal(result.formatted.voiceMessage, "Lead elbow: 130 degrees. Aim for 165.");
});

test("queued angle feedback is discarded after resolution or target change", () => {
  const base = {
    situationAwarenessState: {
      situation_context: {
        stable_state: "correcting",
        attention_target: { body_part: "elbow_left" }
      }
    },
    compositeForm: { corrections: [] }
  };
  assert.equal(
    revalidateQueuedAngleFeedback({ kind: "angle", body_part: "elbow_left" }, base).reason,
    "angle_resolved"
  );
  assert.equal(
    revalidateQueuedAngleFeedback(
      { kind: "angle", body_part: "shoulder_left" },
      base
    ).reason,
    "stable_target_changed"
  );
});
