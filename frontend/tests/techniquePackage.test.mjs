import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createTechniquePackage,
  TechniquePackageValidationError,
  validateTechniquePackage
} from "../src/tracking/techniquePackage.js";
import {
  loadTechniqueSource,
  loadTechniqueTrainingConfig
} from "./helpers/loadTechniqueSource.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const trackingRoot = path.resolve(
  testDirectory,
  "../../backend/data/techniques"
);

for (const techniqueId of ["jab", "front-kick"]) {
  test(`${techniqueId} tracking package is internally valid`, async () => {
    const source = await loadTechniqueSource(trackingRoot, techniqueId);
    assert.equal(validateTechniquePackage(source), true);

    const techniquePackage = createTechniquePackage(source);
    assert.equal(techniquePackage.id, techniqueId);
    assert.equal(techniquePackage.getMode("train").live_corrections, true);
    assert.equal(techniquePackage.getMode("practice").post_session_correction, true);
  });
}

test("Jab only accepts its configured ordered transitions", async () => {
  const techniquePackage = createTechniquePackage(
    await loadTechniqueSource(trackingRoot, "jab")
  );

  assert.equal(techniquePackage.canTransition("GUARD", "EXTENSION"), true);
  assert.equal(techniquePackage.canTransition("EXTENSION", "FULL_EXTENSION"), true);
  assert.equal(techniquePackage.canTransition("GUARD", "FULL_EXTENSION"), false);
  assert.equal(techniquePackage.canTransition("FULL_EXTENSION", "RECOVERY"), false);
  assert.equal(techniquePackage.getTemporalInferenceSource(), "rules");
  assert.equal(techniquePackage.getCanonicalPhase("GUARD"), "PREPARATION");
  assert.equal(
    techniquePackage.getCanonicalPhase("EXTENSION", {
      from_state: "GUARD",
      to_state: "EXTENSION"
    }),
    "ENTRY"
  );
});

test("temporal inference configuration rejects unsupported sources", async () => {
  const source = await loadTechniqueSource(trackingRoot, "jab");
  source.manifest.temporal_inference.source = "unknown-model";

  assert.throws(
    () => validateTechniquePackage(source),
    (error) => {
      assert.ok(error instanceof TechniquePackageValidationError);
      assert.match(error.message, /temporal_inference\.source/);
      return true;
    }
  );
});

test("invalid technique packages return actionable validation issues", async () => {
  const source = await loadTechniqueSource(trackingRoot, "jab");
  source.transitions.transitions.EXTENSION.allowed = ["NOT_A_STATE"];

  assert.throws(
    () => validateTechniquePackage(source),
    (error) => {
      assert.ok(error instanceof TechniquePackageValidationError);
      assert.match(error.message, /unknown state/);
      return true;
    }
  );
});

test("offline decoder configuration rejects invalid duration values", async () => {
  const source = await loadTechniqueSource(trackingRoot, "jab");
  source.modes.practice.offline_decoder.unknown_min_duration_ms = -1;

  assert.throws(
    () => validateTechniquePackage(source),
    (error) => {
      assert.ok(error instanceof TechniquePackageValidationError);
      assert.match(error.message, /unknown_min_duration_ms must be non-negative/);
      return true;
    }
  );
});

test("every Jab angle target has a valid ideal inside its range", async () => {
  const document = await loadTechniqueTrainingConfig(trackingRoot, "jab");

  for (const step of document.steps) {
    assert.ok(step.angle_targets.length > 0);
    for (const target of step.angle_targets) {
      assert.ok(
        target.target_angle >= target.min &&
          target.target_angle <= target.max,
        `${step.step_name}: ${target.body_part} target must be inside its range`
      );
    }
  }
});

test("Jab teaching targets and temporal rules agree on safe progression", async () => {
  const document = await loadTechniqueTrainingConfig(trackingRoot, "jab");
  const [, extension, recovery] = document.steps;
  const leadExtension = extension.angle_targets.find(
    (target) => target.body_part === "elbow_left"
  );
  const recoveryFists = recovery.quality_targets.filter((target) =>
    ["fist_left", "fist_right"].includes(target.feature)
  );
  const fullExtensionRule = document.temporal_runtime.states.states.FULL_EXTENSION
    .enter_rules.all.find((rule) => rule.feature === "lead_elbow_angle");
  const insufficientExtension = document.temporal_runtime.errors.errors.find(
    (error) => error.id === "insufficient_extension"
  );
  const excessiveExtension = document.temporal_runtime.errors.errors.find(
    (error) => error.id === "excessive_elbow_extension"
  );
  const droppedGuard = document.temporal_runtime.errors.errors.find(
    (error) => error.id === "dropped_guard"
  );
  const rearGuardTarget = extension.non_angle_features.find(
    (target) => target.feature === "rear_wrist_guard_distance"
  );

  assert.equal(leadExtension.mastery_required, true);
  assert.equal(leadExtension.hard_max, 177);
  assert.ok(fullExtensionRule.min < leadExtension.min);
  assert.ok(fullExtensionRule.max >= excessiveExtension.condition.value);
  assert.ok(insufficientExtension.condition.value >= 150);
  assert.ok(rearGuardTarget.value < droppedGuard.condition.value);
  assert.ok(recoveryFists.every((target) => target.target >= 70 && target.min >= 70));
  assert.ok(document.steps.every((step) => step.transition_duration_ms > 0));
  assert.ok(document.steps.every((step) => step.transition_condition));
  assert.ok(document.steps.every((step) => step.mastery_requirements.minimum_coverage >= 50));
});
