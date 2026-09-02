import { BiomechanicalFeatureExtractor } from "./biomechanicalFeatureExtractor.js";
import { scoreRepetition } from "./biomechanicalScorer.js";
import { createActivityDetector } from "./activityDetector.js";
import { PersistentErrorEvaluator } from "./persistentErrorEvaluator.js";
import { evaluateRule } from "./ruleEvaluator.js";
import { SessionTimelineRecorder } from "./sessionTimelineRecorder.js";
import { postProcessSessionTimeline } from "./sessionTimelinePostProcessor.js";
import { TEMPORAL_SPECIAL_LABELS } from "./temporalModelContract.js";
import { TemporalStateMachine } from "./temporalStateMachine.js";
import { PhaseSegmenter } from "./phaseSegmenter.js";

const SESSION_STATES = Object.freeze({
  OUTSIDE_SESSION: "OUTSIDE_SESSION",
  READY: "READY",
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  TRACKING_LOST: "TRACKING_LOST",
  SESSION_COMPLETE: "SESSION_COMPLETE"
});

const REPETITION_STATES = Object.freeze({
  WAITING: "WAITING",
  REP_STARTED: "REP_STARTED",
  REP_ACTIVE: "REP_ACTIVE",
  REP_COMPLETED: "REP_COMPLETED",
  REP_ABORTED: "REP_ABORTED"
});
const [, UNKNOWN_PHASE, TRACKING_LOST_PHASE] = TEMPORAL_SPECIAL_LABELS;

function average(values) {
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return 0;
  return finiteValues.reduce((total, value) => total + value, 0) / finiteValues.length;
}

function round(value) {
  return Number((Number.isFinite(value) ? value : 0).toFixed(3));
}

function cloneCorrectedTimeline(value) {
  return structuredClone(value);
}

function techniqueLabel(techniquePackage) {
  return techniquePackage.id.toUpperCase().replace(/-/g, "_");
}

export class TrackingSessionEngine {
  constructor(techniquePackage, {
    mode = "train",
    maximumFrames,
    analysisEngine = "auto"
  } = {}) {
    this.techniquePackage = techniquePackage;
    this.mode = mode;
    this.analysisEngine = ["rules", "model", "both"].includes(analysisEngine)
      ? analysisEngine
      : "auto";
    this.policy = techniquePackage.getMode(mode);
    this.analysisConfig = techniquePackage.getAnalysisConfig?.() || null;
    this.activityDetector = createActivityDetector(this.analysisConfig);
    this.phaseSegmenter = this.activityDetector
      ? new PhaseSegmenter(this.analysisConfig.phase_segmentation)
      : null;
    this.maximumUnknownMovementMs =
      mode === "practice" ? 650 : 400;
    this.featureExtractor = new BiomechanicalFeatureExtractor();
    this.stateMachine = new TemporalStateMachine(techniquePackage, { mode });
    this.errorEvaluator = new PersistentErrorEvaluator(
      techniquePackage.errors.errors || []
    );
    this.timeline = new SessionTimelineRecorder({ maximumFrames });
    this.reset();
  }

  reset() {
    this.featureExtractor.reset();
    this.stateMachine.reset();
    this.errorEvaluator.reset();
    this.activityDetector?.reset();
    this.phaseSegmenter?.reset();
    this.timeline.reset();
    this.sessionState = SESSION_STATES.OUTSIDE_SESSION;
    this.stateBeforeTrackingLoss = SESSION_STATES.READY;
    this.repState = REPETITION_STATES.WAITING;
    this.repId = null;
    this.repetitions = [];
    this.currentRepetition = null;
    this.sessionStartedAtMs = null;
    this.sessionEndedAtMs = null;
    this.lastTimestampMs = null;
    this.unknownStartedAtMs = null;
    this.pendingCue = null;
    this.stepDurations = new Map();
    this.lastStep = null;
    this.lastStepStartedAtMs = null;
    this.latestFrame = null;
    this.correctedSession = null;
    this.previousOfflineFeatures = {};
  }

