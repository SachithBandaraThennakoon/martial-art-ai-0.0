const GENERIC_TARGETS = new Set(["whole_body", "whole_form", "camera"]);

const roundToFive = (value) => Math.round(Number(value) / 5) * 5;
const roundAngle = (value) => Math.round(Number(value));

function angleLabel(bodyPart = "") {
  const side = bodyPart.endsWith("_left")
    ? "lead"
    : bodyPart.endsWith("_right")
      ? "rear"
      : "";
  const joint = bodyPart.replace(/_(left|right)$/, "").replace(/_/g, " ");
  return `${side} ${joint}`.trim();
}

function adjustmentVerb(bodyPart, difference) {
  if (/elbow/.test(bodyPart)) return difference > 0 ? "Extend" : "Bend";
  if (/knee/.test(bodyPart)) return difference > 0 ? "Straighten" : "Bend";
  if (/hip|shoulder/.test(bodyPart)) return difference > 0 ? "Open" : "Close";
  return difference > 0 ? "Increase" : "Decrease";
}

export function formatDegreeAwareAngleFeedback(correction) {
  const current = Number(correction?.current);
  const ideal = Number(correction?.ideal);
  if (correction?.kind !== "angle" || !Number.isFinite(current) || !Number.isFinite(ideal)) {
    return null;
  }

  const bodyPart = correction.bodyPart || correction.body_part || "angle";
  const label = angleLabel(bodyPart);
  const displayLabel = label
    ? `${label[0].toUpperCase()}${label.slice(1)}`
    : "Angle";
  const spokenLabel = label ? `your ${label}` : "the angle";
  const difference = ideal - current;
  const adjustment = Math.max(5, Math.abs(roundToFive(difference)));
  const currentRounded = roundAngle(current);
  const idealRounded = roundAngle(ideal);
  const min = Number(correction.min);
  const max = Number(correction.max);
  const targetRange = Number.isFinite(min) && Number.isFinite(max)
    ? [roundAngle(min), roundAngle(max)]
    : null;
  const verb = adjustmentVerb(bodyPart, difference);
  const voiceMessage = Math.abs(difference) <= 30
    ? `${verb} ${spokenLabel} about ${adjustment} degrees.`
    : `${displayLabel}: ${currentRounded} degrees. Aim for ${idealRounded}.`;
  const rangeText = targetRange
    ? `${targetRange[0]}–${targetRange[1]}°`
    : `${idealRounded}°`;
  const signedAdjustment = `${difference >= 0 ? "+" : "−"}${adjustment}°`;

  return {
    voiceMessage,
    displayMessage:
      `${displayLabel}: ${currentRounded}° → target ${rangeText} ` +
      `(ideal ${idealRounded}°, adjustment ${signedAdjustment}).`,
    details: {
      kind: "angle",
      body_part: bodyPart,
      current_angle: currentRounded,
      ideal_angle: idealRounded,
      target_range: targetRange,
      adjustment_degrees: difference >= 0 ? adjustment : -adjustment
    }
  };
}

export function revalidateQueuedAngleFeedback(feedbackDetail, context = {}) {
  if (feedbackDetail?.kind !== "angle") {
    return { valid: true, reason: null, formatted: null };
  }

  const situation = context.situationAwarenessState?.situation_context || {};
  const stableState = situation.stable_state || situation.situation_state;
  if (stableState !== "correcting") {
    return { valid: false, reason: "stable_state_changed", formatted: null };
  }

  const stableTarget = situation.attention_target?.body_part;
  if (
    stableTarget &&
    !GENERIC_TARGETS.has(stableTarget) &&
    stableTarget !== feedbackDetail.body_part
  ) {
    return { valid: false, reason: "stable_target_changed", formatted: null };
  }

  const correction = context.compositeForm?.corrections?.find(
    (item) => item.kind === "angle" && item.bodyPart === feedbackDetail.body_part
  );
  if (!correction) {
    return { valid: false, reason: "angle_resolved", formatted: null };
  }

  return {
    valid: true,
    reason: null,
    formatted: formatDegreeAwareAngleFeedback(correction)
  };
}
