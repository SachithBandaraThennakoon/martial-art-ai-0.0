import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalogTreeToTechniqueCatalog } from "../src/data/catalogApiAdapter.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "../..");
const sourceRoot = path.join(projectRoot, "backend/data/system-catalog");
const sourceActivities = path.join(sourceRoot, "techniques");
const outputRoot = path.join(projectRoot, "frontend/public/data");
const outputActivities = path.join(outputRoot, "activities");

function stableJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function contentVersion(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 12);
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputActivities, { recursive: true });

const catalogPayload = JSON.parse(
  await readFile(path.join(sourceRoot, "catalog-index.json"), "utf8")
);
const catalog = catalogTreeToTechniqueCatalog(catalogPayload);
const sourceFiles = (await readdir(sourceActivities, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  .sort((first, second) => first.name.localeCompare(second.name));

const runtimeActivities = [];
for (const sourceFile of sourceFiles) {
  const sourcePath = path.join(sourceActivities, sourceFile.name);
  const payload = JSON.parse(await readFile(sourcePath, "utf8"));
  const slug = payload?.technique?.slug;
  const steps = payload?.training_config?.steps;
  if (!slug || !Array.isArray(steps) || steps.length === 0) continue;

  const version = contentVersion(payload);
  const generatedActivity = {
    master_data_version: version,
    ...payload
  };
  await writeFile(
    path.join(outputActivities, `${slug}.json`),
    stableJson(generatedActivity),
    "utf8"
  );
  runtimeActivities.push({ slug, version, steps: steps.length });
}

const runtimeVersions = new Map(
  runtimeActivities.map((activity) => [activity.slug, activity.version])
);
for (const category of catalog) {
  for (const subcategory of category.subcategories) {
    for (const technique of subcategory.techniques) {
      const version = runtimeVersions.get(technique.id);
      if (version) {
        technique.runtimeReady = true;
        technique.activityVersion = version;
      }
    }
  }
}

const catalogOutput = {
  schema_version: 1,
  master_data_version: contentVersion({ catalog, runtimeActivities }),
  generated_from: "backend/data/system-catalog",
  runtime_activity_count: runtimeActivities.length,
  catalog
};
await writeFile(
  path.join(outputRoot, "training-catalog.json"),
  stableJson(catalogOutput),
  "utf8"
);

process.stdout.write(
  `Synced ${catalog.length} disciplines and ${runtimeActivities.length} runtime activities.\n`
);