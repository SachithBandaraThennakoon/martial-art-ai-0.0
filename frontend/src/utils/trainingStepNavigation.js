export function parseTrainingStepCommand(message, stepCount = 0) {
  const normalized = String(message || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const numberedStep = normalized.match(
    /\b(?:go|move|switch|change|advance)?\s*(?:to\s*)?step\s*(\d+)\b/
  );
  if (numberedStep) {
    const index = Number(numberedStep[1]) - 1;
    if (index >= 0 && index < stepCount) return { type: "index", index };
  }
  if (
    /\b(next step|move (?:to )?(?:the )?next(?: step)?|go (?:to )?(?:the )?next(?: step)?|advance|continue to (?:the )?next)\b/.test(
      normalized
    )
  ) {
    return { type: "delta", delta: 1 };
  }
  if (
    /\b(previous step|move back|go back|back a step|prior step)\b/.test(normalized)
  ) {
    return { type: "delta", delta: -1 };
  }
  return null;
}

export function buildStepTransitionFeedback({
  fromStep,
  toStep,
  direction = 1
}) {
  if (!toStep || toStep === fromStep) {
    return direction > 0
      ? "Final step. Finish cleanly, then review."
      : "First step. Establish your stance.";
  }

  const name = String(toStep.step_name || "next step").toLowerCase();
  // "Return to guard" contains "guard", so classify recovery before stance.
  if (/return|recover/.test(name)) {
    return "Next: Return to guard.";
  }
  if (/guard|stance/.test(name)) return "Next: Guard stance.";
  if (/extend|strike|punch/.test(name)) {
    return "Next: Extend lead hand.";
  }
  return `Next: ${toStep.step_name}.`;
}