  start(timestampMs = null) {
    if (this.sessionState !== SESSION_STATES.OUTSIDE_SESSION) return;
    this.sessionState = SESSION_STATES.READY;
    this.sessionStartedAtMs = Number.isFinite(timestampMs) ? timestampMs : null;
    this.timeline.addEvent({
      type: "session_started",
      timestamp_ms: this.sessionStartedAtMs
    });
  }

  pause(timestampMs = this.lastTimestampMs) {
    if (![SESSION_STATES.READY, SESSION_STATES.ACTIVE].includes(this.sessionState)) {
      return;
    }
    this.sessionState = SESSION_STATES.PAUSED;
    this.timeline.addEvent({ type: "session_paused", timestamp_ms: timestampMs });
  }

  resume(timestampMs = this.lastTimestampMs) {
    if (this.sessionState !== SESSION_STATES.PAUSED) return;
    this.sessionState = this.stateMachine.currentState
      ? SESSION_STATES.ACTIVE
      : SESSION_STATES.READY;
    this.timeline.addEvent({ type: "session_resumed", timestamp_ms: timestampMs });
  }

  recordCue({ cue, timestampMs }) {
    if (!Number.isFinite(timestampMs)) return;
    this.pendingCue = { cue, timestamp_ms: timestampMs };
    this.timeline.addEvent({
      type: "cue_recorded",
      cue,
      timestamp_ms: timestampMs
    });
  }

  beginRepetition(timestampMs) {
    const repetition = this.repetitions.length + 1;
    this.repId = repetition;
    this.repState = REPETITION_STATES.REP_STARTED;
    this.currentRepetition = {
      rep_id: repetition,
      start_ms: timestampMs,
      end_ms: null,
      status: "active",
      state_confidences: [],
      form_errors: [],
      cue: this.pendingCue?.cue || null,
      cue_timestamp_ms: this.pendingCue?.timestamp_ms ?? null,
      response_time_ms: this.pendingCue
        ? Math.max(0, Math.round(timestampMs - this.pendingCue.timestamp_ms))
        : null,
      detector_events: [],
      phase_boundaries: {},
      metric_samples: {
        rear_wrist_guard_distance: [],
        torso_lean: []
      }
    };
    this.pendingCue = null;
    this.timeline.addEvent({
      type: "repetition_started",
      timestamp_ms: timestampMs,
      rep_id: repetition
    });
  }

  finishRepetition(timestampMs, status) {
    if (!this.currentRepetition) return;
    const repetition = this.currentRepetition;
    repetition.end_ms = timestampMs;
    repetition.duration_ms = Math.max(0, Math.round(timestampMs - repetition.start_ms));
    repetition.status = status;
    repetition.phases = {
      extension: {
        start_ms: repetition.start_ms,
        end_ms: repetition.peak_ms
      },
      peak: { timestamp_ms: repetition.peak_ms },
      retraction: {
        start_ms: repetition.peak_ms,
        end_ms: repetition.phase_boundaries?.return_zone_entered_ms
          ?? repetition.end_ms
      },
      recovery: {
        start_ms: repetition.phase_boundaries?.return_zone_entered_ms
          ?? repetition.end_ms,
        end_ms: repetition.end_ms
      }
    };
    repetition.confidence = round(average(repetition.state_confidences));
    repetition.detection_confidence = round(
      repetition.detector_confidence ?? repetition.confidence
    );
    repetition.metrics = {
      peak_lead_elbow_angle: round(repetition.maximum_lead_elbow_angle),
      average_rear_wrist_guard_distance: round(average(
        repetition.metric_samples?.rear_wrist_guard_distance || []
      )),
      average_torso_lean: round(average(
        repetition.metric_samples?.torso_lean || []
      ))
    };
    Object.assign(
      repetition,
      scoreRepetition(repetition, this.analysisConfig?.quality_scoring)
    );
    delete repetition.state_confidences;
    delete repetition.metric_samples;
    this.repetitions.push(repetition);
    this.currentRepetition = null;
    this.repState = status === "completed"
      ? REPETITION_STATES.REP_COMPLETED
      : REPETITION_STATES.REP_ABORTED;
    this.timeline.addEvent({
      type: status === "completed" ? "repetition_completed" : "repetition_aborted",
      timestamp_ms: timestampMs,
      rep_id: repetition.rep_id,
      reason: status === "completed" ? null : status
    });
  }

