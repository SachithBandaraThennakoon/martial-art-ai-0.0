const MIN_COVERAGE = 60;
const CORRECTION_CONFIRM_MS = 1800;
const MESSAGE_GAP_MS = 7500;
const REPEAT_GAP_MS = 14000;
const STEP_COMPLETE_HOLD_MS = 5000;

const label = (value) => String(value || "whole form").replace(/_/g, " ");

function correctionCue(correction) {
  if (!correction) return "Hold the shape.";

  const joint = label(correction.bodyPart);
  if (correction.kind === "quality") return `Correct your ${joint}.`;
  if (correction.direction === "decrease") return `Decrease your ${joint} slightly.`;
  return `Increase your ${joint} slightly.`;
}

function classifyIntent(message) {
  const text = String(message || "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "unknown";
  if (/(finish session|end session|i'?m done|stop training|quit)/.test(text)) return "finish";
  if (/(practice|free practice|drill it)/.test(text)) return "practice";
  if (/(again|repeat|restart|start over|reset|one more time)/.test(text)) return "repeat";
  if (/(not ready|wait|pause|hold on|give me a moment)/.test(text)) return "not_ready";
  if (/(help|show me|explain|confused|too hard|cannot|can't)/.test(text)) return "focus_help";
  if (/(is this correct|am i correct|is this right|check me|how is this)/.test(text)) return "check_correct";
  if (/(next|move on|skip|go ahead)/.test(text)) return "next";
  if (/^(yes|yeah|yep|sure|ok|okay|please|do it)$/.test(text)) return "ready";
  if (/(ready|start|begin|let'?s go|go|continue|keep training|train mode)/.test(text)) return "ready";
  return "unknown";
}

/**
 * Browser-only port of the previous coaching-agent behaviour. Pose, angle,
 * L1-L4 and activity-rule measurements remain in the client. This class only
 * manages the trainer's attention, progression, cadence and wording.
 */
export class TrainingCoach {
  constructor() {
    this.stepKey = "";
    this.activeCorrection = null;
    this.firstSeenAt = 0;
    this.lastMessageAt = 0;
    this.lastPartAt = new Map();
    this.attempts = new Map();
    this.lastTrackingPromptAt = 0;
    this.paused = false;
    this.stepComplete = false;
    this.perfectSince = 0;
  }

  resetStep(stepKey) {
    if (this.stepKey === stepKey) return;

    this.stepKey = stepKey;
    this.activeCorrection = null;
    this.firstSeenAt = 0;
    this.lastPartAt.clear();
    this.attempts.clear();
    this.paused = false;
    this.stepComplete = false;
    this.perfectSince = 0;
  }

  respond(message, { stepName = "the current step" } = {}) {
    const intent = classifyIntent(message);
    const focus = this.activeCorrection?.bodyPart || "whole_body";

    if (intent === "finish") {
      this.paused = true;
      return this.event({
        action: "session_complete_prompt",
        message: "Session complete. Practice, train again, or finish?",
        focus,
        issue: "session_complete",
        now: Date.now(),
        requiresResponse: true,
        question: {
          kind: "session_complete",
          options: [
            { value: "practice", label: "Practice" },
            { value: "repeat", label: "Train again" },
            { value: "finish", label: "Finish" }
          ]
        }
      });
    }

    if (intent === "practice") {
      this.paused = false;
      return this.event({
        action: "switch_practice",
        message: "Practice mode ready. Build a clean set at your own pace.",
        focus,
        issue: "practice",
        now: Date.now()
      });
    }

    if (intent === "not_ready") {
      this.paused = true;
      return this.event({
        action: "wait",
        message: "No rush. Set your stance, then say ready.",
        focus,
        issue: "waiting",
        now: Date.now(),
        requiresResponse: true,
        question: { kind: "ready", options: [{ value: "ready", label: "I am ready" }] }
      });
    }

    if (intent === "repeat") {
      if (this.stepComplete) {
        this.paused = false;
        this.stepComplete = false;
        this.perfectSince = 0;
        this.activeCorrection = null;
        return this.event({
          action: "restart_training",
          message: "Good. Start the technique again from the first step.",
          focus,
          issue: "restart_training",
          now: Date.now()
        });
      }

      this.paused = false;
      this.stepComplete = false;
      this.perfectSince = 0;
      this.activeCorrection = null;
      return this.event({
        action: "repeat_step",
        message: `Good. Repeat ${stepName}. One clean movement at a time.`,
        focus,
        issue: "repeat",
        now: Date.now()
      });
    }

    if (intent === "focus_help") {
      return this.event({
        action: "focus_prompt",
        message: this.activeCorrection
          ? `One point only: ${correctionCue(this.activeCorrection)}`
          : `Start with ${stepName}. Move slowly and hold the end position.`,
        focus,
        issue: "focus_help",
        now: Date.now()
      });
    }

    if (intent === "check_correct") {
      return this.event({
        action: this.activeCorrection ? "confirm_incorrect" : "confirm_correct",
        message: this.activeCorrection
          ? `Not yet. ${correctionCue(this.activeCorrection)}`
          : "Yes. Hold that shape for two seconds.",
        focus,
        issue: this.activeCorrection ? "form_error" : "in_range",
        now: Date.now()
      });
    }

    if (intent === "ready" || intent === "next") {
      this.paused = false;
      this.stepComplete = false;
      return this.event({
        action: intent === "next" ? "advance_step" : "observe",
        message: intent === "next"
          ? "Good. Move to the next step when you are set."
          : this.activeCorrection
            ? `Good. Focus on your ${label(this.activeCorrection.bodyPart)}.`
            : `Good. Start ${stepName}.`,
        focus,
        issue: "ready",
        now: Date.now()
      });
    }

    return this.event({
      action: "clarify",
      message: "Say ready, wait, repeat, practice, next, or help.",
      focus,
      issue: "clarify",
      now: Date.now(),
      speak: false
    });
  }

  evaluate({ stepKey, corrections = [], strengths = [], form, situation, now = Date.now() }) {
    this.resetStep(stepKey || "");

    if (this.paused || this.stepComplete) return null;

    const state = situation?.situation_state;
    const trackingUnclear = state === "tracking_unclear" ||
      !form?.scorable || Number(form?.coverage || 0) < MIN_COVERAGE;

    if (trackingUnclear) {
      if (
        this.lastTrackingPromptAt &&
        now - this.lastTrackingPromptAt < REPEAT_GAP_MS
      ) return null;

      this.lastTrackingPromptAt = now;
      this.activeCorrection = null;
      return this.event({
        action: "attention_prompt",
        message: "Step back; show your full body before I coach the movement.",
        focus: "whole_body",
        issue: "tracking_unclear",
        now
      });
    }

    if (state === "warning") {
      if (this.lastMessageAt && now - this.lastMessageAt < MESSAGE_GAP_MS) return null;

      return this.event({
        action: "attention_prompt",
        message: "Slow down, breathe, and reset your stance before the next repetition.",
        focus: "whole_body",
        issue: "fatigue_risk",
        now
      });
    }

    const current = this.activeCorrection
      ? corrections.find((item) => item.bodyPart === this.activeCorrection.bodyPart)
      : null;

    if (this.activeCorrection && !current) {
      const corrected = this.activeCorrection;
      this.activeCorrection = null;
      this.attempts.delete(corrected.bodyPart);
      if (this.lastMessageAt && now - this.lastMessageAt < 3000) return null;

      const next = corrections[0];
      return this.event({
        action: "hold_good",
        message: next
          ? `Good, your ${label(corrected.bodyPart)} is set. Now ${correctionCue(next).toLowerCase()}`
          : `Good, your ${label(corrected.bodyPart)} is set. Hold that shape.`,
        focus: next?.bodyPart || corrected.bodyPart,
        issue: "resolved",
        now
      });
    }

    const correction = current || corrections.find(
      (item) => now - (this.lastPartAt.get(item.bodyPart) || 0) >= REPEAT_GAP_MS
    ) || corrections[0];

    if (!correction) {
      if (Number(form?.accuracy) >= 99) {
        if (!this.perfectSince) this.perfectSince = now;
        if (now - this.perfectSince >= STEP_COMPLETE_HOLD_MS) {
          this.stepComplete = true;
          this.paused = true;
          return this.event({
            action: "confirm_next",
            message: "Good. Step complete. Move to the next step or repeat it?",
            focus: strengths[0]?.bodyPart || "whole_body",
            issue: "step_complete",
            now,
            requiresResponse: true,
            question: {
              kind: "next_step",
              options: [
                { value: "next", label: "Next step" },
                { value: "repeat", label: "Repeat step" }
              ]
            }
          });
        }
      } else {
        this.perfectSince = 0;
      }
      if (this.lastMessageAt && now - this.lastMessageAt < MESSAGE_GAP_MS) return null;

      const strength = strengths[0];
      return strength ? this.event({
        action: "hold_good",
        message: `Good ${label(strength.bodyPart)}. Hold the shape and stay relaxed.`,
        focus: strength.bodyPart,
        issue: "in_range",
        now
      }) : null;
    }

    const signature = `${correction.bodyPart}:${correction.direction}`;
    if (this.activeCorrection?.signature !== signature) {
      this.activeCorrection = { ...correction, signature };
      this.firstSeenAt = now;
      return null;
    }

    if (
      now - this.firstSeenAt < CORRECTION_CONFIRM_MS ||
      (this.lastMessageAt && now - this.lastMessageAt < MESSAGE_GAP_MS)
    ) {
      return null;
    }

    const attempt = this.attempts.get(correction.bodyPart) || 0;
    const cue = correctionCue(correction);
    const message = attempt === 0
      ? cue
      : attempt === 1
        ? `Good adjustment. Keep working on your ${label(correction.bodyPart)}; almost there.`
        : `Reset once. ${cue} Move slowly, then hold for two seconds.`;

    this.attempts.set(correction.bodyPart, attempt + 1);
    this.lastPartAt.set(correction.bodyPart, now);
    this.activeCorrection = { ...correction, signature };

    return this.event({
      action: "correct",
      message,
      focus: correction.bodyPart,
      issue: correction.direction || "form_error",
      now
    });
  }

  event({ action, message, focus, issue, now, requiresResponse = false, question = null, speak = true }) {
    this.lastMessageAt = now;
    return {
      action,
      message,
      summary: message,
      speak,
      feedback_intent: `local-coach:${this.stepKey}:${action}:${focus || "whole_body"}:${issue || ""}`,
      focus_body_part: focus || "whole_body",
      issue,
      requires_response: requiresResponse,
      question,
      memory: {
        source: "local_training_coach",
        active_correction: this.activeCorrection?.bodyPart || null,
        paused: this.paused
      }
    };
  }
}
