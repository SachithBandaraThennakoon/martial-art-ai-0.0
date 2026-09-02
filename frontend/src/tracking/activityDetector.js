import { OutboundPeakReturnDetector } from "./detectors/outboundPeakReturnDetector.js";

const DETECTORS = Object.freeze({
  outbound_peak_return: OutboundPeakReturnDetector
});

export function createActivityDetector(analysisConfig) {
  const activityProfile = analysisConfig?.activity_profile;
  const detectorName = activityProfile?.detector || analysisConfig?.rep_detector?.type;
  const Detector = DETECTORS[detectorName];
  if (!Detector) return null;
  return new Detector({
    ...analysisConfig.rep_detector,
    tracking_gap: analysisConfig.tracking_gap
  });
}

export const supportedActivityDetectorPrimitives = Object.freeze(
  Object.keys(DETECTORS)
);

