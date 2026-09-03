import json
import unittest

from fastapi import HTTPException

from services.tape_storage import parse_and_validate_tape


def valid_document():
    return {
        "version": 2,
        "frame_rate": 30,
        "duration_ms": 34,
        "frames": [
            {
                "t": 0,
                "n": 1,
                "p": [[1000, 2000, 0, 10000]],
                "op": [],
                "wp": [],
                "ap": [],
                "face": [],
                "hl": [],
                "hr": [],
                "av": {"left_elbow": 17800},
            },
            {
                "t": 34,
                "n": 2,
                "p": [[1200, 2000, 0, 10000]],
                "op": [],
                "wp": [],
                "ap": [],
                "face": [],
                "hl": [],
                "hr": [],
            },
        ],
        "metadata": {
            "sessionId": 7,
            "targetReps": 3,
            "techniqueName": "Jab",
            "analysisEngine": "auto",
            "algorithmVersion": "biomechanics-v2",
            "configVersion": "jab-2026-08",
            "deviceGeneratedEstimate": True,
        },
    }


class TapeStorageValidationTests(unittest.TestCase):
    def test_valid_compact_tape_has_stable_checksum(self):
        raw = json.dumps(valid_document(), separators=(",", ":")).encode()
        document, digest = parse_and_validate_tape(raw)
        self.assertEqual(len(document["frames"]), 2)
        self.assertEqual(len(digest), 64)

    def test_unknown_frame_field_is_rejected(self):
        document = valid_document()
        document["frames"][0]["rawVideo"] = "not allowed"
        with self.assertRaises(HTTPException) as context:
            parse_and_validate_tape(json.dumps(document).encode())
        self.assertEqual(context.exception.status_code, 422)

    def test_out_of_order_timestamps_are_rejected(self):
        document = valid_document()
        document["frames"][1]["t"] = -1
        with self.assertRaises(HTTPException):
            parse_and_validate_tape(json.dumps(document).encode())

    def test_non_numeric_landmarks_are_rejected(self):
        document = valid_document()
        document["frames"][0]["p"][0][0] = "1000"
        with self.assertRaises(HTTPException):
            parse_and_validate_tape(json.dumps(document).encode())

    def test_unknown_metadata_is_rejected(self):
        document = valid_document()
        document["metadata"]["email"] = "should-not-be-here@example.com"
        with self.assertRaises(HTTPException):
            parse_and_validate_tape(json.dumps(document).encode())

    def test_frontend_analysis_engine_metadata_is_allowed(self):
        document = valid_document()
        document["metadata"]["analysisEngine"] = "both"
        parsed, _digest = parse_and_validate_tape(json.dumps(document).encode())
        self.assertEqual(parsed["metadata"]["analysisEngine"], "both")

    def test_acp_forecast_summary_metadata_is_allowed(self):
        document = valid_document()
        document["metadata"]["acpForecastSummary"] = {
            "coverage": 0.959,
            "usableSamples": 210,
            "dominantIntent": "hold_likely",
            "levels": {
                "l1": {"confidence": 0.857, "frames": 6},
                "l3": {"confidence": 0.812, "frames": 30},
            },
        }
        parsed, _digest = parse_and_validate_tape(json.dumps(document).encode())
        summary = parsed["metadata"]["acpForecastSummary"]
        self.assertEqual(summary["usableSamples"], 210)
        self.assertEqual(summary["levels"]["l3"]["frames"], 30)

    def test_rule_engine_quality_evidence_depth_is_allowed(self):
        document = valid_document()
        document["metadata"]["ruleEngineAnalysis"] = {
            "summary": {
                "repetitions": [{
                    "quality_evidence": [{
                        "feature": "lead_elbow_angle",
                        "range": {"min": 155, "max": 177},
                    }],
                }],
            },
        }
        parsed, _digest = parse_and_validate_tape(json.dumps(document).encode())
        evidence = parsed["metadata"]["ruleEngineAnalysis"]["summary"]["repetitions"]
        self.assertEqual(evidence[0]["quality_evidence"][0]["feature"], "lead_elbow_angle")

    def test_excessive_metadata_nesting_is_rejected(self):
        document = valid_document()
        nested = "too deep"
        for _ in range(12):
            nested = {"child": nested}
        document["metadata"]["ruleEngineAnalysis"] = nested
        with self.assertRaises(HTTPException):
            parse_and_validate_tape(json.dumps(document).encode())


if __name__ == "__main__":
    unittest.main()
