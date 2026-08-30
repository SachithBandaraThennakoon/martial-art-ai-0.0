const techniqueFiles = import.meta.glob(
  "../../../backend/data/system-catalog/techniques/*.json",
  { eager: true, import: "default" }
);

function buildDataPackage(filePath, record) {
  const technique = record?.technique || {};
  const trainingSteps = record?.training_config || {};
  const learningContent = record?.learning_content || {};
  const techniqueId = String(trainingSteps.technique_id || "").trim();
  if (
    technique.status !== "active" ||
    learningContent.status === "DRAFT" ||
    !techniqueId ||
    technique.slug !== techniqueId ||
    !Array.isArray(trainingSteps.steps) ||
    trainingSteps.steps.length === 0
  ) return null;

  const metadata = technique.metadata || {};
  const normalizedTrainingSteps = {
    ...trainingSteps,
    steps: trainingSteps.steps.map((step) => ({
      ...step,
      // Backward-compatible shape for the original angle-only feedback path.
      angles: step.angles?.length
        ? step.angles
        : (step.angle_targets || []).map(({ body_part, min, max }) => ({
            body_part,
            min,
            max
          }))
    }))
  };
  const catalog = {
    schema_version: metadata.catalog_schema_version || "1.0",
    id: techniqueId,
    name: technique.name || techniqueId,
    tracking_package: metadata.tracking_package || techniqueId,
    tracking_version: metadata.tracking_version || technique.version || "1.0.0",
    category: technique.category || "Technique Training",
    subcategory: technique.subcategory || "General",
    difficulty: technique.difficulty || "Beginner",
    price: technique.price ?? 0,
    required_plan: technique.required_plan || "FREE_PLAN",
    description: technique.description || ""
  };

  return {
    index: {
      id: techniqueId,
      directory: filePath,
      enabled: true,
      catalog_version: "1.0.0",
      ...(trainingSteps.temporal_runtime
        ? {
            tracking_version:
              trainingSteps.temporal_runtime.manifest?.version ||
              metadata.tracking_version ||
              technique.version ||
              "1.0.0"
          }
        : {})
    },
    catalog,
    trainingSteps: normalizedTrainingSteps,
    trackingSource: trainingSteps.temporal_runtime || null
  };
}

const dataPackages = Object.entries(techniqueFiles)
  .map(([filePath, record]) => buildDataPackage(filePath, record))
  .filter(Boolean);

const dataPackageRegistry = new Map(
  dataPackages.map((dataPackage) => [dataPackage.index.id, dataPackage])
);

export function getTechniqueDataPackage(techniqueId) {
  return dataPackageRegistry.get(String(techniqueId || "").trim().toLowerCase()) || null;
}

export function listTechniqueDataPackages() {
  return [...dataPackages];
}
