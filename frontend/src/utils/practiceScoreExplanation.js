export const formatPracticeBodyPart = (value) =>
  value
    ? String(value)
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Movement";

const issueExplanation = (bodyPart, issue) => {
  const label = formatPracticeBodyPart(bodyPart);
  if (issue === "too_closed") {
    return `${label} was more closed or bent than the target range for this step.`;
  }
  if (issue === "too_open") {
    return `${label} was more open or extended than the target range for this step.`;
  }
  if (issue === "near_upper_limit") {
    return `${label} was close to the upper target boundary. Treat this as an advisory unless it persists across the movement peak.`;
  }
  if (issue === "near_lower_limit") {
    return `${label} was close to the lower target boundary. Treat this as an advisory unless it persists.`;
  }
  if (issue === "missing") {
    return `${label} could not be measured reliably in this frame.`;
  }
  if (issue === "transition") {
    return "This is a movement transition, so it is not used for form scoring.";
  }
  return `${label} was outside the configured target for this step.`;
};

export function buildPracticeScoreExplanation(
  frame,
  { cleanAccuracy = 80, step = null } = {}
) {
  if (!frame) return null;
  const accuracy = Number(frame.accuracy);
  const scorable =
    frame.scorable !== false &&
    frame.accuracy !== null &&
    frame.accuracy !== undefined &&
    Number.isFinite(accuracy);
  if (!scorable) {
    return {
      tone: "transition",
      title: "Why this moment is not scored",
      summary: frame.trackingReliable === false
        ? "Tracking was unreliable, so this frame was excluded from form accuracy."
        : "The frame belongs to a movement transition or preparation interval.",
      details: []
    };
  }

  const wrongBodyParts = [...new Set(frame.wrongBodyParts || [])];
  const advisoryBodyParts = [...new Set(frame.advisoryBodyParts || [])];
  const focusBodyPart =
    frame.focusBodyPart || wrongBodyParts[0] || advisoryBodyParts[0] || null;
  const issue = frame.issue || null;
  const target = (step?.angles || []).find(
    (item) => item?.body_part === focusBodyPart
  );
  const observed = Number(frame.angles?.[focusBodyPart]);
  const details = [];

  if (focusBodyPart && issue && issue !== "good") {
    details.push(issueExplanation(focusBodyPart, issue));
  } else if (wrongBodyParts.length) {
    details.push(
      `${wrongBodyParts.map(formatPracticeBodyPart).join(" and ")} missed the configured target.`
    );
  }
  if (Number.isFinite(observed)) {
    details.push(
      target && Number.isFinite(target.min) && Number.isFinite(target.max)
        ? `Measured ${formatPracticeBodyPart(focusBodyPart)}: ${Math.round(observed)}°; target ${Math.round(target.min)}–${Math.round(target.max)}°.`
        : `Measured ${formatPracticeBodyPart(focusBodyPart)}: ${Math.round(observed)}°.`
    );
  }
  if (accuracy < cleanAccuracy) {
    details.push(
      "A failed critical joint limits the whole-frame score so other correct joints cannot hide the form issue."
    );
  }

  const needsReview = accuracy < cleanAccuracy || wrongBodyParts.length > 0;
  const isAdvisory = !needsReview && advisoryBodyParts.length > 0;
  return {
    tone: needsReview ? "warning" : isAdvisory ? "advisory" : "clean",
    title: needsReview
      ? "Why this score is low"
      : isAdvisory
        ? "Near target boundary"
        : "Why this frame is clean",
    summary: needsReview || isAdvisory
      ? details[0] || "One or more required targets were outside range."
      : "All measured targets used by this step were within their configured ranges.",
    details: details.slice(1)
  };
}
