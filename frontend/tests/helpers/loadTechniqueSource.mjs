import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadTrainingSteps(techniqueRoot, techniqueId) {
  const directory = path.join(techniqueRoot, techniqueId);
  try {
    await access(path.join(directory, "training-steps.json"));
    return readJson(path.join(directory, "training-steps.json"));
  } catch {
    const sourceDirectory = path.join(techniqueRoot, "..", "system-catalog", "techniques");
    const sourceFiles = await readdir(sourceDirectory);
    let sourceRecord = null;
    for (const sourceFile of sourceFiles.filter((file) => file.endsWith(".json"))) {
      const candidate = await readJson(path.join(sourceDirectory, sourceFile));
      if (candidate?.training_config?.technique_id === techniqueId) {
        sourceRecord = candidate;
        break;
      }
    }
    if (!sourceRecord) throw new Error(`Technique source not found: ${techniqueId}`);
    return sourceRecord.training_config;
  }
}

export async function loadTechniqueTrainingConfig(techniqueRoot, techniqueId) {
  return loadTrainingSteps(techniqueRoot, techniqueId);
}

export async function loadTechniqueSource(techniqueRoot, techniqueId) {
  const trainingSteps = await loadTrainingSteps(techniqueRoot, techniqueId);
  if (trainingSteps.temporal_runtime) {
    return trainingSteps.temporal_runtime;
  }
  const names = ["manifest", "states", "transitions", "errors", "modes"];
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [
        name,
        await readJson(path.join(directory, `${name}.json`))
      ])
    )
  );
}
