import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import ActionSkeletonOverlay from "../components/ActionSkeletonOverlay";
import AwarenessPanel from "../components/AwarenessPanel";
import BodyCalibrationPanel from "../components/BodyCalibrationPanel";
import DataLayersPanel from "../components/DataLayersPanel";
import DiagnosticTraceControls from "../components/DiagnosticTraceControls";
import Level1DebugPanel from "../components/Level1DebugPanel";
import Level2DebugPanel from "../components/Level2DebugPanel";
import SkeletonCanvas from "../components/SkeletonCanvas";
import MetricsPanel from "../components/MetricsPanel";
import { AuthContext } from "../context/auth";
import { canAccessPlan, formatPlanName } from "../data/planAccess";
import { getTechniqueFromCatalog } from "../data/techniqueCatalog";
import {
  createBrowserAudio,
  playBrowserAudio,
  prepareBrowserSpeech
} from "../services/browserVoice";
import {
  getCoachFeedbackIntent,
  getCoachGuidanceCooldownKey,
  getStableCorrectionTarget,
  repeatsPendingQuestion,
  shouldSpeakVisibleCoachFeedback
} from "../services/feedbackReasoning";
import {
  formatDegreeAwareAngleFeedback,
  revalidateQueuedAngleFeedback
} from "../services/feedbackMessageFormatter";
import { selectExpectedVoiceCommand } from "../services/voiceCommandRecognition";
import {
  createDiagnosticTraceRecorder,
  downloadDiagnosticTrace
} from "../services/diagnosticTraceRecorder";
import {
  buildCorrectionAcknowledgement,
  buildNaturalAwarenessFeedback,
  FORM_DIFFICULTIES,
  scoreCompositeForm
} from "../utils/compositeFormScoring";
import {
  buildStepTransitionFeedback,
  parseTrainingStepCommand
} from "../utils/trainingStepNavigation";

const VOICE_PROFILES = {
  calmMale: {
    label: "Master Male",
    gender: "male",
    pitch: 0.72,
    rate: 0.92
  },
  calmFemale: {
    label: "Master Female",
    gender: "female",
    pitch: 1.04,
    rate: 0.88
  }
};

const ACTION_LABELS = {
  ask_ready: "Ready check",
  confirm_start: "Ready check",
  ask_resume: "Resume check",
  correct: "Correction",
  observe: "Watching",
  hold_good: "Hold good form",
  advance_step: "Next step",
  confirm_next: "Step complete",
  attention_prompt: "Reply needed",
  clarify: "Choose a reply",
  repeat_step: "Repeating step",
  restart_training: "Restarting",
  wait: "Waiting",
  waiting: "Waiting",
  switch_practice: "Practice mode",
  repeat: "Repeat step",
  step_transition: "Changing step"
};

// These events make the current instruction obsolete. Live pose corrections do
// not interrupt speech; only the newest pending correction is kept instead.
const VOICE_INTERRUPT_ACTIONS = new Set([
  "advance_step",
  "session_complete_prompt",
  "restart_training",
  "switch_practice",
  "ask_ready",
  "confirm_start",
  "repeat_step",
  "step_transition"
]);

const NATURAL_VOICE_CACHE_LIMIT = 24;
const MASTERY_HOLD_MS = 1200;
const STABLE_CORRECTION_CONFIRM_MS = 500;
const GUIDANCE_COOLDOWN_MS = 12000;
const DIAGNOSTIC_TRACE_ENABLED = import.meta.env.DEV;
const splitVoiceWords = (message) =>
  message
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const coachText = (event) =>
  (event?.message || event?.summary || "")
    .replace(/\s+/g, " ")
    .trim();

const coachVoiceText = (event) =>
  (event?.voice_message || event?.message || event?.summary || "")
    .replace(/\s+/g, " ")
    .trim();

const formatBodyPart = (bodyPart) =>
  bodyPart
    ? bodyPart.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "";

const normalizeCoachMessage = (message) =>
  message.toLowerCase().replace(/\d+/g, "#");

