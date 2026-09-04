import { scorePracticeAngles } from "./practiceAngleScoring.js";

const MOTION_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24];

export function resolvePracticeVideoDurationMs({
  mediaDurationSeconds,
  captureDurationMs,
  maximumDurationMs = 300_000
} = {}) {
  const maximum = Number(maximumDurationMs);
  const safeMaximum = Number.isFinite(maximum) && maximum > 0
    ? maximum
    : 300_000;
  const captured = Number(captureDurationMs);

  // MediaRecorder WebM blobs can report Infinity until their duration metadata
  // is repaired. Wall-clock capture time is authoritative for recordings made
  // by this component and prevents Infinity from being clamped to five minutes.
  if (Number.isFinite(captured) && captured > 0) {
    return Math.min(captured, safeMaximum);
  }

  const media = Number(mediaDurationSeconds) * 1000;
  return Number.isFinite(media) && media > 0
    ? Math.min(media, safeMaximum)
    : 0;
}

function poseMotion(previous = [], current = []) {
  const distances = MOTION_JOINTS.map((index) => {
    const from = previous[index];
    const to = current[index];
    return from && to ? Math.hypot(to.x - from.x, to.y - from.y) : null;
  }).filter(Number.isFinite);
  return distances.length
    ? distances.reduce((total, value) => total + value, 0) / distances.length
    : 0;
}

export function buildPracticeVideoReplayFrames({
  frames = [],
  steps = [],
  captureOffsetMs = 0
} = {}) {
  let previousPose = [];
  return frames.map((frame, index) => {
    const pose = frame.pose || [];
    const motionScore = poseMotion(previousPose, pose) * 10;
    previousPose = pose;
    const stepScores = steps.map((step) =>
      scorePracticeAngles(step?.angles || [], frame.angles || {}).accuracy
    );
    const accuracy = stepScores.length ? Math.max(...stepScores) : null;
    const elapsedMs = captureOffsetMs + Number(frame.elapsedMs || 0);
    return {
      frame: index + 1,
      elapsedMs,
      sourceTimestampMs: elapsedMs,
      rep: 1,
      step: 1,
      phase: "transition",
      temporalPhase: "waiting_for_movement",
      stateConfidence: 0,
      trackingReliable: Number(frame.trackingConfidence) >= 0.55,
      scorable: Number.isFinite(accuracy),
      accuracy,
      focusBodyPart: null,
      issue: null,
      wrongBodyParts: [],
      advisoryBodyParts: [],
      landmarks: pose.map((point) => ({ ...point })),
      observedLandmarks: pose.map((point) => ({ ...point })),
      measurementLandmarks: (frame.measurementPose || pose).map(
        (point) => ({ ...point })
      ),
      angles: { ...(frame.angles || {}) },
      stepScores,
      trackingConfidence: frame.trackingConfidence ?? null,
      displayPoseSource: "recorded-video",
      facePoints: [],
      faceSource: "pose33",
      handPoints: {},
      aggregateLandmarks: [],
      predictionSourceCounts: null,
      predictionAgreementError: null,
      usedPredictionFallback: false,
      predictionConfidence: null,
      forecastAwareness: null,
      motionScore
    };
  });
}

export function isUsablePracticeVideoReplay(
  replay,
  { minimumFrames = 24, minimumEffectiveFps = 8 } = {}
) {
  const durationSeconds = Number(replay?.durationMs) / 1000;
  const frameCount = replay?.frames?.length || 0;
  const effectiveFps = durationSeconds > 0 ? frameCount / durationSeconds : 0;
  return {
    usable: frameCount >= minimumFrames && effectiveFps >= minimumEffectiveFps,
    frameCount,
    effectiveFps
  };
}
