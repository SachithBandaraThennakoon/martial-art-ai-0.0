import { evaluateRule } from "../ruleEvaluator.js";

const DEFAULTS = Object.freeze({
  start: {
    all: [
      { feature: "lead_wrist_forward_velocity", operator: "gte", value: 0.22 },
      { feature: "lead_elbow_angular_velocity", operator: "gte", value: 25 }
    ],
    confirmation: { min_frames: 2, min_ms: 50 }
  },
  peak: {
    type: "direction_reversal",
    signal: "lead_wrist_forward_velocity",
    enter_velocity: 0.1,
    exit_velocity: -0.04,
    confirmation: { min_frames: 1, min_ms: 0 }
  },
  return: {
    feature: "lead_wrist_guard_distance",
    operator: "lte",
    value: 0.65,
    confirmation: { min_frames: 2, min_ms: 50 }
  },
  minimum_rep_ms: 250,
  maximum_rep_ms: 1800,
  minimum_inter_rep_ms: 150,
  tracking_gap: { maximum_ms: 120, strategy: "hold" }
});

function mergeConfig(config = {}) {
  return {
    ...DEFAULTS,
    ...config,
    ready: config.ready ? { ...config.ready } : null,
    start: { ...DEFAULTS.start, ...config.start },
    peak: { ...DEFAULTS.peak, ...config.peak },
    return: { ...DEFAULTS.return, ...config.return },
    tracking_gap: { ...DEFAULTS.tracking_gap, ...config.tracking_gap }
  };
}

function confirmed(candidate, confirmation, timestampMs) {
  if (!candidate) return false;
  const settings = confirmation || {};
  return candidate.frames >= (settings.min_frames || 1)
    && timestampMs - candidate.startedAtMs >= (settings.min_ms || 0);
}

function updateCandidate(candidate, matches, timestampMs) {
  if (!matches) return null;
  return candidate
    ? { ...candidate, frames: candidate.frames + 1 }
    : { startedAtMs: timestampMs, frames: 1 };
}

export class OutboundPeakReturnDetector {
  constructor(config = {}) {
    this.config = mergeConfig(config);
    this.reset();
  }

  reset() {
    this.state = "READY";
    this.startCandidate = null;
    this.readyCandidate = null;
    this.armed = !this.config.ready;
    this.peakCandidate = null;
    this.returnCandidate = null;
    this.active = null;
    this.lastCompletedAtMs = null;
    this.previousFeatures = {};
    this.trackingGapStartedAtMs = null;
  }

