const DEFAULT_CONFIG = {
  windowMs: 3000,
  maxSamples: 7,
  minimumHoldMs: 1500,
  rules: {
    correcting: { minimumSamples: 3, minimumRatio: 0.6, minimumDurationMs: 900 },
    anticipating: { minimumSamples: 3, minimumRatio: 0.6, minimumDurationMs: 900 },
    warning: { minimumSamples: 3, minimumRatio: 0.6, minimumDurationMs: 900 },
    advance_ready: { minimumSamples: 4, minimumRatio: 0.66, minimumDurationMs: 1350 },
    encouraging: { minimumSamples: 3, minimumRatio: 0.6, minimumDurationMs: 900 },
    observing: { minimumSamples: 3, minimumRatio: 0.6, minimumDurationMs: 900 }
  }
};

const IMMEDIATE_STATES = new Set([
  "tracking_unclear",
  "attention_hold",
  "attention_paused",
  "returning",
  "resume_ready"
]);

const STATE_PRIORITY = {
  correcting: 6,
  warning: 5,
  anticipating: 4,
  advance_ready: 3,
  encouraging: 2,
  observing: 1
};

const round = (value) => Number((Number.isFinite(value) ? value : 0).toFixed(3));

function evidenceFor(state, evidence = {}) {
  if (state === "correcting") return evidence.mistakeRisk || 0;
  if (state === "anticipating") return evidence.forecastRisk || 0;
  if (state === "warning") return evidence.fatigueRisk || 0;
  if (["advance_ready", "encouraging"].includes(state)) return evidence.masteryScore || 0;
  return Math.max(0, 1 - (evidence.mistakeRisk || 0));
}

function clusterKey(state, target = {}, contextKey = "") {
  if (["correcting", "anticipating"].includes(state)) {
    return [contextKey, state, target.body_part || "whole_form", target.issue || "unknown"].join(":");
  }
  return [contextKey, state].join(":");
}

function summarizeGroup(samples, totalSamples) {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const averageEvidence = samples.reduce((sum, sample) => sum + sample.evidence, 0) /
    Math.max(1, samples.length);
  return {
    state: first.state,
    key: first.key,
    target: last.target,
    support: samples.length,
    sample_count: totalSamples,
    support_ratio: round(samples.length / Math.max(1, totalSamples)),
    average_evidence: round(averageEvidence),
    duration_ms: Math.max(0, last.timestampMs - first.timestampMs),
    last_seen_ms: last.timestampMs
  };
}

export class StableSituationResolver {
  constructor(config = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      rules: { ...DEFAULT_CONFIG.rules, ...(config.rules || {}) }
    };
    this.samples = [];
    this.contextKey = "";
    this.stableState = "observing";
    this.stableKey = "";
    this.stableTarget = null;
    this.stableSinceMs = 0;
  }

  reset(contextKey = "") {
    this.samples = [];
    this.contextKey = contextKey;
    this.stableState = "observing";
    this.stableKey = clusterKey("observing", {}, contextKey);
    this.stableTarget = null;
    this.stableSinceMs = 0;
  }

  resolve({ rawState, attentionTarget, timestampMs, contextKey = "", evidence = {} }) {
    const now = Number.isFinite(timestampMs) ? timestampMs : Date.now();
    if (contextKey !== this.contextKey) {
      this.reset(contextKey);
      this.stableSinceMs = now;
    }

    if (IMMEDIATE_STATES.has(rawState)) {
      const changed = this.stableState !== rawState;
      this.samples = [];
      this.stableState = rawState;
      this.stableKey = clusterKey(rawState, attentionTarget, contextKey);
      this.stableTarget = attentionTarget;
      if (changed || !this.stableSinceMs) this.stableSinceMs = now;
      return this.result({ rawState, candidate: null, changed, now, immediate: true });
    }

    if (IMMEDIATE_STATES.has(this.stableState)) {
      this.stableState = "observing";
      this.stableKey = clusterKey("observing", {}, contextKey);
      this.stableTarget = null;
      this.stableSinceMs = now;
    }

    const sample = {
      state: rawState,
      key: clusterKey(rawState, attentionTarget, contextKey),
      target: attentionTarget,
      timestampMs: now,
      evidence: evidenceFor(rawState, evidence)
    };
    this.samples.push(sample);
    this.samples = this.samples
      .filter((item) => now - item.timestampMs <= this.config.windowMs)
      .slice(-this.config.maxSamples);

    const groups = new Map();
    this.samples.forEach((item) => {
      const items = groups.get(item.key) || [];
      items.push(item);
      groups.set(item.key, items);
    });
    const candidates = [...groups.values()]
      .map((items) => summarizeGroup(items, this.samples.length))
      .filter((candidate) => {
        const rule = this.config.rules[candidate.state];
        return Boolean(
          rule &&
          candidate.support >= rule.minimumSamples &&
          candidate.support_ratio >= rule.minimumRatio &&
          candidate.duration_ms >= rule.minimumDurationMs
        );
      })
      .sort((left, right) =>
        (STATE_PRIORITY[right.state] || 0) - (STATE_PRIORITY[left.state] || 0) ||
        right.support_ratio - left.support_ratio ||
        right.average_evidence - left.average_evidence
      );
    const candidate = candidates[0] || null;

    const trailingMismatchCount = [...this.samples]
      .reverse()
      .findIndex((item) => item.key === this.stableKey);
    const clearSamples = trailingMismatchCount === -1
      ? this.samples.length
      : trailingMismatchCount;
    const holdSatisfied = now - this.stableSinceMs >= this.config.minimumHoldMs;
    const stableHasCleared = clearSamples >= 3 && holdSatisfied;
    let changed = false;

    if (candidate && candidate.key !== this.stableKey) {
      const currentPriority = STATE_PRIORITY[this.stableState] || 0;
      const candidatePriority = STATE_PRIORITY[candidate.state] || 0;
      if (this.stableState === "observing" || stableHasCleared || candidatePriority > currentPriority) {
        this.stableState = candidate.state;
        this.stableKey = candidate.key;
        this.stableTarget = candidate.target;
        this.stableSinceMs = now;
        changed = true;
      }
    } else if (candidate?.key === this.stableKey) {
      this.stableTarget = candidate.target;
    } else if (stableHasCleared && this.stableState !== "observing") {
      this.stableState = "observing";
      this.stableKey = clusterKey("observing", {}, contextKey);
      this.stableTarget = null;
      this.stableSinceMs = now;
      changed = true;
    }

    return this.result({ rawState, candidate, changed, now, immediate: false });
  }

  result({ rawState, candidate, changed, now, immediate }) {
    const stableSamples = this.samples.filter((sample) => sample.key === this.stableKey);
    const stableCluster = stableSamples.length
      ? summarizeGroup(stableSamples, this.samples.length)
      : null;
    return {
      raw_state: rawState,
      stable_state: this.stableState,
      candidate_state: candidate?.state || null,
      candidate_key: candidate?.key || null,
      state_confidence: immediate
        ? 1
        : round(stableCluster?.support_ratio || 0),
      changed,
      immediate,
      stable_for_ms: Math.max(0, now - this.stableSinceMs),
      stable_target: this.stableTarget,
      cluster: stableCluster,
      candidate_cluster: candidate
    };
  }
}
