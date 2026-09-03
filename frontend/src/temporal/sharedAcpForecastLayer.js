import {
  buildAcpForecastBands,
  normalizedPoseError,
  reliabilityFromPoseError
} from "./acpForecastPolicy.js";

const DEFAULT_CONFIG = {
  enabled: false,
  inferenceIntervalMs: 180,
  historySize: 70,
  shortHorizonFrames: 6,
  displayHorizonFrame: 3,
  validationToleranceMs: 20,
  reliabilityAlpha: 0.16
};

export class SharedAcpForecastLayer {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.frames = [];
    this.lastInferenceMs = 0;
    this.predictor = null;
    this.predictorPromise = null;
    this.pendingValidations = [];
    this.horizonReliability = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [index + 1, 1])
    );
    this.capturedPredictionOriginMs = null;
  }

  ensurePredictor() {
    if (this.predictor || this.predictorPromise || !this.config.enabled) return;

    this.predictorPromise = import("./stgatOnnxPredictor")
      .then(({ StgatOnnxPredictor }) => {
        this.predictor = new StgatOnnxPredictor();
      })
      .finally(() => {
        this.predictorPromise = null;
      });
  }

  update({ level1State, enabled, inferenceIntervalMs } = {}) {
    if (!level1State?.debug?.currentLandmarks?.length) return this.getState();

    this.config.enabled = Boolean(enabled);
    if (Number.isFinite(inferenceIntervalMs)) {
      this.config.inferenceIntervalMs = inferenceIntervalMs;
    }

    const timestampMs = level1State.timestamp * 1000;
    this.validateForecasts(timestampMs, level1State.debug.currentLandmarks);
    this.frames.push({
      timestamp: level1State.timestamp,
      landmarks: level1State.debug.currentLandmarks
    });
    this.frames = this.frames.slice(-this.config.historySize);

    if (!this.config.enabled) return this.getState();

    this.ensurePredictor();
    if (
      this.predictor &&
      timestampMs - this.lastInferenceMs >= this.config.inferenceIntervalMs
    ) {
      this.lastInferenceMs = timestampMs;
      this.predictor.update({
        frames: this.frames,
        currentLandmarks: level1State.debug.currentLandmarks
      });
    }

    const state = this.getState(level1State.tracking?.confidence || 0);
    this.capturePrediction(state.prediction);
    return state;
  }

  validateForecasts(timestampMs, observedLandmarks) {
    const tolerance = this.config.validationToleranceMs;
    const matured = this.pendingValidations.filter(
      (item) => Math.abs(item.targetTimestampMs - timestampMs) <= tolerance
    );
    matured.forEach((item) => {
      const error = normalizedPoseError(item.landmarks, observedLandmarks);
      const sampleReliability = reliabilityFromPoseError(error);
      const previous = this.horizonReliability[item.horizonFrame] ?? 1;
      this.horizonReliability[item.horizonFrame] =
        previous * (1 - this.config.reliabilityAlpha) +
        sampleReliability * this.config.reliabilityAlpha;
    });
    this.pendingValidations = this.pendingValidations.filter(
      (item) => item.targetTimestampMs > timestampMs + tolerance
    );
  }

  capturePrediction(prediction) {
    if (
      !prediction?.future_landmark_frames?.length ||
      prediction.origin_timestamp_ms === this.capturedPredictionOriginMs
    ) return;

    this.capturedPredictionOriginMs = prediction.origin_timestamp_ms;
    this.pendingValidations.push(
      ...prediction.future_landmark_frames.map((frame) => ({
        targetTimestampMs: frame.target_timestamp_ms,
        horizonFrame: frame.horizon_frame,
        landmarks: frame.landmarks
      }))
    );
    this.pendingValidations = this.pendingValidations.slice(-180);
  }

  getState(trackingConfidence = 0) {
    const prediction = this.predictor?.latestPrediction || null;
    const allFrames = prediction?.future_landmark_frames || [];
    const initialFrames = allFrames.slice(
      0,
      this.config.shortHorizonFrames
    );
    const displayFrame =
      initialFrames.find(
        (frame) => frame.horizon_frame === this.config.displayHorizonFrame
      ) || initialFrames[initialFrames.length - 1] || null;
    const bands = buildAcpForecastBands({
      frames: allFrames,
      sourceLandmarks: prediction?.source_landmarks || [],
      reliability: this.horizonReliability,
      trackingConfidence
    });

    return {
      model_name: prediction?.model_name || "ACP-STGAT",
      display_name:
        prediction?.display_name || "Action-Conditioned Physics-Informed ST-GAT",
      status:
        prediction?.status || this.predictor?.status ||
        (this.config.enabled ? "loading" : "disabled"),
      prediction,
      all_frames: allFrames,
      initial_frames: initialFrames,
      display_frame: displayFrame,
      bands,
      horizon_reliability: { ...this.horizonReliability },
      short_horizon_ms:
        initialFrames[initialFrames.length - 1]?.horizon_ms || 0
    };
  }
}
