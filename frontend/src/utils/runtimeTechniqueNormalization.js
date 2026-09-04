export function normalizeRuntimeSteps(trainingConfig = {}) {
  return (trainingConfig.steps || []).map((step, index) => {
    const angleTargets = Array.isArray(step.angle_targets)
      ? step.angle_targets
      : [];
    const primaryAngles = angleTargets.filter((angle) => angle.role === "primary");
    const scoringAngles = Array.isArray(step.angles) && step.angles.length
      ? step.angles
      : (primaryAngles.length ? primaryAngles : angleTargets).map(
          (target) => ({
            body_part: target.body_part,
            min: target.min,
            max: target.max,
            ...(target.measurement_tolerance_deg != null
              ? { measurement_tolerance_deg: target.measurement_tolerance_deg }
              : {})
          })
        );

    return {
      ...step,
      difficulty_profiles:
        step.difficulty_profiles || trainingConfig.difficulty_profiles || null,
      step_number: step.step_number ?? index + 1,
      step_name: step.step_name || `Step ${index + 1}`,
      angles: scoringAngles
    };
  });
}
