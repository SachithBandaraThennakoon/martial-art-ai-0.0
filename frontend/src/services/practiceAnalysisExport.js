const safeFilenamePart = (value, fallback = "practice") => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
};

export function buildPracticeAnalysisTrace({ session, tape, tapeStatus = "available" }) {
  return {
    schema: "xmartialart-practice-analysis-trace/v1",
    exported_at: new Date().toISOString(),
    source: "admin-studio-analysis",
    privacy: {
      contains_video: false,
      contains_pose_landmarks: Boolean(tape?.frames?.length),
      note: "The raw video is downloaded separately. This file may contain body-landmark movement data."
    },
    diagnostic_data: {
      tape_status: tapeStatus,
      frame_count: tape?.frames?.length || 0
    },
    session: session || null,
    tape: tape || null
  };
}

export function practiceAnalysisTraceFilename(session) {
  const technique = safeFilenamePart(session?.technique_name);
  const sessionId = session?.id ?? "unknown";
  return `${technique}-session-${sessionId}-analysis.json`;
}

export function downloadJsonDocument(payload, filename) {
  const objectUrl = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
  );
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
