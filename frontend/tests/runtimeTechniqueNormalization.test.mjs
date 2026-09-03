import test from "node:test";
import assert from "node:assert/strict";

import { normalizeRuntimeSteps } from "../src/utils/runtimeTechniqueNormalization.js";

test("runtime Practice scoring uses primary angles and keeps supporting evidence optional", () => {
  const [step] = normalizeRuntimeSteps({
    difficulty_profiles: { medium: { tolerance_scale: 1 } },
    steps: [{
      step_number: 1,
      step_name: "Extend lead hand",
      angle_targets: [
        { body_part: "elbow_left", min: 155, max: 177, role: "primary" },
        { body_part: "ankle_right", min: 95, max: 130, role: "supporting" }
      ]
    }]
  });

  assert.deepEqual(step.angles, [
    { body_part: "elbow_left", min: 155, max: 177 }
  ]);
  assert.equal(step.angle_targets.length, 2);
  assert.deepEqual(step.difficulty_profiles, { medium: { tolerance_scale: 1 } });
});

test("legacy runtime steps retain explicit angles", () => {
  const angles = [{ body_part: "elbow_left", min: 150, max: 180 }];
  const [step] = normalizeRuntimeSteps({ steps: [{ angles }] });
  assert.equal(step.angles, angles);
});
