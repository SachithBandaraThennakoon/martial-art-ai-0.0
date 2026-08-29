import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStepTransitionFeedback,
  parseTrainingStepCommand
} from "../src/utils/trainingStepNavigation.js";

test("natural voice commands navigate training steps", () => {
  assert.deepEqual(parseTrainingStepCommand("move to the next step", 3), {
    type: "delta",
    delta: 1
  });
  assert.deepEqual(parseTrainingStepCommand("go back one previous step", 3), {
    type: "delta",
    delta: -1
  });
  assert.deepEqual(parseTrainingStepCommand("move to step 3", 3), {
    type: "index",
    index: 2
  });
});

test("step transition feedback is short and actionable", () => {
  const message = buildStepTransitionFeedback({
    fromStep: { step_name: "Guard stance" },
    toStep: {
      step_name: "Extend lead hand",
      angle_targets: [
        {
          body_part: "elbow_left",
          label: "Lead elbow extension",
          target_angle: 151,
          role: "primary"
        },
        {
          body_part: "knee_left",
          label: "Bent front knee",
          target_angle: 125,
          role: "supporting"
        }
      ],
      non_angle_features: [
        { feature: "lead_wrist_forward_velocity", label: "Lead wrist travels forward quickly" }
      ]
    },
    form: {
      accuracy: 84,
      coverage: 91,
      scorable: true,
      strengths: [
        {
          bodyPart: "knee_right",
          label: "Long rear leg",
          current: 164,
          ideal: 165
        }
      ]
    }
  });

  assert.equal(message, "Next: Extend lead hand.");
  assert.ok(message.split(/\s+/).length <= 4);
});

test("return-to-guard steps are described as recovery rather than initial stance", () => {
  assert.equal(
    buildStepTransitionFeedback({
      fromStep: { step_name: "Extend lead hand" },
      toStep: { step_name: "Return to guard" }
    }),
    "Next: Return to guard."
  );
});
