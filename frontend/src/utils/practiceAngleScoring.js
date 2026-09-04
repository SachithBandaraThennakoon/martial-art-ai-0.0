export function scorePracticeAngles(requiredParts, liveAngles) {
  if (!requiredParts.length) {
    return {
      accuracy: 0,
      focusBodyPart: null,
      issue: "needs_targets",
      wrongBodyParts: []
    };
  }

  const partScores = [];
  let worst = null;
  const wrongBodyParts = [];
  const advisoryBodyParts = [];

  requiredParts.forEach((part) => {
    const value = liveAngles?.[part.body_part];

    if (!Number.isFinite(value)) {
      partScores.push(0);
      const missing = {
        bodyPart: part.body_part,
        issue: "missing",
        severity: 100,
        priority: 3
      };
      if (!worst || missing.priority > (worst.priority || 0)) worst = missing;
      wrongBodyParts.push(part.body_part);
      return;
    }

    let diff = 0;
    let issue = "good";
    if (value < part.min) {
      diff = part.min - value;
      issue = "too_closed";
    } else if (value > part.max) {
      diff = value - part.max;
      issue = "too_open";
    }

    const measurementTolerance = Math.max(
      0,
      Number(part.measurement_tolerance_deg) || 0
    );
    const isAdvisory = issue !== "good" && diff <= measurementTolerance;
    const isWrong = issue !== "good" && !isAdvisory;

    // Values inside the configured measurement tolerance are biomechanically
    // close to the preferred range and should not lose points because of
    // normal single-camera landmark jitter.
    partScores.push(isAdvisory ? 100 : Math.max(0, 100 - diff * 2));
    if (isAdvisory) advisoryBodyParts.push(part.body_part);
    if (isWrong) wrongBodyParts.push(part.body_part);

    const candidate = {
      bodyPart: part.body_part,
      issue: isAdvisory
        ? issue === "too_open" ? "near_upper_limit" : "near_lower_limit"
        : issue,
      severity: diff,
      priority: isWrong ? 2 : isAdvisory ? 1 : 0
    };
    if (
      !worst ||
      candidate.priority > worst.priority ||
      (candidate.priority === worst.priority && diff > worst.severity)
    ) {
      worst = candidate;
    }
  });

  const averageScore =
    partScores.reduce((total, value) => total + value, 0) /
    requiredParts.length;
  const weakestScore = Math.min(...partScores);

  return {
    // A failed critical joint must not be hidden by unrelated targets that
    // happen to score 100.
    accuracy: Math.round(Math.min(averageScore, weakestScore)),
    focusBodyPart: worst?.bodyPart || null,
    issue: worst?.issue || "good",
    wrongBodyParts,
    advisoryBodyParts
  };
}
