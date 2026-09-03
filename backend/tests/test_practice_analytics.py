import unittest

from services.practice_analytics import extract_practice_analytics


class PracticeAnalyticsTests(unittest.TestCase):
    def test_v2_rule_result_is_authoritative_for_saved_analysis(self):
        payload = extract_practice_analytics({
            "targetReps": 5,
            "canonicalCompletedReps": 0,
            "correctedSummary": {"completed_reps": 0},
            "ruleEngineAnalysis": {
                "summary": {
                    "analysis_schema_version": "2.0",
                    "detected_attempts": 5,
                    "completed_motions": 4,
                    "completed_repetitions": 4,
                    "aborted_repetitions": 1,
                    "technique_quality": 0.596,
                    "detection_confidence": 0.809,
                    "tracking_quality": 0.9404,
                    "consistency": 0.75,
                }
            },
        })

        self.assertEqual(payload["completion_source"], "rule_engine_v2")
        self.assertEqual(payload["completed_repetitions"], 5)
        self.assertEqual(payload["detected_attempts"], 5)
        self.assertEqual(payload["completed_motions"], 4)
        self.assertEqual(payload["aborted_repetitions"], 1)
        self.assertEqual(payload["tracking_quality_percentage"], 94.0)
        self.assertEqual(payload["technique_quality"], 0.596)

    def test_extracts_compact_post_session_summary(self):
        payload = extract_practice_analytics({
            "captureDurationMs": 8400,
            "targetReps": 3,
            "canonicalCompletedReps": 3,
            "canonicalTargetReps": 3,
            "correctedSummary": {"completed_reps": 3},
            "ruleEngineAnalysis": {
                "summary": {
                    "completed_repetitions": 3,
                    "aborted_repetitions": 1,
                    "average_response_time_ms": 420,
                    "tracking_quality_percentage": 94.5,
                    "per_step_duration_ms": {"EXTENSION": 180},
                    "common_form_errors": [
                        {"error_id": "dropped_guard", "count": 2}
                    ],
                    "corrections_applied": 4,
                }
            },
        })

        self.assertEqual(payload["completed_repetitions"], 3)
        self.assertEqual(payload["completion_source"], "post_session_cluster")
        self.assertEqual(
            payload["completion_evidence"]["strict_rule_engine"], 3
        )
        self.assertEqual(payload["aborted_repetitions"], 0)
        self.assertEqual(payload["average_response_time_ms"], 420)
        self.assertEqual(payload["tracking_quality_percentage"], 94.5)
        self.assertEqual(payload["common_form_errors"][0]["error_id"], "dropped_guard")
        self.assertEqual(payload["per_step_duration_ms"]["EXTENSION"], 180)
        self.assertEqual(payload["capture_duration_ms"], 8400)

    def test_missing_rule_summary_stays_explicitly_unavailable(self):
        payload = extract_practice_analytics({
            "correctedSummary": {"completed_reps": 2}
        })

        self.assertEqual(payload["completed_repetitions"], 2)
        self.assertIsNone(payload["tracking_quality_percentage"])
        self.assertIsNone(payload["average_response_time_ms"])
        self.assertEqual(payload["common_form_errors"], [])
        self.assertIsNone(payload["forecast_summary"])

    def test_persists_acp_forecast_as_advisory_session_evidence(self):
        payload = extract_practice_analytics({
            "acpForecastSummary": {
                "model_name": "ACP-STGAT",
                "observed_samples": 300,
                "forecast_samples": 240,
                "coverage_percentage": 80,
                "band_reliability": {
                    "level1": 0.92,
                    "level2": 0.78,
                    "awareness": 0.74,
                    "level3": 0.51,
                },
                "dominant_intent": "movement_likely",
                "dominant_transition": "completion_candidate",
                "transition_candidates": 18,
                "trusted_warning_samples": 3,
                "peak_warning_risk": 0.64,
                "affects_rep_count": True,
            }
        })

        forecast = payload["forecast_summary"]
        self.assertEqual(forecast["coverage_percentage"], 80)
        self.assertEqual(forecast["bands"]["level3"], "frames 1-30")
        self.assertEqual(forecast["dominant_transition"], "completion_candidate")
        self.assertFalse(forecast["affects_rep_count"])

    def test_video_cluster_recovers_reps_missed_by_strict_v2_diagnostics(self):
        payload = extract_practice_analytics({
            "canonicalCompletedReps": 5,
            "canonicalTargetReps": 5,
            "correctedSummary": {
                "completed_reps": 5,
                "average_accuracy": 87.9,
            },
            "ruleEngineAnalysis": {
                "summary": {
                    "analysis_schema_version": "2.0",
                    "detected_attempts": 1,
                    "completed_motions": 1,
                    "completed_repetitions": 1,
                    "aborted_repetitions": 0,
                    "technique_quality": 1,
                }
            },
        })

        self.assertEqual(payload["completed_repetitions"], 5)
        self.assertEqual(payload["detected_attempts"], 1)
        self.assertEqual(payload["completion_source"], "post_session_cluster")
        self.assertEqual(payload["aborted_repetitions"], 0)
        self.assertEqual(payload["average_accuracy"], 87.9)

    def test_post_session_result_is_not_overwritten_by_stale_session_count(self):
        payload = extract_practice_analytics({
            "canonicalCompletedReps": 4,
            "canonicalTargetReps": 5,
            "correctedSummary": {"completed_reps": 5},
            "ruleEngineAnalysis": {
                "summary": {"completed_repetitions": 5}
            },
        })

        self.assertEqual(payload["completed_repetitions"], 5)
        self.assertEqual(payload["aborted_repetitions"], 0)
        self.assertEqual(payload["completion_source"], "post_session_cluster")
        self.assertEqual(
            payload["completion_evidence"]["canonical_session"], 4
        )

    def test_persisted_rep_count_is_not_overwritten_by_stale_tape_metadata(self):
        payload = extract_practice_analytics({
            "canonicalCompletedReps": 5,
            "canonicalTargetReps": 5,
            "correctedSummary": {"completed_reps": 4},
            "ruleEngineAnalysis": {
                "summary": {"completed_repetitions": 0}
            },
        })

        self.assertEqual(payload["completed_repetitions"], 5)
        self.assertEqual(payload["aborted_repetitions"], 0)
        self.assertEqual(payload["completion_source"], "canonical_session")


if __name__ == "__main__":
    unittest.main()