  updateStepDuration(step, timestampMs) {
    if (step === this.lastStep) return;
    if (this.lastStep && Number.isFinite(this.lastStepStartedAtMs)) {
      const durations = this.stepDurations.get(this.lastStep) || [];
      durations.push(Math.max(0, timestampMs - this.lastStepStartedAtMs));
      this.stepDurations.set(this.lastStep, durations);
    }
    this.lastStep = step;
    this.lastStepStartedAtMs = timestampMs;
  }

  update(level1State, sideOverrides = {}) {
    if (this.sessionState === SESSION_STATES.OUTSIDE_SESSION) this.start();
    if (
      this.sessionState === SESSION_STATES.PAUSED ||
      this.sessionState === SESSION_STATES.SESSION_COMPLETE
    ) {
      return this.latestFrame;
    }

    const extracted = this.featureExtractor.update(level1State, {
      leadSide: sideOverrides.leadSide || this.techniquePackage.manifest.default_side,
      kickSide: sideOverrides.kickSide || this.techniquePackage.manifest.default_side
    });
    if (!extracted) return this.latestFrame;
    return this.updateFeatures({
      ...extracted,
      timestamp: level1State.timestamp,
      evaluationContext: sideOverrides.evaluationContext || {},
      learnedStatePrediction: sideOverrides.learnedStatePrediction || null,
      learnedModelExpected: Boolean(sideOverrides.learnedModelExpected),
      frameIndex: sideOverrides.frameIndex,
      videoTimestampMs: sideOverrides.videoTimestampMs,
      processingTimestampMs: sideOverrides.processingTimestampMs,
      deltaVideoMs: sideOverrides.deltaVideoMs
    });
  }

