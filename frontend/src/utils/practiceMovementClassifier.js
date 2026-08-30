const DEFAULTS = {
  matchThreshold: 70,
  matchMargin: 6,
  exitThreshold: 58,
  minMotionScore: 0.025,
  fastImpactThreshold: 62,
  fastImpactMotionScore: 0.05,
  stableFrames: 3,
  exitFrames: 2,
  recoveryFrames: 3,
  stableDurationMs: 100,
  exitDurationMs: 70,
  recoveryDurationMs: 100,
  minTrackingConfidence: 0.55,
  maxUnreliableFrames: 4,
  scoreSmoothingAlpha: 0.58,
  maxInputGapMs: 250,
  maxImpactCandidateAgeMs: 300,
  adaptiveGapMultiplier: 3,
  maxAdaptiveGapMs: 900,
  recoveryAngleKey: null,
  recoveryBaselineToleranceDeg: 35,
  recoveryMinimumExcursionDeg: 35,
  recoveryBaselineMotionMax: 0.4,
  recoveryBaselineMaximumAngleDeg: 130
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createPracticeMovementClassifier({
  countStep,
  stepCount,
  targetReps,
  ...overrides
}) {
  const config = { ...DEFAULTS, ...overrides };
  const totalSteps = Math.max(1, Number(stepCount) || 1);
  const totalReps = Math.max(1, Number(targetReps) || 1);
  const hasExplicitCountStep = Number.isFinite(Number(countStep));
  const countStepIndex = Math.max(
    0,
    Math.min(totalSteps - 1, (Number(countStep) || totalSteps) - 1)
  );
  let expectedStepIndex = 0;
  let currentRep = 1;
  let stableMatchFrames = 0;
  let stableExitFrames = 0;
  let recoveryFrames = 0;
  let unreliableFrames = 0;
  let movementSeen = false;
  let impactCandidateSeen = false;
  let awaitingStepExit = false;
  let exitingStepIndex = null;
  let pendingCompletedRep = null;
  let smoothedStepScores = [];
  let completed = false;
  let lastInputTimestampMs = null;
  let impactCandidateTimestampMs = null;
  let lastResult = null;
  let recentInputIntervalsMs = [];
  let currentEvidenceGapThresholdMs = config.maxInputGapMs;
  let recoveryBaselineAngles = [];
  let impactPeakAngle = null;

  const median = (values) => {
    if (!values.length) return null;
    const ordered = [...values].sort((left, right) => left - right);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2
      ? ordered[middle]
      : (ordered[middle - 1] + ordered[middle]) / 2;
  };

  const requiredEvidenceFrames = (configuredFrames, durationMs) => {
    const frameLimit = Math.max(1, Number(configuredFrames) || 1);
    const typicalInputGapMs = median(recentInputIntervalsMs);
    if (!Number.isFinite(typicalInputGapMs) || typicalInputGapMs <= 0) {
      return frameLimit;
    }
    return Math.min(
      frameLimit,
      Math.max(1, Math.ceil(Math.max(0, Number(durationMs) || 0) / typicalInputGapMs))
    );
  };

  const createResult = ({
    rep = Math.min(currentRep, totalReps),
    step = expectedStepIndex + 1,
    expectedStep = expectedStepIndex + 1,
    phase = "transition",
    temporalPhase = "waiting_for_movement",
    scorable = false,
    matchedStep = null,
    matchKind,
    countedRep = null,
    completedRep = null,
    stateConfidence = 0,
    trackingReliable = true
  } = {}) => {
    lastResult = {
      rep,
      step,
      expectedStep,
      phase,
      temporalPhase,
      sequenceState: completed
        ? "complete"
        : pendingCompletedRep
          ? "recovering"
          : awaitingStepExit
            ? "transitioning"
            : "classifying",
      scorable,
      matchedStep,
      ...(matchKind ? { matchKind } : {}),
      countedRep,
      completedRep,
      stateConfidence: Math.round(clamp(stateConfidence, 0, 100)),
      trackingReliable,
      completed
    };
    return lastResult;
  };

  return {
    reset() {
      expectedStepIndex = 0;
      currentRep = 1;
      stableMatchFrames = 0;
      stableExitFrames = 0;
      recoveryFrames = 0;
      unreliableFrames = 0;
      movementSeen = false;
      impactCandidateSeen = false;
      impactCandidateTimestampMs = null;
      awaitingStepExit = false;
      exitingStepIndex = null;
      pendingCompletedRep = null;
      smoothedStepScores = [];
      completed = false;
      lastInputTimestampMs = null;
      lastResult = null;
      recentInputIntervalsMs = [];
      currentEvidenceGapThresholdMs = config.maxInputGapMs;
      recoveryBaselineAngles = [];
      impactPeakAngle = null;
    },

    update({
      motionScore = 0,
      stepScores = [],
      trackingConfidence = 1,
      timestampMs = null,
      angles = null
    } = {}) {
      const frameRep = Math.min(currentRep, totalReps);
      const frameStep = expectedStepIndex + 1;
      const numericTimestampMs =
        timestampMs === null || timestampMs === undefined || timestampMs === ""
          ? null
          : Number(timestampMs);
      if (Number.isFinite(numericTimestampMs)) {
        if (
          Number.isFinite(lastInputTimestampMs) &&
          numericTimestampMs <= lastInputTimestampMs
        ) {
          return lastResult
            ? { ...lastResult, countedRep: null, completedRep: null }
            : createResult({ rep: frameRep, step: frameStep });
        }
        const inputGapMs = Number.isFinite(lastInputTimestampMs)
          ? numericTimestampMs - lastInputTimestampMs
          : null;
        const typicalInputGapMs = recentInputIntervalsMs.length >= 3
          ? median(recentInputIntervalsMs)
          : null;
        currentEvidenceGapThresholdMs = Math.min(
          config.maxAdaptiveGapMs,
          Math.max(
            config.maxInputGapMs,
            Number(typicalInputGapMs || 0) * config.adaptiveGapMultiplier
          )
        );
        if (
          Number.isFinite(inputGapMs) &&
          inputGapMs > currentEvidenceGapThresholdMs
        ) {
          stableMatchFrames = 0;
          stableExitFrames = 0;
          recoveryFrames = 0;
          unreliableFrames = 0;
          movementSeen = false;
          impactCandidateSeen = false;
          impactCandidateTimestampMs = null;
          smoothedStepScores = [];
        }
        if (
          Number.isFinite(inputGapMs) &&
          inputGapMs > 0 &&
          inputGapMs <= config.maxAdaptiveGapMs
        ) {
          recentInputIntervalsMs = [
            ...recentInputIntervalsMs.slice(-11),
            inputGapMs
          ];
        }
        lastInputTimestampMs = numericTimestampMs;
      }

      if (completed) {
        return createResult({
          rep: totalReps,
          step: totalSteps,
          expectedStep: totalSteps,
          phase: "complete",
          temporalPhase: "session_complete",
          scorable: false,
          stateConfidence: 100
        });
      }

      const numericMotionScore = Number(motionScore) || 0;
      const rawRecoveryAngle = config.recoveryAngleKey
        ? angles?.[config.recoveryAngleKey]
        : null;
      const recoveryAngle =
        rawRecoveryAngle === null || rawRecoveryAngle === undefined
          ? null
          : Number(rawRecoveryAngle);
      const numericTrackingConfidence = Number.isFinite(Number(trackingConfidence))
        ? Number(trackingConfidence)
        : 1;
      const numericScores = Array.from(
        { length: totalSteps },
        (_, index) => Number(stepScores[index]) || 0
      );
      smoothedStepScores = numericScores.map((score, index) => {
        const previous = smoothedStepScores[index];
        if (!Number.isFinite(previous)) return score;
        return (
          previous * (1 - config.scoreSmoothingAlpha) +
          score * config.scoreSmoothingAlpha
        );
      });

      if (numericTrackingConfidence < config.minTrackingConfidence) {
        unreliableFrames += 1;
        if (unreliableFrames > config.maxUnreliableFrames) {
          stableMatchFrames = 0;
          stableExitFrames = 0;
          impactCandidateSeen = false;
          impactCandidateTimestampMs = null;
        }
        return createResult({
          rep: frameRep,
          step: frameStep,
          expectedStep: frameStep,
          temporalPhase: "tracking_lost",
          stateConfidence: numericTrackingConfidence * 100,
          trackingReliable: false
        });
      }
      unreliableFrames = 0;

      if (numericMotionScore >= config.minMotionScore) {
        movementSeen = true;
      }

      if (
        Number.isFinite(recoveryAngle) &&
        expectedStepIndex === countStepIndex &&
        !impactCandidateSeen &&
        numericMotionScore <= config.recoveryBaselineMotionMax &&
        recoveryAngle <= config.recoveryBaselineMaximumAngleDeg
      ) {
        recoveryBaselineAngles = [
          ...recoveryBaselineAngles.slice(-8),
          recoveryAngle
        ];
      }
      if (
        Number.isFinite(recoveryAngle) &&
        expectedStepIndex >= countStepIndex &&
        movementSeen
      ) {
        // Sparse sampling can observe maximum extension one callback after the
        // impact transition. Retain the largest excursion until Guard returns.
        impactPeakAngle = Math.max(
          Number(impactPeakAngle) || recoveryAngle,
          recoveryAngle
        );
      }

      if (pendingCompletedRep) {
        const finalScore = smoothedStepScores[totalSteps - 1] || 0;
        const requiresPoseRelease =
          totalSteps === 1 || countStepIndex === totalSteps - 1;
        const poseReleased = finalScore <= config.exitThreshold;
        stableExitFrames = poseReleased ? stableExitFrames + 1 : 0;
        recoveryFrames =
          numericMotionScore < config.minMotionScore
            ? recoveryFrames + 1
            : 0;
        const recoveryConfirmed =
          stableExitFrames >= requiredEvidenceFrames(
            config.exitFrames,
            config.exitDurationMs
          ) ||
          (!requiresPoseRelease && recoveryFrames >= requiredEvidenceFrames(
            config.recoveryFrames,
            config.recoveryDurationMs
          ));

        if (!recoveryConfirmed) {
          return createResult({
            rep: pendingCompletedRep,
            step: totalSteps,
            expectedStep: totalSteps,
            temporalPhase: "rep_recovery",
            stateConfidence: Math.max(100 - finalScore, recoveryFrames * 25)
          });
        }

        const completedRep = pendingCompletedRep;
        pendingCompletedRep = null;
        stableExitFrames = 0;
        recoveryFrames = 0;
        movementSeen = false;
        impactCandidateSeen = false;
        impactCandidateTimestampMs = null;
        impactPeakAngle = null;
        smoothedStepScores = [];

        if (completedRep >= totalReps) {
          completed = true;
        } else {
          currentRep += 1;
          expectedStepIndex = 0;
        }

        return createResult({
          rep: completedRep,
          step: totalSteps,
          expectedStep: completed ? totalSteps : 1,
          temporalPhase: completed ? "session_complete" : "rep_complete",
          completedRep,
          stateConfidence: 100
        });
      }

      if (awaitingStepExit) {
        const previousScore = smoothedStepScores[exitingStepIndex] || 0;
        const nextScore = smoothedStepScores[expectedStepIndex] || 0;
        const nextClearlyLeads =
          nextScore >= config.matchThreshold &&
          nextScore >= previousScore + config.matchMargin;
        const exitedPrevious =
          previousScore <= config.exitThreshold || nextClearlyLeads;
        stableExitFrames = exitedPrevious ? stableExitFrames + 1 : 0;

        if (stableExitFrames < requiredEvidenceFrames(
          config.exitFrames,
          config.exitDurationMs
        )) {
          return createResult({
            rep: frameRep,
            step: (exitingStepIndex ?? 0) + 1,
            expectedStep: frameStep,
            temporalPhase: "step_exit",
            stateConfidence: 100 - previousScore
          });
        }

        awaitingStepExit = false;
        exitingStepIndex = null;
        stableExitFrames = 0;
        stableMatchFrames = 0;
        return createResult({
          rep: frameRep,
          step: frameStep,
          expectedStep: frameStep,
          temporalPhase: "between_steps",
          stateConfidence: Math.max(nextScore, 100 - previousScore)
        });
      }

      const expectedScore = smoothedStepScores[expectedStepIndex] || 0;
      const rawExpectedScore = numericScores[expectedStepIndex] || 0;
      const bestScore = Math.max(0, ...smoothedStepScores);
      const expectedIsBest = expectedScore >= bestScore - config.matchMargin;
      const isInitialKeyframe = expectedStepIndex === 0;
      const matchesExpected =
        (movementSeen || isInitialKeyframe) &&
        expectedScore >= config.matchThreshold &&
        expectedIsBest;
      const isImpactStep =
        hasExplicitCountStep &&
        expectedStepIndex === countStepIndex;
      const fastImpactCandidate =
        isImpactStep &&
        movementSeen &&
        numericMotionScore >= config.fastImpactMotionScore &&
        rawExpectedScore >= config.fastImpactThreshold &&
        expectedIsBest;
      const impactCandidateExpired =
        impactCandidateSeen &&
        Number.isFinite(numericTimestampMs) &&
        Number.isFinite(impactCandidateTimestampMs) &&
        numericTimestampMs - impactCandidateTimestampMs >
          Math.max(
            config.maxImpactCandidateAgeMs,
            currentEvidenceGapThresholdMs
          );
      if (impactCandidateExpired) {
        impactCandidateSeen = false;
        impactCandidateTimestampMs = null;
      }
      const deferredImpactMatch =
        isImpactStep && impactCandidateSeen && !fastImpactCandidate;

      if (fastImpactCandidate) {
        impactCandidateSeen = true;
        impactCandidateTimestampMs = Number.isFinite(numericTimestampMs)
          ? numericTimestampMs
          : null;
        impactPeakAngle = Number.isFinite(recoveryAngle)
          ? Math.max(Number(impactPeakAngle) || recoveryAngle, recoveryAngle)
          : impactPeakAngle;
      }
      const recoveryBaselineAngle = median(recoveryBaselineAngles);
      const matchesPersonalRecovery =
        expectedStepIndex === totalSteps - 1 &&
        countStepIndex === totalSteps - 2 &&
        Number.isFinite(recoveryAngle) &&
        Number.isFinite(recoveryBaselineAngle) &&
        Number.isFinite(impactPeakAngle) &&
        impactPeakAngle - recoveryBaselineAngle >=
          config.recoveryMinimumExcursionDeg &&
        Math.abs(recoveryAngle - recoveryBaselineAngle) <=
          config.recoveryBaselineToleranceDeg;
      stableMatchFrames =
        !isImpactStep && (matchesExpected || matchesPersonalRecovery)
          ? stableMatchFrames + 1
          : 0;

      if (!deferredImpactMatch && stableMatchFrames < requiredEvidenceFrames(
        config.stableFrames,
        config.stableDurationMs
      )) {
        return createResult({
          rep: frameRep,
          step: frameStep,
          expectedStep: frameStep,
          phase:
            fastImpactCandidate || matchesExpected || matchesPersonalRecovery
              ? "keyframe"
              : "transition",
          temporalPhase: fastImpactCandidate
            ? "step_peak"
            : matchesExpected || matchesPersonalRecovery
              ? "step_enter"
              : movementSeen
                ? "seeking_step"
                : "waiting_for_movement",
          scorable:
            fastImpactCandidate || matchesExpected || matchesPersonalRecovery,
          stateConfidence: fastImpactCandidate
            ? rawExpectedScore
            : matchesPersonalRecovery
              ? 100 - Math.abs(recoveryAngle - recoveryBaselineAngle)
              : expectedScore
        });
      }

      const matchedStep = frameStep;
      const countedRep =
        expectedStepIndex === countStepIndex ? currentRep : null;
      const matchKind = deferredImpactMatch ? "impact-peak" : "stable";
      stableMatchFrames = 0;
      movementSeen =
        deferredImpactMatch && numericMotionScore >= config.minMotionScore;
      impactCandidateSeen = false;
      impactCandidateTimestampMs = null;
      const matchedPhase = deferredImpactMatch ? "transition" : "keyframe";
      const matchedScorable = !deferredImpactMatch;

      if (expectedStepIndex < totalSteps - 1) {
        const matchedStepIndex = expectedStepIndex;
        expectedStepIndex += 1;
        if (!deferredImpactMatch) {
          awaitingStepExit = true;
          exitingStepIndex = matchedStepIndex;
        }
        return createResult({
          rep: frameRep,
          step: matchedStep,
          expectedStep: expectedStepIndex + 1,
          phase: matchedPhase,
          temporalPhase: deferredImpactMatch ? "step_exit" : "step_hold",
          scorable: matchedScorable,
          matchedStep,
          matchKind,
          countedRep,
          stateConfidence: expectedScore
        });
      }

      // For cyclic techniques such as Jab, the final ordered step is already
      // the verified return-to-guard. Completing here prevents the first frame
      // of the next punch from being consumed as an extra release frame.
      if (hasExplicitCountStep && countStepIndex < totalSteps - 1) {
        const completedRep = currentRep;
        movementSeen = false;
        impactCandidateSeen = false;
        impactCandidateTimestampMs = null;
        impactPeakAngle = null;
        smoothedStepScores = [];

        if (completedRep >= totalReps) {
          completed = true;
        } else {
          currentRep += 1;
          expectedStepIndex = 0;
        }

        return createResult({
          rep: completedRep,
          step: matchedStep,
          expectedStep: completed ? totalSteps : 1,
          phase: matchedPhase,
          temporalPhase: completed ? "session_complete" : "rep_complete",
          scorable: matchedScorable,
          matchedStep,
          matchKind,
          countedRep,
          completedRep,
          stateConfidence: expectedScore
        });
      }

      pendingCompletedRep = currentRep;
      recoveryFrames = 0;
      stableExitFrames = 0;
      return createResult({
        rep: currentRep,
        step: matchedStep,
        expectedStep: totalSteps,
        phase: matchedPhase,
        temporalPhase: "rep_peak",
        scorable: matchedScorable,
        matchedStep,
        matchKind,
        countedRep,
        stateConfidence: expectedScore
      });
    },

    getState() {
      return {
        rep: Math.min(currentRep, totalReps),
        expectedStep: expectedStepIndex + 1,
        completed
      };
    }
  };
}

function averageEvidence(frames, centerIndex, key, radius = 2) {
  const start = Math.max(0, centerIndex - radius);
  const end = Math.min(frames.length, centerIndex + radius + 1);
  const values = frames
    .slice(start, end)
    .map((frame) => Number(frame?.[key]))
    .filter(Number.isFinite);

  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function smoothStepEvidence(frames, centerIndex, stepCount, radius = 2) {
  return Array.from({ length: stepCount }, (_, stepIndex) => {
    const start = Math.max(0, centerIndex - radius);
    const end = Math.min(frames.length, centerIndex + radius + 1);
    const values = frames
      .slice(start, end)
      .map((frame) => Number(frame?.stepScores?.[stepIndex]))
      .filter(Number.isFinite);

    if (!values.length) return 0;
    return values.reduce((total, value) => total + value, 0) / values.length;
  });
}

export function reclassifyPracticeSequence(
  frames,
  {
    countStep,
    stepCount,
    targetReps,
    evidenceRadius = 2,
    ...classifierOverrides
  }
) {
  if (!frames?.length) return [];

  const totalSteps = Math.max(1, Number(stepCount) || 1);
  const classifier = createPracticeMovementClassifier({
    countStep,
    stepCount: totalSteps,
    targetReps,
    ...classifierOverrides
  });
  let lastSourceTimestamp = null;
  let lastClassification = null;

  return frames.map((frame, index) => {
    const sourceTimestamp = Number(frame.sourceTimestampMs);
    const isDuplicateSource =
      Number.isFinite(sourceTimestamp) &&
      sourceTimestamp === lastSourceTimestamp &&
      lastClassification;
    const classification = isDuplicateSource
      ? lastClassification
      : classifier.update({
          motionScore:
            averageEvidence(frames, index, "motionScore", evidenceRadius) ||
            frame.motionScore ||
            0,
          stepScores: smoothStepEvidence(
            frames,
            index,
            totalSteps,
            evidenceRadius
          ),
          trackingConfidence:
            averageEvidence(
              frames,
              index,
              "trackingConfidence",
              evidenceRadius
            ) ?? frame.trackingConfidence ?? 1,
          timestampMs: Number.isFinite(sourceTimestamp)
            ? sourceTimestamp
            : frame.elapsedMs,
          angles: frame.angles || null
        });

    if (!isDuplicateSource) {
      lastSourceTimestamp = Number.isFinite(sourceTimestamp)
        ? sourceTimestamp
        : null;
      lastClassification = classification;
    }

    return {
      ...frame,
      liveRep: frame.rep,
      liveStep: frame.step,
      livePhase: frame.phase,
      liveTemporalPhase: frame.temporalPhase,
      rep: classification.rep,
      step: classification.step,
      phase: classification.phase,
      temporalPhase: classification.temporalPhase,
      sequenceState: classification.sequenceState,
      expectedStep: classification.expectedStep,
      matchedStep: classification.matchedStep,
      matchKind: classification.matchKind || null,
      countedRep: classification.countedRep,
      completedRep: classification.completedRep,
      stateConfidence: classification.stateConfidence,
      trackingReliable: classification.trackingReliable,
      scorable: classification.scorable,
      postSessionClassified: true
    };
  });
}

export function attachCountAttention(frames, countMarkers, gapMs) {
  const toleranceMs = Math.max(160, Math.round(gapMs * 0.14));
  const responseEvents = [];
  const seenReps = new Set();

  frames.forEach((frame) => {
    if (frame?.countedRep == null) return;
    const completedImpact = Number(frame?.countedRep);
    if (!Number.isFinite(completedImpact) || seenReps.has(completedImpact)) return;
    seenReps.add(completedImpact);
    responseEvents.push({
      rep: completedImpact,
      elapsedMs: Number(frame.elapsedMs)
    });
  });

  const usedResponses = new Set();
  const markers = countMarkers.map((marker, index) => {
    const windowStart = Math.max(0, marker.elapsedMs - gapMs * 0.25);
    const windowEnd = countMarkers[index + 1]?.elapsedMs ?? marker.elapsedMs + gapMs;
    const responseIndex = responseEvents.findIndex(
      (event, eventIndex) =>
        !usedResponses.has(eventIndex) &&
        event.elapsedMs >= windowStart &&
        event.elapsedMs <= windowEnd
    );
    const response = responseIndex >= 0 ? responseEvents[responseIndex] : null;
    if (responseIndex >= 0) usedResponses.add(responseIndex);
    const offsetMs = response
      ? Math.round(response.elapsedMs - marker.elapsedMs)
      : null;
    const timing = !Number.isFinite(offsetMs)
      ? "no-response"
      : offsetMs < -toleranceMs
        ? "early"
        : offsetMs > toleranceMs
          ? "late"
          : "on-time";

    return {
      ...marker,
      cue: index + 1,
      movementPeakMs: response?.elapsedMs ?? null,
      responseRep: response?.rep ?? null,
      offsetMs,
      timing
    };
  });

  return frames.map((frame) => {
    const marker =
      [...markers].reverse().find((candidate) => candidate.elapsedMs <= frame.elapsedMs) ||
      markers[0];

    return {
      ...frame,
      countCue: marker?.cue ?? null,
      countTimestampMs: marker?.elapsedMs ?? null,
      attentionOffsetMs: marker?.offsetMs ?? null,
      attentionTiming: marker?.timing || "no-response",
      movementPeakMs: marker?.movementPeakMs ?? null
    };
  });
}

export function getPracticeCuePrompt({
  cueCount,
  targetReps,
  repCount,
  recoveryRemainingMs,
  isReadyForRep
}) {
  const finalCueReached = cueCount >= targetReps;
  if (finalCueReached && repCount < targetReps) {
    return recoveryRemainingMs > 0
      ? `Final cue — finish the movement (${(recoveryRemainingMs / 1000).toFixed(1)}s)`
      : "Waiting for a complete movement";
  }
  if (recoveryRemainingMs > 0) {
    return `Next count in ${(recoveryRemainingMs / 1000).toFixed(1)}s`;
  }
  return isReadyForRep ? "Move — I’m watching the rep" : "Reading movement";
}

export function shouldExpireUnmatchedPracticeSet({
  sessionStatus,
  cueCount,
  targetReps,
  repCount
}) {
  return (
    sessionStatus === "active" &&
    cueCount >= targetReps &&
    repCount < targetReps
  );
}

export function shouldProcessPracticeFrame({
  sessionStatus,
  classifierReady,
  recordingStarted
}) {
  return (
    sessionStatus === "active" &&
    classifierReady === true &&
    recordingStarted === true
  );
}

export function trimPracticeTapeFrames(
  frames,
  {
    paddingBeforeMs = 700,
    paddingAfterMs = 700,
    motionThreshold = 0.02,
    maximumLeadInMs = 2500,
    maximumRecoveryMs = 2500,
    preparationContextMs = 1500
  } = {}
) {
  if (!frames?.length) return [];

  const classifiedFrames = frames.filter((frame) =>
    frame.scorable === true ||
    ["step_enter", "step_hold", "step_peak", "rep_peak"].includes(
      frame.temporalPhase
    )
  );
  const activeFrames = classifiedFrames.length
    ? classifiedFrames
    : frames.filter(
        (frame) => (Number(frame.motionScore) || 0) >= motionThreshold
      );
  if (!activeFrames.length) return frames.map((frame) => ({ ...frame }));

  const repetitionPeaks = frames.filter(
    (frame) => frame.temporalPhase === "rep_peak"
  );
  const firstPeakMs = repetitionPeaks[0]?.elapsedMs;
  const lastPeakMs = repetitionPeaks[repetitionPeaks.length - 1]?.elapsedMs;
  const endpointScore = (frame) => {
    const scores = frame?.stepScores || [];
    return Math.max(
      Number(scores[0]) || 0,
      Number(scores[Math.max(0, scores.length - 1)]) || 0
    );
  };
  const impactScore = (frame) => Number(frame?.stepScores?.[1]) || 0;
  let confirmedRecoveryMs = null;
  let recoveryRunLength = 0;
  if (Number.isFinite(lastPeakMs)) {
    for (const frame of frames) {
      if (frame.elapsedMs <= lastPeakMs) continue;
      const returnedToEndpoint =
        endpointScore(frame) >= 75 &&
        endpointScore(frame) - impactScore(frame) >= 5;
      recoveryRunLength = returnedToEndpoint ? recoveryRunLength + 1 : 0;
      if (recoveryRunLength >= 3) {
        confirmedRecoveryMs = frame.elapsedMs;
        break;
      }
    }
  }
  const firstProgressionFrame = repetitionPeaks.length
    ? frames.find(
        (frame) =>
          frame.elapsedMs <= firstPeakMs &&
          Number(frame.step) > 1 &&
          !["waiting_for_movement", "seeking_step"].includes(
            frame.temporalPhase
          )
      )
    : null;
  const boundedStartMs = firstProgressionFrame
    ? firstProgressionFrame.elapsedMs - preparationContextMs
    : firstPeakMs - maximumLeadInMs;
  const boundedActiveFrames = repetitionPeaks.length
    ? activeFrames.filter(
        (frame) =>
          frame.elapsedMs >= boundedStartMs &&
          frame.elapsedMs <= lastPeakMs + maximumRecoveryMs
      )
    : activeFrames;
  const relevantFrames = boundedActiveFrames.length
    ? boundedActiveFrames
    : repetitionPeaks;
  const firstActivityMs = relevantFrames[0].elapsedMs;
  const lastActivityMs = relevantFrames[relevantFrames.length - 1].elapsedMs;
  const startMs = Math.max(
    0,
    Math.min(
      firstActivityMs - paddingBeforeMs,
      Number.isFinite(boundedStartMs)
        ? boundedStartMs
        : firstActivityMs - paddingBeforeMs
    )
  );
  const endMs =
    (Number.isFinite(confirmedRecoveryMs)
      ? confirmedRecoveryMs
      : lastActivityMs) + paddingAfterMs;

  return frames
    .filter((frame) => frame.elapsedMs >= startMs && frame.elapsedMs <= endMs)
    .map((frame, index) => ({
      ...frame,
      frame: index + 1,
      elapsedMs: frame.elapsedMs - startMs,
      countTimestampMs: Number.isFinite(frame.countTimestampMs)
        ? frame.countTimestampMs - startMs
        : frame.countTimestampMs,
      movementPeakMs: Number.isFinite(frame.movementPeakMs)
        ? frame.movementPeakMs - startMs
        : frame.movementPeakMs
    }));
}

export function filterPracticeTapeFrames(
  frames,
  { rep = "all", step = "all" } = {}
) {
  return frames
    .map((frame, index) => ({ frame, index }))
    .filter(
      ({ frame }) =>
        (
          rep === "all" ||
          (frame.analysisRep ?? frame.rep) === Number(rep)
        ) &&
        (step === "all" ||
          (frame.step === Number(step) && frame.scorable !== false))
    );
}