  update({ timestampMs, features = {}, trackingConfidence = 1, trackingThreshold = 0.55 }) {
    const events = [];
    const detectorFeatures = {
      ...features,
      lead_wrist_punch_axis_position:
        features.lead_wrist_punch_axis_position
        ?? features.lead_wrist_guard_distance,
      lead_wrist_punch_axis_velocity:
        features.lead_wrist_punch_axis_velocity
        ?? features.lead_wrist_forward_velocity
    };
    const tracked = trackingConfidence >= trackingThreshold;
    if (!tracked) {
      this.trackingGapStartedAtMs ??= timestampMs;
      const gapMs = timestampMs - this.trackingGapStartedAtMs;
      if (gapMs <= this.config.tracking_gap.maximum_ms) {
        return this.snapshot(events, timestampMs, true);
      }
      if (this.active) {
        this.active.tracking_interruption_ms = gapMs;
        this.active.detectionConfidence *= 0.75;
      }
      return this.snapshot(events, timestampMs, false);
    }
    this.trackingGapStartedAtMs = null;

    if (this.state === "READY") {
      if (!this.armed && this.config.ready) {
        const readyMatch = evaluateRule(
          this.config.ready,
          detectorFeatures,
          { previousFeatures: this.previousFeatures }
        );
        this.readyCandidate = updateCandidate(
          this.readyCandidate,
          readyMatch.satisfied,
          timestampMs
        );
        if (confirmed(
          this.readyCandidate,
          this.config.ready.confirmation,
          timestampMs
        )) {
          this.armed = true;
          this.readyCandidate = null;
          events.push({ type: "READY_CONFIRMED", timestamp_ms: timestampMs });
        }
      }
      const sinceLast = Number.isFinite(this.lastCompletedAtMs)
        ? timestampMs - this.lastCompletedAtMs
        : Infinity;
      const startMatch = evaluateRule(
        this.config.start,
        detectorFeatures,
        { previousFeatures: this.previousFeatures }
      );
      this.startCandidate = updateCandidate(
        this.startCandidate,
        this.armed
          && startMatch.satisfied
          && sinceLast >= this.config.minimum_inter_rep_ms,
        timestampMs
      );
      if (confirmed(this.startCandidate, this.config.start.confirmation, timestampMs)) {
        const startMs = this.startCandidate.startedAtMs;
        this.active = {
          startMs,
          peakMs: null,
          endMs: null,
          detectionConfidence: startMatch.score || 1,
          peakPosition: Number(detectorFeatures.lead_wrist_punch_axis_position)
            || 0,
          tracking_interruption_ms: 0
        };
        this.state = "OUTBOUND";
        this.armed = false;
        this.startCandidate = null;
        events.push({ type: "REP_START", timestamp_ms: startMs });
      }
    } else if (this.state === "OUTBOUND") {
      const velocity = Number(detectorFeatures[this.config.peak.signal]);
      const position = Number(detectorFeatures.lead_wrist_punch_axis_position) || 0;
      this.active.peakPosition = Math.max(this.active.peakPosition, position);
      const reversed = velocity <= this.config.peak.exit_velocity;
      this.peakCandidate = updateCandidate(this.peakCandidate, reversed, timestampMs);
      if (confirmed(this.peakCandidate, this.config.peak.confirmation, timestampMs)) {
        this.active.peakMs = timestampMs;
        this.active.detectionConfidence = Math.min(
          1,
          (this.active.detectionConfidence + 1) / 2
        );
        this.state = "RETURNING";
        this.peakCandidate = null;
        events.push({ type: "PEAK", timestamp_ms: timestampMs });
      }
    } else if (this.state === "RETURNING") {
      const returnMatch = evaluateRule(
        this.config.return,
        detectorFeatures,
        { previousFeatures: this.previousFeatures }
      );
      this.returnCandidate = updateCandidate(
        this.returnCandidate,
        returnMatch.satisfied
          && timestampMs - this.active.startMs >= this.config.minimum_rep_ms,
        timestampMs
      );
      if (confirmed(this.returnCandidate, this.config.return.confirmation, timestampMs)) {
        this.active.endMs = timestampMs;
        this.active.detectionConfidence = Math.min(
          this.active.detectionConfidence,
          returnMatch.score || 1
        );
        events.push({
          type: "RETURN_ZONE",
          timestamp_ms: timestampMs,
          entered_at_ms: this.returnCandidate.startedAtMs
        });
        events.push({ type: "REP_END", timestamp_ms: timestampMs });
        this.lastCompletedAtMs = timestampMs;
        this.state = "READY";
        this.armed = true;
        this.returnCandidate = null;
      }
    }

    if (
      this.active
      && this.state !== "READY"
      && timestampMs - this.active.startMs > this.config.maximum_rep_ms
    ) {
      events.push({ type: "REP_TIMEOUT", timestamp_ms: timestampMs });
      this.state = "READY";
      this.armed = false;
      this.lastCompletedAtMs = timestampMs;
      this.startCandidate = null;
      this.peakCandidate = null;
      this.returnCandidate = null;
    }

    const snapshot = this.snapshot(events, timestampMs, false);
    if (events.some((event) => ["REP_END", "REP_TIMEOUT"].includes(event.type))) {
      this.active = null;
    }
    this.previousFeatures = { ...detectorFeatures };
    return snapshot;
  }

  snapshot(events, timestampMs, gapTolerated) {
    return {
      state: this.state,
      active: this.active ? { ...this.active } : null,
      events,
      timestamp_ms: timestampMs,
      tracking_gap_tolerated: gapTolerated
    };
  }
}
