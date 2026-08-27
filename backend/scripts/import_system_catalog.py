"""Import authored system-catalog records into runtime technique packages.

Usage:
    python -m scripts.import_system_catalog <source-system-catalog-directory>

The full source catalog is retained at ``backend/data/system-catalog``. Only
active records with complete training steps are promoted into
the runtime catalog because those are the records that the live
frontend/backend loaders can safely execute.
"""

import json
import shutil
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
RUNTIME_ROOT = BACKEND_ROOT / "data" / "techniques"
CATALOG_ROOT = BACKEND_ROOT / "data" / "system-catalog"


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload):
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def catalog_payload(technique: dict, technique_id: str):
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


def complete_runtime_record(record: dict):
    technique = record.get("technique") or {}
    training = record.get("training_config") or {}
    technique_id = str(training.get("technique_id") or "").strip()
    return (
        technique.get("status") == "active"
        and technique_id == technique.get("slug")
        and bool(training.get("steps"))
    )


def main(source_directory: str):
    source_root = Path(source_directory).resolve()
    source_techniques = source_root / "techniques"
    if not source_techniques.is_dir() or not (source_root / "catalog-index.json").is_file():
        raise SystemExit("Source must be a system-catalog directory with techniques/ and catalog-index.json")

    if CATALOG_ROOT.exists():
        shutil.rmtree(CATALOG_ROOT)
    shutil.copytree(source_root, CATALOG_ROOT)

    current_index = read_json(RUNTIME_ROOT / "index.json")
    permitted_ids = {
        str(entry["id"]).strip()
        for entry in current_index.get("techniques", [])
        if entry.get("enabled", True)
    }

    records = []
    for source_file in sorted(source_techniques.glob("*.json")):
        record = read_json(source_file)
        if complete_runtime_record(record):
            records.append(record)

    records_by_id = {
        record["training_config"]["technique_id"]: record
        for record in records
        if record["training_config"]["technique_id"] in permitted_ids
    }
    missing = permitted_ids - records_by_id.keys()
    if missing:
        raise SystemExit(f"Source catalog lacks complete published records for: {', '.join(sorted(missing))}")

    for technique_id, record in records_by_id.items():
        package_dir = RUNTIME_ROOT / technique_id
        package_dir.mkdir(parents=True, exist_ok=True)
        write_json(package_dir / "catalog.json", catalog_payload(record["technique"], technique_id))
        write_json(package_dir / "training-steps.json", record["training_config"])

    write_json(
        RUNTIME_ROOT / "index.json",
        {
            "schema_version": "1.0",
            "techniques": [
                {
                    "id": entry["id"],
                    "directory": entry.get("directory", entry["id"]),
                    "enabled": entry.get("enabled", True),
                    "catalog_version": "1.0.0",
                    **(
                        {"tracking_version": "1.0.0"}
                        if records_by_id[entry["id"]]["training_config"].get("temporal_runtime")
                        else {}
                    ),
                }
                for entry in current_index.get("techniques", [])
                if entry.get("enabled", True)
            ],
        },
    )

    print(f"Imported {len(records_by_id)} active runtime packages.")
    print(f"Retained {len(list((CATALOG_ROOT / 'techniques').glob('*.json')))} source catalog records.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python -m scripts.import_system_catalog <source-system-catalog-directory>")
    main(sys.argv[1])
