import json
from pathlib import Path


TECHNIQUE_ROOT = Path(__file__).resolve().parents[1] / "data" / "system-catalog"


def _read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _catalog_payload(technique, technique_id):
    metadata = technique.get("metadata") or {}
    return {
        "schema_version": metadata.get("catalog_schema_version", "1.0"),
        "id": technique_id,
        "name": technique.get("name", technique_id.replace("-", " ").title()),
        "tracking_package": metadata.get("tracking_package", technique_id),
        "tracking_version": metadata.get("tracking_version", technique.get("version", "1.0.0")),
        "category": technique.get("category", "Technique Training"),
        "subcategory": technique.get("subcategory", "General"),
        "difficulty": technique.get("difficulty", "Beginner"),
        "price": technique.get("price", 0),
        "required_plan": technique.get("required_plan", "FREE_PLAN"),
        "description": technique.get("description", ""),
    }


def _is_runtime_record(record):
    technique = record.get("technique") or {}
    training = record.get("training_config") or {}
    learning = record.get("learning_content") or {}
    technique_id = str(training.get("technique_id") or "").strip()
    return (
        technique.get("status") == "active"
        and learning.get("status") != "DRAFT"
        and technique_id == str(technique.get("slug") or "").strip()
        and bool(training.get("steps"))
    )


def _with_legacy_angles(training_steps):
    return {
        **training_steps,
        "steps": [
            {
                **step,
                # Keep the original angle-only consumer contract available.
                "angles": step.get("angles") or [
                    {
                        "body_part": target["body_part"],
                        "min": target["min"],
                        "max": target["max"],
                        **(
                            {"measurement_tolerance_deg": target["measurement_tolerance_deg"]}
                            if "measurement_tolerance_deg" in target else {}
                        ),
                    }
                    for target in step.get("angle_targets", [])
                ],
            }
            for step in training_steps.get("steps", [])
        ],
    }


def load_technique_packages(root=TECHNIQUE_ROOT):
    """Load complete active techniques directly from the system catalog."""
    root = Path(root).resolve()
    packages = []
    seen_ids = set()

    for source_file in sorted((root / "techniques").glob("*.json")):
        record = _read_json(source_file)
        if not _is_runtime_record(record):
            continue

        technique = record["technique"]
        training_steps = _with_legacy_angles(record["training_config"])
        technique_id = str(training_steps["technique_id"]).strip()
        if technique_id in seen_ids:
            raise ValueError(f'Duplicate technique id "{technique_id}"')
        seen_ids.add(technique_id)
        packages.append({
            "index": {
                "id": technique_id,
                "directory": str(source_file.relative_to(root)),
                "enabled": True,
                "catalog_version": "1.0.0",
                **({"tracking_version": "1.0.0"} if training_steps.get("temporal_runtime") else {}),
            },
            "catalog": _catalog_payload(technique, technique_id),
            "training_steps": training_steps,
            "directory": source_file.parent,
            "source_file": source_file,
            "has_tracking": bool(training_steps.get("temporal_runtime")),
        })

    return packages


def load_admin_technique_packages(root=TECHNIQUE_ROOT):
    """Load every source record in the shape expected by the catalog studio.

    The runtime loader above deliberately excludes draft and incomplete records.
    Administrators still need those records so they can author the missing steps
    and publish them from the manual catalog workspace.
    """
    root = Path(root).resolve()
    packages = []
    seen_ids = set()

    for source_file in sorted((root / "techniques").glob("*.json")):
        record = _read_json(source_file)
        technique = record.get("technique") or {}
        technique_id = str(technique.get("slug") or "").strip()
        if not technique_id:
            continue
        if technique_id in seen_ids:
            raise ValueError(f'Duplicate technique id "{technique_id}"')
        seen_ids.add(technique_id)

        training_steps = record.get("training_config") or {}
        packages.append({
            "id": technique_id,
            "enabled": technique.get("status") == "active",
            "has_tracking": bool(training_steps.get("temporal_runtime")),
            "catalog": _catalog_payload(technique, technique_id),
            "training_steps": training_steps,
            "learning_content": record.get("learning_content"),
        })

    return packages


def load_technique_record(technique_id, root=TECHNIQUE_ROOT):
    """Load one source record by slug for Guide and other read-only consumers."""
    requested_id = str(technique_id or "").strip().lower()
    if not requested_id:
        return None

    root = Path(root).resolve()
    for source_file in sorted((root / "techniques").glob("*.json")):
        record = _read_json(source_file)
        technique = record.get("technique") or {}
        if str(technique.get("slug") or "").strip().lower() == requested_id:
            return record
    return None


def load_technique_catalog(root=TECHNIQUE_ROOT):
    """Return the legacy-compatible catalog shape assembled from source records."""
    def legacy_step(step):
        if step.get("angles"):
            return step
        angle_targets = step.get("angle_targets", [])
        return {
            **step,
            "angles": [
                {
                    "body_part": target["body_part"],
                    "min": target["min"],
                    "max": target["max"],
                    **(
                        {"measurement_tolerance_deg": target["measurement_tolerance_deg"]}
                        if "measurement_tolerance_deg" in target else {}
                    ),
                }
                for target in angle_targets
            ],
        }

    return {
        "schema_version": "3.0",
        "techniques": [
            {
                **package["catalog"],
                "steps": [legacy_step(step) for step in package["training_steps"].get("steps", [])],
            }
            for package in load_technique_packages(root)
        ],
    }