  updateFeatures({
    timestampMs,
    timestamp = timestampMs / 1000,
    features = {},
    trackingConfidence = 1,
    evaluationContext = {},
    learnedStatePrediction = null,
    learnedModelExpected = false,
    frameIndex = null,
    videoTimestampMs = timestampMs,
    processingTimestampMs = null,
    deltaVideoMs = null
  }) {
    if (
      this.sessionState === SESSION_STATES.PAUSED ||
      this.sessionState === SESSION_STATES.SESSION_COMPLETE
    ) {
      return this.latestFrame;
    }
    if (this.sessionState === SESSION_STATES.OUTSIDE_SESSION) this.start();
    this.sessionStartedAtMs ??= timestampMs;
    this.lastTimestampMs = timestampMs;
    const temporalInferenceSource =
      this.techniquePackage.getTemporalInferenceSource?.() || "auto";
    const learnedModelAllowed = this.analysisEngine === "auto"
      ? temporalInferenceSource !== "rules"
      : this.analysisEngine !== "rules";
    const hasLearnedPrediction = Boolean(learnedStatePrediction);
    const useLearnedModel = !this.activityDetector && learnedModelAllowed && this.analysisEngine !== "both" && (
      this.analysisEngine === "model" ||
      learnedModelExpected ||
      hasLearnedPrediction
    );
    const ruleStateScores = Object.fromEntries(
      this.techniquePackage.stateNames.map((stateName) => [
        stateName,
        evaluateRule(
          this.techniquePackage.getState(stateName).enter_rules,
          features,
          { previousFeatures: this.previousOfflineFeatures }
        ).score
      ])
    );
    const modelStateScores = Object.fromEntries(
      this.techniquePackage.stateNames.map((stateName) => [
        stateName,
        learnedStatePrediction?.probabilities?.[stateName] || 0
      ])
    );
    const stateScores = useLearnedModel ? modelStateScores : ruleStateScores;
    this.previousOfflineFeatures = { ...features };

    const legacyTemporal = useLearnedModel
      ? this.stateMachine.updateLearned({
          timestampMs,
          stateProbabilities: learnedStatePrediction?.probabilities || null,
          trackingConfidence
        })
      : this.stateMachine.update({ timestampMs, features, trackingConfidence });
    const detectorSnapshot = this.activityDetector?.update({
      timestampMs,
      features,
      trackingConfidence,
      trackingThreshold: this.policy.tracking_confidence_min
    }) || null;
    const segmented = detectorSnapshot
      ? this.phaseSegmenter.update(detectorSnapshot)
      : null;
    const temporal = segmented
      ? {
          ...legacyTemporal,
          state: segmented.state,
          phase: segmented.phase,
          confidence:
            detectorSnapshot.active?.detectionConfidence
            ?? legacyTemporal.confidence,
          tracking_lost:
            legacyTemporal.tracking_lost
            && !detectorSnapshot.tracking_gap_tolerated,
          unknown_movement: false
        }
      : legacyTemporal;
    if (temporal.tracking_lost) {
      if (this.sessionState !== SESSION_STATES.TRACKING_LOST) {
        this.stateBeforeTrackingLoss = this.sessionState;
      }
      this.sessionState = SESSION_STATES.TRACKING_LOST;
    } else if (this.sessionState === SESSION_STATES.TRACKING_LOST) {
      this.sessionState = this.stateBeforeTrackingLoss === SESSION_STATES.ACTIVE
        ? SESSION_STATES.ACTIVE
        : SESSION_STATES.READY;
    }
    if (
      temporal.event?.type === "state_initialized" &&
      this.sessionState === SESSION_STATES.READY
    ) {
      this.sessionState = SESSION_STATES.ACTIVE;
    }

    const initialState = this.techniquePackage.manifest.initial_state;
    const detectorEventTypes = new Set(
      (detectorSnapshot?.events || []).map((event) => event.type)
    );
    if (detectorSnapshot && detectorEventTypes.has("REP_START")) {
      this.beginRepetition(
        detectorSnapshot.events.find((event) => event.type === "REP_START").timestamp_ms
      );
    } else if (!detectorSnapshot && (
      temporal.event?.type === "state_transition" &&
      temporal.event.from_state === initialState &&
      temporal.event.to_state !== initialState &&
      !this.currentRepetition
    )) {
      this.beginRepetition(timestampMs);
    } else if (this.currentRepetition) {
      this.repState = REPETITION_STATES.REP_ACTIVE;
    } else if (
      [REPETITION_STATES.REP_COMPLETED, REPETITION_STATES.REP_ABORTED]
        .includes(this.repState)
    ) {
      this.repState = REPETITION_STATES.WAITING;
      this.repId = null;
    }

    if (this.currentRepetition && temporal.confidence > 0) {
      this.currentRepetition.state_confidences.push(temporal.confidence);
    }
    if (this.currentRepetition && detectorSnapshot) {
      this.currentRepetition.detector_events.push(...detectorSnapshot.events);
      this.currentRepetition.detector_confidence =
        detectorSnapshot.active?.detectionConfidence
        ?? this.currentRepetition.detector_confidence;
      detectorSnapshot.events.forEach((event) => {
        if (event.type === "PEAK") {
          this.currentRepetition.peak_ms = event.timestamp_ms;
          this.currentRepetition.phase_boundaries.peak_ms = event.timestamp_ms;
        }
        if (event.type === "RETURN_ZONE") {
          this.currentRepetition.phase_boundaries.return_zone_ms = event.timestamp_ms;
          this.currentRepetition.phase_boundaries.return_zone_entered_ms =
            event.entered_at_ms;
        }
      });
    }
    let pendingFinishStatus = null;
    if (detectorSnapshot && detectorEventTypes.has("REP_END")) {
      pendingFinishStatus = "completed";
    } else if (detectorSnapshot && detectorEventTypes.has("REP_TIMEOUT")) {
      pendingFinishStatus = "timeout";
    } else if (!detectorSnapshot && temporal.event?.repetition_completed) {
      pendingFinishStatus = "completed";
    } else if (!detectorSnapshot && (
      temporal.event?.type === "state_timeout" &&
      this.currentRepetition
    )) {
      pendingFinishStatus = "timeout";
    }

    if (!detectorSnapshot && temporal.unknown_movement) {
      this.unknownStartedAtMs ??= timestampMs;
      if (
        this.currentRepetition &&
        timestampMs - this.unknownStartedAtMs >= this.maximumUnknownMovementMs
      ) {
        this.finishRepetition(timestampMs, "unknown_movement");
        this.stateMachine.reset();
      }
    } else {
      this.unknownStartedAtMs = null;
    }

    const repetitionFeatures = {
      ...features,
      state_duration_ms: temporal.state_duration_ms,
      maximum_lead_elbow_angle: Math.max(
        features.lead_elbow_angle || 0,
        this.currentRepetition?.maximum_lead_elbow_angle || 0
      ),
      maximum_kick_knee_height: Math.max(
        features.kick_knee_height || 0,
        this.currentRepetition?.maximum_kick_knee_height || 0
      ),
      maximum_kick_knee_angle: Math.max(
        features.kick_knee_angle || 0,
        this.currentRepetition?.maximum_kick_knee_angle || 0
      ),
      minimum_recoil_knee_angle: Math.min(
        Number.isFinite(features.kick_knee_angle) ? features.kick_knee_angle : 180,
        this.currentRepetition?.minimum_recoil_knee_angle ?? 180
      )
    };
    if (this.currentRepetition) {
      Object.assign(this.currentRepetition, {
        maximum_lead_elbow_angle: repetitionFeatures.maximum_lead_elbow_angle,
        maximum_kick_knee_height: repetitionFeatures.maximum_kick_knee_height,
        maximum_kick_knee_angle: repetitionFeatures.maximum_kick_knee_angle,
        minimum_recoil_knee_angle: repetitionFeatures.minimum_recoil_knee_angle
      });
      if (Number.isFinite(features.rear_wrist_guard_distance)) {
        this.currentRepetition.metric_samples.rear_wrist_guard_distance.push(
          features.rear_wrist_guard_distance
        );
      }
      if (Number.isFinite(features.torso_lean)) {
        this.currentRepetition.metric_samples.torso_lean.push(features.torso_lean);
      }
    }
    const errors = this.errorEvaluator.update({
      timestampMs,
      state: temporal.state,
      features: repetitionFeatures,
      trackingConfidence: temporal.tracking_lost ? 0 : trackingConfidence,
      evaluationContext
    });
    errors.events.forEach((event) => {
      this.timeline.addEvent(event);
      if (
        event.type === "form_error_detected" &&
        this.currentRepetition &&
        !this.currentRepetition.form_errors.includes(event.error_id)
      ) {
        this.currentRepetition.form_errors.push(event.error_id);
      }
    });
    if (pendingFinishStatus) {
      this.finishRepetition(timestampMs, pendingFinishStatus);
    }

    this.updateStepDuration(temporal.state, timestampMs);
    const frame = {
      timestamp,
      timestamp_ms: timestampMs,
      frame_index: Number.isInteger(frameIndex) ? frameIndex : this.timeline.frames.length,
      video_timestamp_ms: Number.isFinite(videoTimestampMs) ? videoTimestampMs : timestampMs,
      processing_timestamp_ms: Number.isFinite(processingTimestampMs)
        ? processingTimestampMs
        : null,
      delta_video_ms: Number.isFinite(deltaVideoMs) ? deltaVideoMs : null,
      session_state: this.sessionState,
      technique: techniqueLabel(this.techniquePackage),
      technique_version: this.techniquePackage.version,
      mode: this.mode,
      rep_id: this.repId,
      rep_state: this.repState,
      step: temporal.state,
      phase: temporal.phase,
      canonical_phase: temporal.tracking_lost
        ? TRACKING_LOST_PHASE
        : segmented?.phase
          ? segmented.phase
        : temporal.unknown_movement || !temporal.state
          ? UNKNOWN_PHASE
          : this.techniquePackage.getCanonicalPhase?.(
              temporal.state,
              temporal.event,
              temporal.candidate_state
            ) || UNKNOWN_PHASE,
      confidence: temporal.confidence,
      tracking_confidence: trackingConfidence,
      tracking_lost: temporal.tracking_lost,
      unknown_movement: temporal.unknown_movement,
      features: repetitionFeatures,
      form_errors: errors.active_errors.map((error) => error.error_id),
      cue_timing_ms:
        this.currentRepetition?.response_time_ms ??
        (
          [REPETITION_STATES.REP_COMPLETED, REPETITION_STATES.REP_ABORTED]
            .includes(this.repState)
            ? this.repetitions[this.repetitions.length - 1]?.response_time_ms
            : null
        ) ??
        null,
      state_scores: stateScores,
      shadow_state_scores:
        this.analysisEngine === "both" && hasLearnedPrediction
          ? modelStateScores
          : useLearnedModel ? ruleStateScores : null,
      rule_state_scores: ruleStateScores,
      model_state_scores: hasLearnedPrediction ? modelStateScores : null,
      analysis_engine: this.analysisEngine,
      learned_state_prediction: learnedStatePrediction,
      learned_model_mode: useLearnedModel
        ? (learnedStatePrediction ? "primary" : "warming_up")
        : hasLearnedPrediction
          ? "shadow"
          : learnedModelAllowed ? "unavailable" : "disabled_by_technique",
      temporal_inference_source: useLearnedModel ? "onnx" : "rules",
      analysis_schema_version: this.analysisConfig?.schema_version || "1.0",
      activity_profile: this.analysisConfig?.activity_profile || null,
      detector: detectorSnapshot,
      rule_evidence: temporal.rule_evidence,
      temporal_event: temporal.event
    };
    this.timeline.record(frame);
    this.latestFrame = frame;
    return frame;
  }

