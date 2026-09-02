const DEFAULT_PHASE_TO_STATE = Object.freeze({
  PREPARATION: "GUARD",
  EXTENSION: "EXTENSION",
  PEAK: "FULL_EXTENSION",
  RETRACTION: "RETRACTION",
  RECOVERY: "RECOVERY"
});

export class PhaseSegmenter {
  constructor(config = {}) {
    this.config = config;
    this.reset();
  }

  reset() {
    this.phase = "PREPARATION";
    this.peakSeenAtMs = null;
  }

  update(detectorSnapshot) {
    const eventTypes = new Set(
      (detectorSnapshot?.events || []).map((event) => event.type)
    );
    if (eventTypes.has("REP_START")) this.phase = "EXTENSION";
    if (eventTypes.has("PEAK")) {
      this.phase = "PEAK";
      this.peakSeenAtMs = detectorSnapshot.timestamp_ms;
    } else if (detectorSnapshot?.state === "RETURNING") {
      this.phase = "RETRACTION";
    }
    if (eventTypes.has("RETURN_ZONE")) this.phase = "RECOVERY";
    const phase = this.phase;
    if (eventTypes.has("REP_END") || eventTypes.has("REP_TIMEOUT")) {
      this.phase = "PREPARATION";
      this.peakSeenAtMs = null;
    }
    return {
      phase,
      state: this.config.state_mapping?.[phase]
        || DEFAULT_PHASE_TO_STATE[phase]
        || phase
    };
  }
}