export default function TrainMode({
  categorySlug,
  displayMirrored = true,
  onModeChange,
  selectedTechniqueName,
  subcategorySlug,
  textEnabled = true,
  voiceEnabled = true,
  isAdminStudio = false,
  performanceProfile = "student",
  performanceMode = "auto",
  skeletonLayers = {},
  bodyCalibration,
  stanceTargetDegrees = 0,
  onStanceTargetChange,
  inputSource = "live",
  inputVideoUrl,
  inputVideoName,
  onInputStatus,
  onPredictionStatus
}) {
  const currentTechnique = useMemo(
    () =>
      getTechniqueFromCatalog({
        categorySlug,
        subcategorySlug,
        techniqueName: selectedTechniqueName
      }),
    [categorySlug, selectedTechniqueName, subcategorySlug]
  );
  const { userPlan = "FREE_PLAN" } = useContext(AuthContext) || {};

  const steps = useMemo(() => currentTechnique?.steps || [], [currentTechnique]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [angles, setAngles] = useState({});
  const [, setServerAccuracy] = useState(0);
  const [formDifficulty, setFormDifficulty] = useState(
    () => localStorage.getItem("studioFormDifficulty") || "medium"
  );
  const [masteryThreshold, setMasteryThreshold] = useState(() => {
    const stored = Number(localStorage.getItem("studioMasteryThreshold"));
    return Number.isFinite(stored) && stored >= 70 && stored <= 95 ? stored : 80;
  });
  const [ruleEngineFrame, setRuleEngineFrame] = useState(null);
  const [coachEvent, setCoachEvent] = useState(null);
  const feedback = coachText(coachEvent);
  const [awareness, setAwareness] = useState(null);
  const [level1State, setLevel1State] = useState(null);
  const [level2State, setLevel2State] = useState(null);
  const [level3State, setLevel3State] = useState(null);
  const [level4State, setLevel4State] = useState(null);
  const [situationAwarenessState, setSituationAwarenessState] = useState(null);
  const [trainSessionStarted, setTrainSessionStarted] = useState(false);
  const [ruleEngineSessionSummary, setRuleEngineSessionSummary] = useState(null);
  const [showAdvancedAnalysis, setShowAdvancedAnalysis] = useState(false);
  const [showDataLayers, setShowDataLayers] = useState(false);
  const [showConversationHistory, setShowConversationHistory] = useState(false);
  const voiceProfile = "calmMale";
  const [coachInput, setCoachInput] = useState("");
  const [coachCommand, setCoachCommand] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [handsFreeEnabled, setHandsFreeEnabled] = useState(true);
  const [voiceInputStatus, setVoiceInputStatus] = useState(
    "Hands-free listening is starting."
  );
  const [conversation, setConversation] = useState([]);
  const [coachResponsePending, setCoachResponsePending] = useState(false);
  const [diagnosticTraceActive, setDiagnosticTraceActive] = useState(false);
  const [diagnosticTraceCount, setDiagnosticTraceCount] = useState(0);
  const [voiceState, setVoiceState] = useState("idle");
  const [currentVoiceMessage, setCurrentVoiceMessage] = useState("");
  const [voiceWords, setVoiceWords] = useState([]);
  const [activeVoiceWord, setActiveVoiceWord] = useState(-1);
  const recognitionRef = useRef(null);
  const responseInputRef = useRef(null);
  const shouldListenRef = useRef(true);
  const listeningRef = useRef(false);
  const restartListenTimerRef = useRef(null);
  const lastTechniqueIdRef = useRef(null);
  const lastCoachChatRef = useRef("");
  const lastCoachChatPatternRef = useRef("");
  const lastCoachIntentRef = useRef("");
  const lastGuidanceAtRef = useRef(new Map());
  const lastSpokenMessageRef = useRef("");
  const lastSpokenIntentRef = useRef("");
  const announcedEntryStepRef = useRef("");
  const pendingStepTransitionRef = useRef(null);
  const masteryHoldRef = useRef({ key: "", firstSeenAt: 0, prompted: false });
  const pendingCoachResponseRef = useRef(null);
  const submittedCoachResponseRef = useRef(null);
  const coachResponseTimeoutRef = useRef(null);
  const compositeFeedbackRef = useRef({
    signature: "",
    firstSeenAt: 0,
    lastSpokenAt: 0,
    recentParts: new Map(),
    activeCorrection: null,
    stepKey: ""
  });
  const localFeedbackPriorityUntilRef = useRef(0);
  const currentAudioRef = useRef(null);
  const voiceRequestIdRef = useRef(0);
  const voiceQueueRef = useRef([]);
  const isSpeakingRef = useRef(false);
  const wordTimerRef = useRef(null);
  const voiceWordsRef = useRef([]);
  const naturalVoiceCacheRef = useRef(new Map());
  const naturalVoiceRequestsRef = useRef(new Map());
  const diagnosticContextRef = useRef({});
  const latestDiagnosticFrameRef = useRef(null);
  const lastDiagnosticCoachSignatureRef = useRef("");
  const lastDiagnosticCountUiAtRef = useRef(0);
  const diagnosticRecorderRef = useRef(null);
  if (DIAGNOSTIC_TRACE_ENABLED && !diagnosticRecorderRef.current) {
    diagnosticRecorderRef.current = createDiagnosticTraceRecorder();
  }
  const safeStepIndex =
    steps.length > 0 ? Math.min(currentStepIndex, steps.length - 1) : 0;
  const currentStep = steps[safeStepIndex];
  const currentStepName = currentStep?.step_name;
  const requiredParts = useMemo(() => currentStep?.angles || [], [currentStep]);
  const displayAngleParts = useMemo(
    () => currentStep?.evaluation_profile?.full_body_angles || requiredParts,
    [currentStep, requiredParts]
  );
  const expectedGuideParts = useMemo(
    () => [...displayAngleParts, ...(currentStep?.quality_targets || [])],
    [currentStep, displayAngleParts]
  );
  const compositeForm = useMemo(
    () =>
      scoreCompositeForm({
        angleTargets: currentStep?.angle_targets || displayAngleParts,
        difficulty: formDifficulty,
        difficultyProfiles: currentStep?.difficulty_profiles,
        liveAngles: angles,
        liveFeatures: ruleEngineFrame?.features || {},
        nonAngleTargets: currentStep?.non_angle_features || [],
        qualityTargets: currentStep?.quality_targets || [],
        feedbackPriority: currentStep?.feedback_priority || []
      }),
    [angles, currentStep, displayAngleParts, formDifficulty, ruleEngineFrame]
  );
  const feedbackAngleParts = useMemo(() => {
    const angleParts = displayAngleParts.map((target) => {
      return { ...target };
    });
    const qualityParts = (currentStep?.quality_targets || []).map((target) =>
      ({
        ...target,
        body_part: target.body_part || target.feature
      })
    );
    return [...angleParts, ...qualityParts];
  }, [currentStep, displayAngleParts]);
  const selectFormDifficulty = useCallback((difficulty) => {
    if (!FORM_DIFFICULTIES.includes(difficulty)) return;
    setFormDifficulty(difficulty);
    localStorage.setItem("studioFormDifficulty", difficulty);
  }, []);
  const masterMessage =
    textEnabled
      ? (voiceEnabled && currentVoiceMessage ? currentVoiceMessage : coachText(coachEvent)) ||
        feedback ||
        "Step into frame. Feedback starts when your pose is detected."
      : "Text feedback is off.";
  const coachStateLabel =
    textEnabled
      ? ACTION_LABELS[coachEvent?.action] ||
        ACTION_LABELS[coachEvent?.state] ||
        "Master watching"
      : "Text off";
  const eventCoachMessage = coachText(coachEvent);
  const isPlayingEarlierFeedback = Boolean(
    voiceEnabled &&
    currentVoiceMessage &&
    eventCoachMessage &&
    currentVoiceMessage !== eventCoachMessage
  );
  const focusLabel = isPlayingEarlierFeedback
    ? ""
    : formatBodyPart(coachEvent?.focus_body_part || coachEvent?.body_part);
  const replyOptions = useMemo(
    () => coachEvent?.question?.options || [],
    [coachEvent?.question?.options]
  );
  const requiresResponse = Boolean(
    !coachResponsePending && coachEvent?.requires_response && replyOptions.length
  );
  const trainSessionComplete = [
    "confirm_session_complete",
    "session_complete"
  ].includes(coachEvent?.state) || coachEvent?.action === "session_complete_prompt";
  const trainSessionActive = trainSessionStarted && !trainSessionComplete;
  const trainSessionPaused =
    trainSessionActive && Boolean(coachEvent?.memory?.paused);
  const trainSessionState = trainSessionComplete
    ? "SESSION_COMPLETE"
    : trainSessionPaused
      ? "PAUSED"
      : trainSessionStarted
        ? "ACTIVE"
        : "READY";
  const liveRepetitionSummary =
    level3State?.session_context?.repetition_summary || null;
  const liveTrackingQuality = Number.isFinite(level3State?.debug?.average_tracking)
    ? Math.round(level3State.debug.average_tracking * 100)
    : null;
  const sessionConfig = useMemo(
    () => ({
      technique_name: currentTechnique?.name || "this technique",
      mode: "train",
      voice_profile: voiceProfile,
      step_index: safeStepIndex,
      total_steps: steps.length
    }),
    [currentTechnique?.name, safeStepIndex, steps.length, voiceProfile]
  );

  diagnosticContextRef.current = {
    awareness,
    compositeForm,
    coachEvent,
    formDifficulty,
    level1State,
    level2State,
    level3State,
    level4State,
    masteryThreshold,
    ruleEngineFrame,
    situationAwarenessState,
    step: {
      id: currentStep?.id || null,
      index: safeStepIndex,
      name: currentStepName || null
    },
    session: {
      active: trainSessionActive,
      paused: trainSessionPaused,
      state: trainSessionState
    },
    targets: feedbackAngleParts,
    liveAngles: angles,
    voice: {
      hands_free: handsFreeEnabled,
      input_status: voiceInputStatus,
      is_listening: isListening,
      state: voiceState
    }
  };

  const handleDiagnosticFrame = useCallback((frame) => {
    if (!DIAGNOSTIC_TRACE_ENABLED) return;
    latestDiagnosticFrameRef.current = frame;
  }, []);

  const syncDiagnosticTraceCount = useCallback((force = false) => {
    const now = performance.now();
    if (!force && now - lastDiagnosticCountUiAtRef.current < 1000) return;
    lastDiagnosticCountUiAtRef.current = now;
    setDiagnosticTraceCount(diagnosticRecorderRef.current?.size() || 0);
  }, []);

  const startDiagnosticTrace = useCallback(() => {
    if (!diagnosticRecorderRef.current) return;
    diagnosticRecorderRef.current.start({
      app: "XMartialArt Studio",
      input_source: inputSource,
      mode: "train",
      performance_mode: performanceMode,
      performance_profile: performanceProfile,
      technique: currentTechnique?.name || selectedTechniqueName || "unknown",
      technique_id: currentTechnique?.id || null
    });
    lastDiagnosticCoachSignatureRef.current = "";
    setDiagnosticTraceActive(true);
    syncDiagnosticTraceCount(true);
  }, [
    currentTechnique,
    inputSource,
    performanceMode,
    performanceProfile,
    selectedTechniqueName,
    syncDiagnosticTraceCount
  ]);

  const stopDiagnosticTrace = useCallback(() => {
    diagnosticRecorderRef.current?.stop();
    setDiagnosticTraceActive(false);
    syncDiagnosticTraceCount(true);
  }, [syncDiagnosticTraceCount]);

  const clearDiagnosticTrace = useCallback(() => {
    diagnosticRecorderRef.current?.clear();
    setDiagnosticTraceActive(false);
    setDiagnosticTraceCount(0);
  }, []);

  const downloadTrace = useCallback(() => {
    if (diagnosticRecorderRef.current) {
      downloadDiagnosticTrace(diagnosticRecorderRef.current);
    }
  }, []);

  const recordDiagnosticEvent = useCallback((kind, payload = {}) => {
    if (!DIAGNOSTIC_TRACE_ENABLED) return;
    if (diagnosticRecorderRef.current?.event(kind, {
      step: diagnosticContextRef.current.step,
      ...payload
    })) {
      syncDiagnosticTraceCount();
    }
  }, [syncDiagnosticTraceCount]);

  useEffect(() => {
    if (!DIAGNOSTIC_TRACE_ENABLED || !coachEvent) return;
    const signature = JSON.stringify([
      coachEvent.action || null,
      coachText(coachEvent),
      coachEvent.focus_body_part || coachEvent.body_part || null,
      coachEvent.issue || null,
      coachEvent.question?.kind || null,
      Boolean(coachEvent.requires_response),
      coachEvent.voice_message || null,
      coachEvent.request_id || null
    ]);
    if (signature === lastDiagnosticCoachSignatureRef.current) return;
    lastDiagnosticCoachSignatureRef.current = signature;
    if (diagnosticRecorderRef.current.event("coach", {
      step: diagnosticContextRef.current.step,
      request_id: coachEvent.request_id || null,
      feedback: {
        action: coachEvent.action || null,
        message: coachText(coachEvent),
        voice_message: coachEvent.voice_message || coachText(coachEvent),
        display_message: coachEvent.display_message || coachText(coachEvent),
        feedback_detail: coachEvent.feedback_detail || null,
        speak: shouldSpeakVisibleCoachFeedback(coachEvent),
        focus_body_part: coachEvent.focus_body_part || coachEvent.body_part || null,
        issue: coachEvent.issue || null,
        requires_response: Boolean(coachEvent.requires_response),
        question: coachEvent.question || null
      }
    })) {
      syncDiagnosticTraceCount();
    }
  }, [coachEvent, syncDiagnosticTraceCount]);

  useEffect(() => {
    if (!DIAGNOSTIC_TRACE_ENABLED || !diagnosticTraceActive) return undefined;
    const capture = () => {
      const latest = latestDiagnosticFrameRef.current || {};
      try {
        const accepted = diagnosticRecorderRef.current?.frame({
          ...latest,
          timestamp: performance.now(),
          angles: latest.angles || diagnosticContextRef.current.liveAngles,
          trackingConfidence:
            latest.trackingConfidence ??
            diagnosticContextRef.current.level1State?.tracking?.confidence
        }, diagnosticContextRef.current);
        if (accepted) syncDiagnosticTraceCount();
      } catch (error) {
        diagnosticRecorderRef.current?.event("diagnostic_capture_error", {
          message: error?.message || "Diagnostic interval capture failed"
        });
      }
    };
    capture();
    const timer = window.setInterval(capture, 200);
    return () => window.clearInterval(timer);
  }, [diagnosticTraceActive, syncDiagnosticTraceCount]);

  useEffect(() => () => {
    if (diagnosticRecorderRef.current?.isActive()) {
      diagnosticRecorderRef.current.stop("component_unmounted");
    }
  }, []);

  const goToStepIndex = useCallback((nextIndex) => {
    setCurrentStepIndex((index) => {
      if (steps.length === 0) return 0;
      if (!Number.isInteger(nextIndex)) return index;

      return Math.max(0, Math.min(nextIndex, steps.length - 1));
    });
  }, [steps.length]);

  const appendConversation = useCallback((item) => {
    setConversation((items) => {
      const lastItem = items[items.length - 1];

      if (lastItem?.role === item.role && lastItem?.text === item.text) {
        return items;
      }

      return [...items.slice(-7), item];
    });
  }, []);

  useEffect(() => {
    const situation = situationAwarenessState?.situation_context;
    const awarenessPriority = ["tracking_unclear", "warning"].includes(
      situation?.situation_state
    );
    const stableCorrectionTarget = getStableCorrectionTarget(situation);
    const correctionStateConfirmed = stableCorrectionTarget !== undefined;
    const now = Date.now();
    const feedbackState = compositeFeedbackRef.current;
    const stepKey = currentStep?.id || currentStepName || "";
    if (feedbackState.stepKey !== stepKey) {
      feedbackState.stepKey = stepKey;
      feedbackState.signature = "";
      feedbackState.activeCorrection = null;
      feedbackState.recentParts.clear();
    }
    const previousCorrection = feedbackState.activeCorrection;
    const previousResolved = Boolean(
      previousCorrection &&
      !compositeForm.corrections.some(
        (item) => item.bodyPart === previousCorrection.bodyPart
      )
    );

    if (
      (!textEnabled && !voiceEnabled) ||
      !trainSessionActive ||
      requiresResponse ||
      (
        !awarenessPriority &&
        (
          !compositeForm.scorable ||
          compositeForm.coverage < 50 ||
          (!correctionStateConfirmed && !previousResolved) ||
          (
            correctionStateConfirmed &&
            stableCorrectionTarget &&
            !compositeForm.corrections.some(
              (item) => item.bodyPart === stableCorrectionTarget
            )
          ) ||
          (!compositeForm.corrections.length && !previousResolved)
        )
      )
    ) {
      return;
    }

    const eligibleCorrections = correctionStateConfirmed
      ? compositeForm.corrections.filter(
          (item) => !stableCorrectionTarget || item.bodyPart === stableCorrectionTarget
        )
      : [];
    const correction = awarenessPriority
      ? null
      : eligibleCorrections.find(
          (item) =>
            now - (feedbackState.recentParts.get(item.bodyPart) || 0) >= 14000
        ) || eligibleCorrections[0];
    const signature = awarenessPriority
      ? `awareness:${situation.situation_state}`
      : previousResolved
        ? `confirmed:${stepKey}:${previousCorrection.bodyPart}:${correction?.bodyPart || "hold"}`
      : [
          stepKey,
          correction.bodyPart,
          correction.direction
        ].join(":");

    if (feedbackState.signature !== signature) {
      feedbackState.signature = signature;
      feedbackState.firstSeenAt = now;
      return;
    }
    if (
      now - feedbackState.firstSeenAt < (
        awarenessPriority ? 700 : previousResolved ? 900 : STABLE_CORRECTION_CONFIRM_MS
      ) ||
      now - feedbackState.lastSpokenAt < (previousResolved ? 3200 : 7500) ||
      (
        correction && !previousResolved &&
        now - (feedbackState.recentParts.get(correction.bodyPart) || 0) < 14000
      )
    ) {
      return;
    }

    const naturalMessage = previousResolved && !awarenessPriority
      ? buildCorrectionAcknowledgement(previousCorrection, correction)
      : buildNaturalAwarenessFeedback({
          correction,
          form: compositeForm,
          situation,
          stepName: currentStepName,
          strength: compositeForm.strengths?.find(
            (item) => item.bodyPart !== correction?.bodyPart
          )
        });
    const angleFeedback = !previousResolved && !awarenessPriority
      ? formatDegreeAwareAngleFeedback(correction)
      : null;
    const message = angleFeedback?.displayMessage || naturalMessage;
    const voiceMessage = angleFeedback?.voiceMessage || naturalMessage;
    if (!message || !voiceMessage) return;
    feedbackState.lastSpokenAt = now;
    if (correction) {
      feedbackState.recentParts.set(correction.bodyPart, now);
    }
    feedbackState.activeCorrection = awarenessPriority ? null : correction;
    localFeedbackPriorityUntilRef.current = now + 4000;
    setCoachEvent({
      action: awarenessPriority ? "attention_prompt" : previousResolved ? "hold_good" : "correct",
      message,
      summary: message,
      voice_message: voiceMessage,
      display_message: message,
      feedback_detail: angleFeedback?.details || null,
      speak: true,
      feedback_intent: `composite:${signature}`,
      focus_body_part:
        correction?.bodyPart || situation?.attention_target?.body_part || "whole_body",
      evidence: {
        accuracy: compositeForm.accuracy,
        coverage: compositeForm.coverage,
        group: correction?.group || "awareness",
        situation_state: situation?.situation_state,
        current_angle: angleFeedback?.details?.current_angle ?? null,
        ideal_angle: angleFeedback?.details?.ideal_angle ?? null,
        adjustment_degrees: angleFeedback?.details?.adjustment_degrees ?? null
      }
    });
    setCoachCommand({
      id: `feedback-${signature}-${now}`,
      type: "feedback_observed",
      message,
      action: awarenessPriority ? "attention_prompt" : previousResolved ? "hold_good" : "correct",
      bodyPart: correction?.bodyPart || situation?.attention_target?.body_part || "whole_body",
      issue: correction?.issue || situation?.attention_target?.issue || null,
      accuracy: compositeForm.accuracy,
      coverage: compositeForm.coverage
    });
    if (textEnabled) {
      appendConversation({ role: "ai", text: message });
    }
  }, [
    appendConversation,
    compositeForm,
    currentStep?.id,
    currentStepName,
    requiresResponse,
    textEnabled,
    trainSessionActive,
    voiceEnabled,
    situationAwarenessState
  ]);

  const handleCoachEvent = useCallback((event) => {
    const submittedResponseId = submittedCoachResponseRef.current;
    if (submittedResponseId) {
      if (event?.request_id !== submittedResponseId) {
        return;
      }
      submittedCoachResponseRef.current = null;
      if (coachResponseTimeoutRef.current) {
        window.clearTimeout(coachResponseTimeoutRef.current);
        coachResponseTimeoutRef.current = null;
      }
      setCoachResponsePending(false);
    }
    const isNonQuestionGuidance = !event?.requires_response && [
      "attention_prompt",
      "fatigue_warning",
      "ask_focus"
    ].includes(event?.action);
    if (
      pendingCoachResponseRef.current &&
      (["correct", "observe", "hold_good", "waiting"].includes(event?.action) ||
        isNonQuestionGuidance)
    ) {
      return;
    }
    if (
      Date.now() < localFeedbackPriorityUntilRef.current &&
      (["correct", "observe", "hold_good", "waiting"].includes(event?.action) ||
        isNonQuestionGuidance)
    ) {
      return;
    }

    const guidanceKey = getCoachGuidanceCooldownKey(event);
    if (guidanceKey) {
      const now = Date.now();
      const lastGuidanceAt = lastGuidanceAtRef.current.get(guidanceKey) || 0;
      if (now - lastGuidanceAt < GUIDANCE_COOLDOWN_MS) return;
      lastGuidanceAtRef.current.set(guidanceKey, now);
    }
    if (event?.memory?.ready || event?.action === "restart_training") {
      setTrainSessionStarted(true);
    }

    if (event?.action === "advance_step") {
      const nextIndex = Number.isInteger(event.next_step_index)
        ? event.next_step_index
        : Math.min(safeStepIndex + 1, steps.length - 1);
      const nextStep = steps[nextIndex];
      const transitionMessage = buildStepTransitionFeedback({
        fromStep: currentStep,
        toStep: nextStep,
        form: compositeForm,
        direction: 1
      });
      const transitionEvent = {
        ...event,
        action: "step_transition",
        message: transitionMessage,
        summary: transitionMessage,
        voice_message: transitionMessage,
        feedback_intent: `step_transition:${nextStep?.id || nextIndex}`,
        focus_body_part:
          nextStep?.angle_targets?.find((target) => target.role === "primary")
            ?.body_part || null
      };
      localFeedbackPriorityUntilRef.current = Date.now() + 5000;
      pendingStepTransitionRef.current = transitionEvent;
      setCoachEvent(transitionEvent);
      if (textEnabled) {
        appendConversation({ role: "ai", text: transitionMessage });
      }
      goToStepIndex(nextIndex);
      return;
    }

    const message = coachText(event);
    const messagePattern = normalizeCoachMessage(message);
    const feedbackIntent = getCoachFeedbackIntent(event);
    const repeatsQuestion = repeatsPendingQuestion(event, lastCoachIntentRef.current);
    const isRepeatedCorrection =
      event?.action === "correct" &&
      messagePattern === lastCoachChatPatternRef.current;
    const isRepeatedWaitingState =
      event?.action === "waiting" && repeatsQuestion;
    if (!isRepeatedWaitingState && !(isRepeatedCorrection && !event?.speak)) {
      setCoachEvent(event);
    }
    const shouldAddCoachMessage =
      message &&
      message !== lastCoachChatRef.current &&
      !repeatsQuestion &&
      !isRepeatedCorrection &&
      (
        messagePattern !== lastCoachChatPatternRef.current ||
        event?.speak ||
        event?.action !== "correct"
      );

    if (textEnabled && shouldAddCoachMessage) {
      lastCoachChatRef.current = message;
      lastCoachChatPatternRef.current = messagePattern;
      lastCoachIntentRef.current = feedbackIntent;
      appendConversation({ role: "ai", text: message });
    }

    if (
      event?.action === "session_complete_prompt" &&
      Number.isInteger(event.current_step_index)
    ) {
      goToStepIndex(event.current_step_index);
      return;
    }

    if (event?.action === "restart_training") {
      setRuleEngineSessionSummary(null);
      setCurrentStepIndex(0);
      return;
    }

    if (event?.action === "switch_practice" && onModeChange) {
      onModeChange("practice");
    }
  }, [
    appendConversation,
    compositeForm,
    currentStep,
    goToStepIndex,
    onModeChange,
    safeStepIndex,
    steps,
    textEnabled
  ]);

  const handleAngleUpdate = useCallback((liveAngles) => {
    setAngles(liveAngles);
  }, []);

  const clearVoiceWords = useCallback(() => {
    if (wordTimerRef.current) {
      window.clearInterval(wordTimerRef.current);
      wordTimerRef.current = null;
    }

    voiceWordsRef.current = [];
    setVoiceWords([]);
    setActiveVoiceWord(-1);
  }, []);

  const prepareVoiceWords = useCallback((message) => {
    const words = splitVoiceWords(message);

    if (wordTimerRef.current) {
      window.clearInterval(wordTimerRef.current);
      wordTimerRef.current = null;
    }

    voiceWordsRef.current = words;
    setVoiceWords(words);
    setActiveVoiceWord(-1);
  }, []);

  const startVoiceWordProgress = useCallback(() => {
    const words = voiceWordsRef.current;

    if (wordTimerRef.current) {
      window.clearInterval(wordTimerRef.current);
      wordTimerRef.current = null;
    }

    setActiveVoiceWord(words.length ? 0 : -1);

    if (words.length <= 1) {
      return;
    }

    wordTimerRef.current = window.setInterval(() => {
      setActiveVoiceWord((index) => {
        if (index + 1 >= words.length) {
          if (wordTimerRef.current) {
            window.clearInterval(wordTimerRef.current);
            wordTimerRef.current = null;
          }
          return index;
        }

        return index + 1;
      });
    }, 360);
  }, []);

  const stopCurrentVoice = useCallback(() => {
    voiceRequestIdRef.current += 1;
    voiceQueueRef.current = [];
    isSpeakingRef.current = false;
    setVoiceState("idle");
    setCurrentVoiceMessage("");
    clearVoiceWords();

    if (currentAudioRef.current) {
      const audio = currentAudioRef.current;
      currentAudioRef.current = null;
      audio.pause();
      audio.src = "";
    }
  }, [clearVoiceWords]);

  const interruptVoicePlayback = useCallback(() => {
    voiceRequestIdRef.current += 1;
    voiceQueueRef.current = [];
    isSpeakingRef.current = false;
    setCurrentVoiceMessage("");

    if (currentAudioRef.current) {
      const audio = currentAudioRef.current;
      currentAudioRef.current = null;
      audio.pause();
      audio.src = "";
    }
  }, []);

  const sendCoachMessage = useCallback((message) => {
    const trimmed = message.trim();

    if (!trimmed) return;
    const commandId = `${Date.now()}-${trimmed}`;
    if (DIAGNOSTIC_TRACE_ENABLED && diagnosticRecorderRef.current.event("user_response", {
      step: diagnosticContextRef.current.step,
      message: trimmed,
      request_id: commandId,
      voice: diagnosticContextRef.current.voice
    })) {
      syncDiagnosticTraceCount();
    }
    const wasAwaitingCoachResponse = Boolean(
      pendingCoachResponseRef.current || requiresResponse
    );
    if (wasAwaitingCoachResponse) {
      submittedCoachResponseRef.current = commandId;
      setCoachResponsePending(true);
      if (coachResponseTimeoutRef.current) {
        window.clearTimeout(coachResponseTimeoutRef.current);
      }
      coachResponseTimeoutRef.current = window.setTimeout(() => {
        if (submittedCoachResponseRef.current !== commandId) return;
        submittedCoachResponseRef.current = null;
        coachResponseTimeoutRef.current = null;
        setCoachResponsePending(false);
      }, 6000);
    }
    if (pendingCoachResponseRef.current) {
      pendingCoachResponseRef.current = null;
      localFeedbackPriorityUntilRef.current = Date.now() + 3000;
    }

    // When the coach owns the turn, send even navigation-like answers back to
    // the coach so its pending question and session memory advance together.
    const navigation = wasAwaitingCoachResponse
      ? null
      : parseTrainingStepCommand(trimmed, steps.length);
    if (navigation) {
      if (textEnabled) {
        appendConversation({ role: "user", text: trimmed });
      }
      const nextIndex =
        navigation.type === "index"
          ? navigation.index
          : Math.max(
              0,
              Math.min(safeStepIndex + navigation.delta, steps.length - 1)
            );
      const nextStep = steps[nextIndex];
      const transitionMessage = buildStepTransitionFeedback({
        fromStep: currentStep,
        toStep: nextStep,
        form: compositeForm,
        direction:
          navigation.type === "delta"
            ? navigation.delta
            : nextIndex >= safeStepIndex
              ? 1
              : -1
      });
      const transitionEvent = {
        action: "step_transition",
        message: transitionMessage,
        summary: transitionMessage,
        speak: true,
        focus_body_part:
          nextStep?.angle_targets?.find((target) => target.role === "primary")
            ?.body_part || null
      };
      if (nextIndex !== safeStepIndex) {
        pendingStepTransitionRef.current = transitionEvent;
        setCurrentStepIndex(nextIndex);
      }
      setCoachEvent(transitionEvent);
      if (textEnabled) {
        appendConversation({ role: "ai", text: transitionMessage });
      }
      setCoachInput("");
      return;
    }

    setCoachCommand({
      id: commandId,
      message: trimmed
    });
    if (textEnabled) {
      appendConversation({ role: "user", text: trimmed });
    }
    setCoachInput("");
  }, [
    appendConversation,
    compositeForm,
    currentStep,
    requiresResponse,
    safeStepIndex,
    steps,
    syncDiagnosticTraceCount,
    textEnabled
  ]);

  const stopVoiceInput = useCallback((status = "Hands-free listening is off.") => {
    shouldListenRef.current = false;
    listeningRef.current = false;
    setIsListening(false);
    setVoiceInputStatus(status);

    if (restartListenTimerRef.current) {
      window.clearTimeout(restartListenTimerRef.current);
      restartListenTimerRef.current = null;
    }

    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, []);

  const startVoiceInput = useCallback((manualStart = false) => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setHandsFreeEnabled(false);
      setVoiceInputStatus("Speech recognition is not supported in this browser.");
      return;
    }

    if (listeningRef.current || recognitionRef.current) {
      return;
    }

    if (voiceState === "speaking" || voiceState === "loading") {
      setVoiceInputStatus("Listening resumes after the coach speaks.");
      return;
    }

    shouldListenRef.current = handsFreeEnabled || manualStart;

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    const browserLanguage = navigator.language || "en-US";
    recognition.lang = /^en(?:-|$)/i.test(browserLanguage) ? browserLanguage : "en-US";
    // One focused utterance finalizes much faster than continuous dictation.
    // onend already restarts listening when another answer is needed.
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;

    let finalTranscript = "";

    recognition.onstart = () => {
      listeningRef.current = true;
      setIsListening(true);
      recordDiagnosticEvent("voice_listening_started", {
        requires_response: requiresResponse,
        reply_options: replyOptions.map((option) => option.value)
      });
      setVoiceInputStatus(
        requiresResponse
          ? "Your turn. Say one of the reply choices or type below."
          : "Listening. Say ready, next, wait, practice, or start again."
      );
    };
    recognition.onend = () => {
      listeningRef.current = false;
      recognitionRef.current = null;
      setIsListening(false);
      recordDiagnosticEvent("voice_listening_ended", {
        will_restart: Boolean(shouldListenRef.current && handsFreeEnabled)
      });

      if (shouldListenRef.current && handsFreeEnabled) {
        setVoiceInputStatus("Listening again in a moment.");
        restartListenTimerRef.current = window.setTimeout(() => {
          startVoiceInput(false);
        }, requiresResponse ? 150 : 450);
      }
    };
    recognition.onerror = (event) => {
      listeningRef.current = false;
      recognitionRef.current = null;
      setIsListening(false);
      recordDiagnosticEvent("voice_error", { error: event.error || "unknown" });

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldListenRef.current = false;
        setHandsFreeEnabled(false);
        setVoiceInputStatus("Microphone permission is blocked. Allow mic access to use hands-free control.");
        return;
      }

      setVoiceInputStatus(
        event.error === "no-speech"
          ? "I did not hear a command. Listening again."
          : "Voice input paused. Tap listen to restart."
      );
    };
    recognition.onresult = (event) => {
      const finalAlternatives = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript || "";

        if (result?.isFinal) {
          if (transcript.trim()) finalTranscript += ` ${transcript.trim()}`;
          for (let alternativeIndex = 0; alternativeIndex < result.length; alternativeIndex += 1) {
            const alternativeTranscript = result[alternativeIndex]?.transcript?.trim();
            if (!alternativeTranscript) continue;
            finalAlternatives.push({
              transcript: alternativeTranscript,
              confidence: result[alternativeIndex]?.confidence
            });
          }
        } else if (transcript.trim()) {
          setVoiceInputStatus(`Hearing: ${transcript.trim()}`);
        }
      }

      const selected = selectExpectedVoiceCommand(finalAlternatives, requiresResponse ? replyOptions : []);
      const command = selected?.command || (!requiresResponse ? finalTranscript.trim() : "");
      if (finalAlternatives.length) {
        recordDiagnosticEvent("voice_final_result", {
          alternatives: finalAlternatives,
          selected_command: command || null,
          accepted: Boolean(command),
          requires_response: requiresResponse
        });
      }
      if (command) {
        sendCoachMessage(command);
        setVoiceInputStatus(`Answer heard: ${selected?.transcript || command}`);
        finalTranscript = "";
        recognition.stop();
      } else if (finalAlternatives.length && requiresResponse) {
        setVoiceInputStatus("I heard you, but not a reply choice. Listening again.");
        finalTranscript = "";
        recognition.stop();
      }
    };

    try {
      recognition.start();
    } catch (error) {
      recognitionRef.current = null;
      listeningRef.current = false;
      setIsListening(false);
      setVoiceInputStatus("Voice input could not start. Tap listen again.");
      recordDiagnosticEvent("voice_start_failed", {
        error: error?.message || "recognition.start failed"
      });
    }
  }, [
    handsFreeEnabled,
    recordDiagnosticEvent,
    replyOptions,
    requiresResponse,
    sendCoachMessage,
    voiceState
  ]);

  const getNaturalVoiceKey = useCallback((message) => {
    const profile = VOICE_PROFILES[voiceProfile];
    return `${profile.gender}:${profile.rate}:${profile.pitch}:${message}`;
  }, [voiceProfile]);

  const cacheNaturalVoice = useCallback((key, data) => {
    const cache = naturalVoiceCacheRef.current;

    if (cache.has(key)) {
      cache.delete(key);
    }

    cache.set(key, data);

    while (cache.size > NATURAL_VOICE_CACHE_LIMIT) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }
  }, []);

  const fetchNaturalVoice = useCallback(async (message) => {
    const profile = VOICE_PROFILES[voiceProfile];

    const cacheKey = getNaturalVoiceKey(message);
    const cached = naturalVoiceCacheRef.current.get(cacheKey);

    if (cached) {
      return cached;
    }

    if (naturalVoiceRequestsRef.current.has(cacheKey)) {
      return naturalVoiceRequestsRef.current.get(cacheKey);
    }

    const request = (async () => {
      try {
        const data = prepareBrowserSpeech(message, {
          gender: profile.gender,
          rate: profile.rate,
          pitch: profile.pitch,
          volume: 1
        });
        cacheNaturalVoice(cacheKey, data);
        return data;
      } catch {
        return null;
      } finally {
        naturalVoiceRequestsRef.current.delete(cacheKey);
      }
    })();

    naturalVoiceRequestsRef.current.set(cacheKey, request);
    return request;
  }, [cacheNaturalVoice, getNaturalVoiceKey, voiceProfile]);

  const playNaturalAudio = useCallback(async (message, data, requestId) => {
    if (!data || requestId !== voiceRequestIdRef.current) {
      return false;
    }

    const playback = createBrowserAudio(data);
    if (!playback) return false;

    const { audio, release } = playback;
    currentAudioRef.current = audio;

    const played = await new Promise((resolve) => {
      const timeoutMs = Math.max(2200, splitVoiceWords(message).length * 700);
      let settled = false;
      let playbackTimeoutId = null;
      let playbackStartedAt = 0;
      const finish = (ok, reason) => {
        if (settled) return;
        settled = true;
        if (playbackTimeoutId) window.clearTimeout(playbackTimeoutId);
        if (reason === "timeout") {
          audio.pause();
        }
        release();
        if (currentAudioRef.current === audio) {
          currentAudioRef.current = null;
        }
        recordDiagnosticEvent("voice_playback_finished", {
          message,
          reason,
          duration_ms: playbackStartedAt
            ? Math.round(performance.now() - playbackStartedAt)
            : 0
        });
        resolve(ok);
      };

      audio.onplay = () => {
        playbackStartedAt = performance.now();
        recordDiagnosticEvent("voice_playback_started", {
          message,
          word_count: splitVoiceWords(message).length
        });
        setVoiceState("speaking");
        startVoiceWordProgress();
        playbackTimeoutId = window.setTimeout(() => finish(true, "timeout"), timeoutMs);
      };
      audio.onended = () => finish(true, "ended");
      audio.onerror = () => finish(false, "error");
      playBrowserAudio(audio).catch(() => finish(false, "play_failed"));
    });

    return played;
  }, [recordDiagnosticEvent, startVoiceWordProgress]);

  const speakWithBestVoice = useCallback(async (message, requestId) => {
    const cacheKey = getNaturalVoiceKey(message);
    const cached = naturalVoiceCacheRef.current.get(cacheKey);

    if (cached) {
      const played = await playNaturalAudio(message, cached, requestId);
      if (played) return;
    }

    setVoiceState("loading");
    const naturalVoice = await fetchNaturalVoice(message);

    if (!naturalVoice || requestId !== voiceRequestIdRef.current) {
      setVoiceState("idle");
      clearVoiceWords();
      return;
    }

    const played = await playNaturalAudio(message, naturalVoice, requestId);

    if (!played) {
      setVoiceState("idle");
      clearVoiceWords();
    }
  }, [clearVoiceWords, fetchNaturalVoice, getNaturalVoiceKey, playNaturalAudio]);

  const playVoiceQueue = useCallback(async () => {
    if (isSpeakingRef.current || !voiceEnabled) {
      return;
    }

    const nextItem = voiceQueueRef.current.shift();

    if (!nextItem) {
      setVoiceState("idle");
      clearVoiceWords();
      return;
    }

    let nextMessage = typeof nextItem === "string" ? nextItem : nextItem.message;
    if (typeof nextItem !== "string" && nextItem.feedbackDetail?.kind === "angle") {
      const validation = revalidateQueuedAngleFeedback(
        nextItem.feedbackDetail,
        diagnosticContextRef.current
      );
      if (!validation.valid) {
        recordDiagnosticEvent("voice_feedback_discarded", {
          feedback_detail: nextItem.feedbackDetail,
          reason: validation.reason
        });
        setVoiceState("idle");
        clearVoiceWords();
        if (voiceQueueRef.current.length) window.setTimeout(playVoiceQueue, 0);
        return;
      }
      nextMessage = validation.formatted?.voiceMessage || nextMessage;
    }

    if (!nextMessage || nextMessage === lastSpokenMessageRef.current) {
      setVoiceState("idle");
      clearVoiceWords();
      if (voiceQueueRef.current.length) window.setTimeout(playVoiceQueue, 0);
      return;
    }

    isSpeakingRef.current = true;
    const requestId = voiceRequestIdRef.current;
    lastSpokenMessageRef.current = nextMessage;
    lastSpokenIntentRef.current = typeof nextItem === "string"
      ? ""
      : nextItem.feedbackIntent;
    setCurrentVoiceMessage(nextMessage);
    prepareVoiceWords(nextMessage);

    await speakWithBestVoice(nextMessage, requestId);

    if (requestId === voiceRequestIdRef.current) {
      isSpeakingRef.current = false;
      if (voiceQueueRef.current.length) {
        playVoiceQueue();
      } else {
        setVoiceState("idle");
        window.setTimeout(() => {
          clearVoiceWords();
          setCurrentVoiceMessage("");
        }, 420);
      }
    }
  }, [
    clearVoiceWords,
    prepareVoiceWords,
    recordDiagnosticEvent,
    speakWithBestVoice,
    voiceEnabled
  ]);

  const queueVoiceMessage = useCallback((
    message,
    { feedbackDetail = null, feedbackIntent = "", interrupt = false } = {}
  ) => {
    const trimmed = message.trim();
    const pendingMessage = voiceQueueRef.current[0]?.message || voiceQueueRef.current[0] || "";
    const repeatsPendingQuestion = Boolean(
      feedbackIntent.startsWith("question:") &&
      feedbackIntent === lastSpokenIntentRef.current
    );

    if (
      !trimmed ||
      trimmed === lastSpokenMessageRef.current ||
      trimmed === pendingMessage ||
      repeatsPendingQuestion
    ) {
      return;
    }

    const queuedFeedback = {
      message: trimmed,
      feedbackDetail,
      feedbackIntent
    };
    recordDiagnosticEvent("voice_feedback_queued", {
      message: trimmed,
      feedback_intent: feedbackIntent,
      interrupt,
      waiting_for_active_speech: isSpeakingRef.current
    });

    if (interrupt) {
      interruptVoicePlayback();
      voiceQueueRef.current = [queuedFeedback];
    } else {
      // Pose analysis can emit several corrections per second. Finish the
      // sentence being spoken and replace stale pending feedback with the
      // latest useful correction.
      voiceQueueRef.current = [queuedFeedback];
    }
    playVoiceQueue();
  }, [interruptVoicePlayback, playVoiceQueue, recordDiagnosticEvent]);

  useEffect(() => {
    const message = coachVoiceText(coachEvent);

    if (
      !voiceEnabled ||
      !message ||
      !shouldSpeakVisibleCoachFeedback(coachEvent) ||
      message === lastSpokenMessageRef.current
    ) {
      return;
    }

    queueVoiceMessage(message, {
      feedbackIntent: getCoachFeedbackIntent(coachEvent),
      feedbackDetail: coachEvent?.feedback_detail || null,
      interrupt: VOICE_INTERRUPT_ACTIONS.has(coachEvent?.action)
    });
  }, [coachEvent, queueVoiceMessage, voiceEnabled]);

  useEffect(() => {
    if (!voiceEnabled) {
      stopCurrentVoice();
    }
  }, [stopCurrentVoice, voiceEnabled]);

  useEffect(() => {
    shouldListenRef.current = handsFreeEnabled;

    if (!handsFreeEnabled) {
      stopVoiceInput();
      return;
    }

    if (voiceState === "speaking" || voiceState === "loading") {
      stopVoiceInput("Listening resumes after the coach speaks.");
      shouldListenRef.current = true;
      return;
    }

    startVoiceInput(false);
  }, [handsFreeEnabled, startVoiceInput, stopVoiceInput, voiceState]);

  useEffect(() => {
    if (!requiresResponse) return undefined;

    const focusTimer = window.setTimeout(() => {
      responseInputRef.current?.focus({ preventScroll: true });
    }, 80);

    setVoiceInputStatus(
      voiceState === "speaking" || voiceState === "loading"
        ? "Your turn is next. Listening starts when the coach finishes."
        : handsFreeEnabled
          ? "Your turn. Listening for your answer."
          : "Your turn. Type an answer or tap the microphone."
    );

    return () => window.clearTimeout(focusTimer);
  }, [handsFreeEnabled, requiresResponse, voiceState]);

  useEffect(() => () => {
    shouldListenRef.current = false;
    listeningRef.current = false;
    voiceRequestIdRef.current += 1;
    voiceQueueRef.current = [];
    isSpeakingRef.current = false;

    if (restartListenTimerRef.current) {
      window.clearTimeout(restartListenTimerRef.current);
      restartListenTimerRef.current = null;
    }
    if (coachResponseTimeoutRef.current) {
      window.clearTimeout(coachResponseTimeoutRef.current);
      coachResponseTimeoutRef.current = null;
    }
    if (wordTimerRef.current) {
      window.clearInterval(wordTimerRef.current);
      wordTimerRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (currentAudioRef.current) {
      const audio = currentAudioRef.current;
      currentAudioRef.current = null;
      audio.pause();
      audio.src = "";
    }
  }, []);

  useEffect(() => {
    const stepKey = `${currentTechnique?.id || "technique"}:${currentStep?.id || safeStepIndex}:${masteryThreshold}`;
    const masteryState = masteryHoldRef.current;
    if (masteryState.key !== stepKey) {
      masteryState.key = stepKey;
      masteryState.firstSeenAt = 0;
      masteryState.prompted = false;
    }

    const minimumCoverage = Number(currentStep?.mastery_requirements?.minimum_coverage) || 50;
    const masteryHoldMs = Number(currentStep?.mastery_requirements?.hold_ms) || MASTERY_HOLD_MS;
    const meetsThreshold = Boolean(
      trainSessionActive &&
      !requiresResponse &&
      compositeForm.scorable &&
      compositeForm.masteryReady &&
      compositeForm.coverage >= minimumCoverage &&
      compositeForm.accuracy >= masteryThreshold
    );
    if (!meetsThreshold) {
      masteryState.firstSeenAt = 0;
      return;
    }
    if (masteryState.prompted) return;

    const now = Date.now();
    if (!masteryState.firstSeenAt) {
      masteryState.firstSeenAt = now;
      return;
    }
    if (now - masteryState.firstSeenAt < masteryHoldMs) return;

    masteryState.prompted = true;
    pendingCoachResponseRef.current = {
      kind: "mastery",
      stepKey
    };
    setCoachCommand({
      id: `mastery-${stepKey}-${Date.now()}`,
      type: "mastery_reached",
      accuracy: compositeForm.accuracy,
      coverage: compositeForm.coverage,
      masteryThreshold
    });
  }, [
    compositeForm,
    currentStep?.id,
    currentStep?.mastery_requirements,
    currentTechnique?.id,
    masteryThreshold,
    requiresResponse,
    safeStepIndex,
    trainSessionActive
  ]);
  const selectMasteryThreshold = useCallback((threshold) => {
    const nextThreshold = Math.max(70, Math.min(95, Number(threshold) || 80));
    setMasteryThreshold(nextThreshold);
    localStorage.setItem("studioMasteryThreshold", String(nextThreshold));
  }, []);

  useEffect(() => {
    if (steps.length > 0 && currentStepIndex >= steps.length) {
      setCurrentStepIndex(steps.length - 1);
    }
  }, [currentStepIndex, steps.length]);

  useEffect(() => {
    const techniqueChanged = lastTechniqueIdRef.current !== currentTechnique?.id;
    pendingCoachResponseRef.current = null;
    lastTechniqueIdRef.current = currentTechnique?.id;
    lastSpokenMessageRef.current = "";
    lastSpokenIntentRef.current = "";
    lastCoachChatRef.current = "";
    lastCoachChatPatternRef.current = "";
    lastCoachIntentRef.current = "";
    setAngles({});
    setServerAccuracy(0);
    if (techniqueChanged) {
      setTrainSessionStarted(false);
      setRuleEngineSessionSummary(null);
    }
    const pendingTransition = pendingStepTransitionRef.current;
    if (pendingTransition) {
      pendingStepTransitionRef.current = null;
      setCoachEvent(pendingTransition);
      return;
    }
    const message = currentStepName
      ? `Settle into ${currentStepName}. I am syncing the live angles.`
      : "Choose a step to begin.";

    const entryStepKey = currentStep?.id || currentStepName || "none";
    const shouldSpeakEntry = Boolean(
      currentStepName && announcedEntryStepRef.current !== entryStepKey
    );
    announcedEntryStepRef.current = entryStepKey;

    setCoachEvent({
      message,
      speak: shouldSpeakEntry,
      feedback_intent: `step_entry:${currentStep?.id || currentStepName || "none"}`
    });

    if (textEnabled && currentStepName) {
      setConversation((items) => {
        const baseItems = techniqueChanged ? [] : items;
        const lastItem = baseItems[baseItems.length - 1];

        if (lastItem?.role === "ai" && lastItem?.text === message) {
          return baseItems;
        }

        return [...baseItems.slice(-7), { role: "ai", text: message }];
      });
      lastCoachChatRef.current = message;
      lastCoachChatPatternRef.current = normalizeCoachMessage(message);
      lastCoachIntentRef.current = `step_entry:${currentStep?.id || currentStepName || "none"}`;
    }
  }, [currentStep?.id, currentStepName, currentTechnique?.id, textEnabled]);

  if (!currentTechnique) {
    return (
      <aside className="training-panel training-panel--left">
        <div className="panel-block">
          <p className="eyebrow">Technique</p>
          <h1>No technique found</h1>
          <p className="practice-copy">
            Open a technique from a main category, sub category, and technique
            card to start training.
          </p>
        </div>
      </aside>
    );
  }

  const requiredPlan = currentTechnique.requiredPlan || "FREE_PLAN";
  const hasAccess = canAccessPlan(userPlan, requiredPlan);

  if (!hasAccess) {
    return (
      <aside className="training-panel training-panel--left">
        <div className="panel-block locked-access-card">
          <p className="eyebrow">Locked Technique</p>
          <h1>{currentTechnique.name}</h1>
          <p className="practice-copy">
            Your current plan is {formatPlanName(userPlan)}. Upgrade to{" "}
            {formatPlanName(requiredPlan)} or higher to open this technique in
            Studio.
          </p>
          <Link className="btn btn--light btn--full" to="/pricing">
            View Packages
          </Link>
        </div>
      </aside>
    );
  }

  return (
    <>
      <section className="training-stage" aria-label="Live skeleton tracking">
        <SkeletonCanvas
          enableCoach={textEnabled}
          enableAwareness
          performanceProfile={performanceProfile}
          performanceMode={performanceMode}
          inputSource={inputSource}
          inputVideoUrl={inputVideoUrl}
          inputVideoName={inputVideoName}
          onInputStatus={onInputStatus}
          onPredictionStatus={onPredictionStatus}
          displayMirrored={displayMirrored}
          skeletonLayers={skeletonLayers}
          bodyCalibration={bodyCalibration?.profile}
          calibrationActive={bodyCalibration?.state?.active}
          onBodyCalibrationSample={bodyCalibration?.recordSample}
          onCalibrationStatus={bodyCalibration?.reportFit}
          stanceTargetDegrees={stanceTargetDegrees}
          onStanceTargetChange={onStanceTargetChange}
          currentStepId={currentStep?.id}
          currentStepName={currentStep?.step_name}
          sessionConfig={sessionConfig}
          coachCommand={coachCommand}
          requiredParts={requiredParts}
          measurementParts={displayAngleParts}
          expectedParts={expectedGuideParts}
          feedbackParts={feedbackAngleParts}
          onAngleUpdate={handleAngleUpdate}
          onAwarenessUpdate={setAwareness}
          onLevel1Update={setLevel1State}
          onLevel2Update={setLevel2State}
          onLevel3Update={setLevel3State}
          onLevel4Update={setLevel4State}
          onSituationAwarenessUpdate={setSituationAwarenessState}
          onRuleEngineSessionComplete={setRuleEngineSessionSummary}
          onRuleEngineFrameUpdate={setRuleEngineFrame}
          onLandmarkFrame={DIAGNOSTIC_TRACE_ENABLED ? handleDiagnosticFrame : undefined}
          trackingSessionActive={trainSessionActive}
          trackingSessionPaused={trainSessionPaused}
          onAccuracyUpdate={setServerAccuracy}
          onCoachEvent={handleCoachEvent}
        />
      </section>

      <aside className="training-panel training-panel--left">
        <div className="panel-block">
          <p className="eyebrow">{currentTechnique.subcategory}</p>
          <h1>{currentTechnique.name}</h1>
          <p className="technique-meta">
            {currentTechnique.category} / {currentTechnique.difficulty}
          </p>
        </div>

        <div className="panel-block">
          <div className="panel-heading">
            <p className="eyebrow">Steps</p>
            <span>
              {steps.length > 0 ? `${safeStepIndex + 1}/${steps.length}` : "0/0"}
            </span>
          </div>

          <div className="step-list">
            {steps.map((step, index) => (
              <button
                className={`step-button ${
                  index === safeStepIndex ? "step-button--active" : ""
                }`}
                key={step.id}
                onClick={() => setCurrentStepIndex(index)}
                type="button"
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {step.step_name}
              </button>
            ))}
          </div>
        </div>

        <div className="panel-block panel-block--awareness">
          <AwarenessPanel awareness={awareness} mirrored={displayMirrored} />
        </div>

        <div className="panel-block">
          <div className="panel-heading">
            <p className="eyebrow">Session awareness</p>
            <span>{trainSessionState.replaceAll("_", " ")}</span>
          </div>
          <div className="practice-last-session__metrics">
            <span>
              <small>Completed</small>
              <strong>
                {ruleEngineSessionSummary?.completed_repetitions ??
                  liveRepetitionSummary?.repetitions_completed ??
                  0}
              </strong>
            </span>
            <span>
              <small>Incomplete</small>
              <strong>
                {ruleEngineSessionSummary?.aborted_repetitions ??
                  liveRepetitionSummary?.incomplete_repetitions ??
                  0}
              </strong>
            </span>
            <span>
              <small>Tracking</small>
              <strong>
                {Number.isFinite(ruleEngineSessionSummary?.tracking_quality_percentage)
                  ? `${ruleEngineSessionSummary.tracking_quality_percentage}%`
                  : Number.isFinite(liveTrackingQuality)
                    ? `${liveTrackingQuality}%`
                    : "Live"}
              </strong>
            </span>
            <span>
              <small>Corrections</small>
              <strong>{ruleEngineSessionSummary?.corrections_applied ?? 0}</strong>
            </span>
          </div>
        </div>

        {DIAGNOSTIC_TRACE_ENABLED ? (
          <DiagnosticTraceControls
            active={diagnosticTraceActive}
            recordCount={diagnosticTraceCount}
            onClear={clearDiagnosticTrace}
            onDownload={downloadTrace}
            onStart={startDiagnosticTrace}
            onStop={stopDiagnosticTrace}
          />
        ) : null}

        <div className="panel-block panel-block--calibration">
          <BodyCalibrationPanel
            calibration={bodyCalibration?.profile}
            onCancel={bodyCalibration?.cancelCalibration}
            onReset={bodyCalibration?.resetCalibration}
            onStart={bodyCalibration?.startCalibration}
            state={bodyCalibration?.state}
          />
        </div>

      </aside>

      <div
        aria-live={requiresResponse ? "assertive" : "polite"}
        className={`feedback-banner ${requiresResponse ? "feedback-banner--attention" : ""}`}
      >
        <div className="feedback-banner__message" role={requiresResponse ? "alert" : "status"}>
          <div className="master-status-row">
            <p className="eyebrow">Master Guidance</p>
            <span className="master-status">{coachStateLabel}</span>
            {focusLabel ? <span className="master-focus">Focus: {focusLabel}</span> : null}
          </div>
          <span className="master-feedback-text">
            {textEnabled && currentVoiceMessage === masterMessage && voiceWords.length > 0
              ? voiceWords.map((word, index) => (
                  <span
                    className={`master-feedback-word ${index === activeVoiceWord ? "is-active" : ""}`}
                    key={`${word}-${index}`}
                  >
                    {word}{index < voiceWords.length - 1 ? " " : ""}
                  </span>
                ))
              : masterMessage}
          </span>
        </div>
      </div>

      <aside
        className={`conversation-crate ${requiresResponse ? "conversation-crate--awaiting-response" : ""}`}
        aria-label="Talk to coach"
      >
        <div className="conversation-crate__header">
          <div>
            <p className="eyebrow">Student Reply</p>
            <strong id="coach-response-status">
              {isListening ? "Listening" : voiceInputStatus}
            </strong>
          </div>
          {requiresResponse && !isListening ? (
            <button
              className="conversation-listen"
              disabled={voiceState === "speaking" || voiceState === "loading"}
              onClick={() => startVoiceInput(true)}
              type="button"
            >
              {voiceState === "speaking" || voiceState === "loading" ? "Coach speaking" : "Use microphone"}
            </button>
          ) : null}
          {conversation.length > 2 ? (
            <button
              aria-expanded={showConversationHistory}
              className="conversation-history-toggle"
              onClick={() => setShowConversationHistory((visible) => !visible)}
              type="button"
            >
              {showConversationHistory ? "Latest only" : `History (${conversation.length})`}
            </button>
          ) : null}
        </div>

        <div className="conversation-log">
          {!textEnabled ? (
            <p className="conversation-empty">Text coach is off.</p>
          ) : conversation.length === 0 ? (
            <p className="conversation-empty">Ask or answer the master.</p>
          ) : (
            conversation.slice(showConversationHistory ? -6 : -2).map((item, index) => (
              <p
                className={`conversation-line conversation-line--${item.role}`}
                key={`${item.role}-${index}-${item.text}`}
              >
                <span>{item.role === "ai" ? "AI Coach" : "You"}</span>
                {item.text}
              </p>
            ))
          )}
        </div>

        <div className="coach-actions">
          {textEnabled && requiresResponse ? (
            <div className="quick-replies" aria-label="Suggested replies">
              {replyOptions.map((option) => (
                <button
                  key={`${coachEvent?.question?.kind}-${option.value}`}
                  onClick={() => sendCoachMessage(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          <form
            className="coach-command"
            onSubmit={(event) => {
              event.preventDefault();
              sendCoachMessage(coachInput);
            }}
          >
            <input
              aria-label="Talk to coach"
              aria-describedby={requiresResponse ? "coach-response-status" : undefined}
              onChange={(event) => setCoachInput(event.target.value)}
              placeholder={requiresResponse ? "Your answer..." : "Answer the master..."}
              ref={responseInputRef}
              value={coachInput}
            />
            <button type="submit">Send</button>
          </form>
        </div>
      </aside>

      <aside className="training-panel training-panel--right">
        {isAdminStudio ? (
          <>
            <div className="panel-block advanced-analysis-toggle">
              <button
                aria-expanded={showAdvancedAnalysis}
                className="advanced-analysis-button"
                onClick={() => setShowAdvancedAnalysis((isVisible) => !isVisible)}
                type="button"
              >
                Advanced Analysis
                <span>{showAdvancedAnalysis ? "Hide" : "Expand"}</span>
              </button>
              {showAdvancedAnalysis ? (
                <>
                  <ActionSkeletonOverlay level2State={level2State} variant="panel" />
                  <Level1DebugPanel state={level1State} />
                  <Level2DebugPanel state={level2State} />
                </>
              ) : null}
            </div>

            <div className="panel-block advanced-analysis-toggle">
              <button
                aria-expanded={showDataLayers}
                className="advanced-analysis-button"
                onClick={() => setShowDataLayers((isVisible) => !isVisible)}
                type="button"
              >
                Data Layers
                <span>{showDataLayers ? "Hide" : "Expand"}</span>
              </button>
              {showDataLayers ? (
                <DataLayersPanel
                  level1State={level1State}
                  level2State={level2State}
                  level3State={level3State}
                  level4State={level4State}
                  situationAwarenessState={situationAwarenessState}
                />
              ) : null}
            </div>
          </>
        ) : null}

        <MetricsPanel
          steps={steps}
          currentStepIndex={safeStepIndex}
          accuracy={compositeForm.scorable ? compositeForm.accuracy : 0}
          angles={angles}
          requiredParts={feedbackAngleParts}
          feedback={textEnabled ? feedback : ""}
          coachEvent={textEnabled ? coachEvent : null}
          compositeForm={compositeForm}
          showFullBodyAssessment={isAdminStudio}
          difficulty={formDifficulty}
          onDifficultyChange={selectFormDifficulty}
          masteryThreshold={masteryThreshold}
          onMasteryThresholdChange={selectMasteryThreshold}
        />
      </aside>
    </>
  );
}