  end(timestampMs = this.lastTimestampMs) {
    if (this.sessionState === SESSION_STATES.SESSION_COMPLETE) {
      return this.getSummary({ includeTimeline: true });
    }
    if (this.currentRepetition && Number.isFinite(timestampMs)) {
      this.finishRepetition(timestampMs, "session_ended");
    }
    this.updateStepDuration(null, timestampMs);
    this.timeline.close(timestampMs);
    this.sessionEndedAtMs = timestampMs;
    this.sessionState = SESSION_STATES.SESSION_COMPLETE;
    this.timeline.addEvent({
      type: "session_completed",
      timestamp_ms: timestampMs
    });
    if (this.policy.post_session_correction && !this.activityDetector) {
      this.correctedSession = postProcessSessionTimeline({
        frames: this.timeline.frames,
        techniquePackage: this.techniquePackage,
        config: {
          maximum_repairable_tracking_gap_ms:
            this.policy.maximum_repairable_tracking_gap_ms,
          maximum_unknown_movement_ms: this.maximumUnknownMovementMs,
          offline_decoder: this.policy.offline_decoder
        }
      });
    }
    return this.getSummary({ includeTimeline: true });
  }

  getSummary({ includeTimeline = false } = {}) {
    const completed = this.repetitions.filter(
      (repetition) => repetition.status === "completed"
    );
    const aborted = this.repetitions.filter(
      (repetition) => repetition.status !== "completed"
    );
    const errors = this.errorEvaluator.getOccurrences();
    const errorCounts = errors.reduce((counts, error) => ({
      ...counts,
      [error.error_id]: (counts[error.error_id] || 0) + 1
    }), {});
    const responseTimes = completed
      .map((repetition) => repetition.response_time_ms)
      .filter(Number.isFinite);
    const frameTracking = this.timeline.frames.map(
      (frame) => frame.tracking_confidence
    );
    const corrected = this.correctedSession;
    const correctedSummary = corrected?.summary;
    const finalRepetitions = corrected
      ? corrected.repetitions.map((repetition) => ({ ...repetition }))
      : this.repetitions.map((repetition) => ({ ...repetition }));
    const detectionConfidences = finalRepetitions
      .map((repetition) => repetition.detection_confidence ?? repetition.confidence)
      .filter(Number.isFinite);
    const techniqueQualities = finalRepetitions
      .map((repetition) => repetition.technique_quality)
      .filter(Number.isFinite);
    const meanQuality = average(techniqueQualities);
    const qualityDeviation = techniqueQualities.length
      ? Math.sqrt(average(techniqueQualities.map((value) => (value - meanQuality) ** 2)))
      : 0;
    const qualityOrdered = finalRepetitions
      .filter((repetition) => Number.isFinite(repetition.technique_quality))
      .sort((first, second) => second.technique_quality - first.technique_quality);
    const metricNames = new Set(
      finalRepetitions.flatMap((repetition) => Object.keys(repetition.metrics || {}))
    );
    const perFeatureStatistics = Object.fromEntries(
      [...metricNames].map((metricName) => {
        const values = finalRepetitions
          .map((repetition) => repetition.metrics?.[metricName])
          .filter(Number.isFinite);
        const mean = average(values);
        const variability = values.length
          ? Math.sqrt(average(values.map((value) => (value - mean) ** 2)))
          : null;
        return [metricName, {
          average: round(mean),
          variability: round(variability)
        }];
      })
    );
    const qualityChange = techniqueQualities.length > 1
      ? techniqueQualities.at(-1) - techniqueQualities[0]
      : 0;
    const summary = {
      session_state: this.sessionState,
      technique: techniqueLabel(this.techniquePackage),
      technique_version: this.techniquePackage.version,
      mode: this.mode,
      session_started_at_ms: this.sessionStartedAtMs,
      session_ended_at_ms: this.sessionEndedAtMs,
      total_repetitions:
        correctedSummary?.total_repetitions ?? this.repetitions.length,
      completed_repetitions:
        correctedSummary?.completed_repetitions ?? completed.length,
      aborted_repetitions:
        correctedSummary?.aborted_repetitions ?? aborted.length,
      detected_attempts: finalRepetitions.length,
      completed_motions: finalRepetitions.filter(
        (repetition) => repetition.status === "completed"
      ).length,
      detection_confidence: round(average(detectionConfidences)),
      technique_quality: round(meanQuality),
      consistency: round(Math.max(0, 1 - qualityDeviation)),
      average_rep_duration_ms: Math.round(average(
        finalRepetitions.map((repetition) => repetition.duration_ms)
      )),
      best_rep_id: qualityOrdered[0]?.rep_id ?? null,
      worst_rep_id: qualityOrdered.at(-1)?.rep_id ?? null,
      performance_trend: Math.abs(qualityChange) < 0.03
        ? "stable"
        : qualityChange > 0 ? "improving" : "declining",
      per_feature_statistics: perFeatureStatistics,
      average_accuracy:
        correctedSummary?.average_accuracy ??
        round(average(completed.map((repetition) => repetition.confidence))),
      average_response_time_ms:
        correctedSummary?.average_response_time_ms ??
        (
          responseTimes.length
            ? Math.round(average(responseTimes))
            : null
        ),
      per_step_duration_ms:
        correctedSummary?.per_step_duration_ms ??
        Object.fromEntries(
          [...this.stepDurations.entries()].map(([step, durations]) => [
            step,
            Math.round(average(durations))
          ])
        ),
      common_form_errors:
        correctedSummary?.common_form_errors ??
        Object.entries(errorCounts)
          .map(([error_id, count]) => ({ error_id, count }))
          .sort((first, second) => second.count - first.count),
      tracking_quality_percentage:
        correctedSummary?.tracking_quality_percentage ??
        round(average(frameTracking) * 100),
      tracking_quality: round(average(frameTracking)),
      repetitions: finalRepetitions,
      analysis_schema_version: this.analysisConfig?.schema_version || "1.0",
      post_session_corrected: Boolean(corrected),
      corrections_applied: correctedSummary?.corrections_applied ?? 0
    };
    if (includeTimeline) {
      summary.raw_timeline = this.timeline.getTimeline();
      summary.corrected_timeline = corrected ? cloneCorrectedTimeline(corrected) : null;
    }
    return summary;
  }
}

export { REPETITION_STATES, SESSION_STATES };
