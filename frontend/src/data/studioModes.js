export const STUDIO_MODES = {
  guide: {
    label: "Guide",
    title: "3D movement, principles, and safety guidance.",
    description: "Understand the technique through an animated reference and clear movement-science explanations.",
    action: "Explore the technique"
  },
  train: {
    label: "Train",
    title: "Steps, targets, and accuracy feedback.",
    description: "Learn one step at a time with observed-pose scoring and short-horizon advisory guidance.",
    action: "Start learning"
  },
  practice: {
    label: "Practice",
    title: "Fixed-count reps, pace, and quality tracking.",
    description: "Build a set and perform full repetitions. Observed movement counts reps while forecasts support awareness.",
    action: "Build a practice set",
    isDefault: true
  },
  analysis: {
    label: "Analysis",
    title: "Recent practice sets and next recommendation.",
    description: "Review corrected timelines, observed repetition quality, form errors, and saved forecast evidence.",
    action: "Review performance"
  }
};

export const DEFAULT_STUDIO_MODE = "practice";

export function isStudioMode(value) {
  return Boolean(STUDIO_MODES[value]);
}
