from fastapi import APIRouter, Depends, HTTPException

from auth_context import require_admin_user
from models.user import User
from services.technique_package_loader import (
    load_admin_technique_packages,
    load_technique_record,
)


router = APIRouter(prefix="/admin", tags=["admin-catalog"])


@router.get("/catalog")
def get_admin_catalog(_admin: User = Depends(require_admin_user)):
    """Return draft and published source records for the manual catalog studio."""
    return {"techniques": load_admin_technique_packages()}


@router.get("/techniques/{technique_id}/runtime")
def get_admin_technique_runtime(
    technique_id: str,
    _admin: User = Depends(require_admin_user),
):
    """Return the complete editable source record for one technique."""
    record = load_technique_record(technique_id)
    if not record:
        raise HTTPException(status_code=404, detail="Technique not found")

    technique = record.get("technique") or {}
    training_steps = record.get("training_config") or {}
    return {
        "id": technique_id,
        "enabled": technique.get("status") == "active",
        "has_tracking": bool(training_steps.get("temporal_runtime")),
        "training_steps": training_steps,
        "learning_content": record.get("learning_content"),
    }
