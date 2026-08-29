export function buildCoachSessionConfigPacket({
  sessionConfig = {},
  stepKey,
  stepName,
  requiredParts = []
}) {
  return {
    ...sessionConfig,
    type: "session_config",
    step_key: stepKey,
    step_name: stepName,
    required_parts: requiredParts
  };
}

export function buildCoachTrainingFramePacket({ stepId, stepName, angles }) {
  return {
    type: "training_frame",
    step_id: stepId,
    step_name: stepName,
    angles
  };
}
