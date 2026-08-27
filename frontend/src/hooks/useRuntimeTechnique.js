import { useEffect, useMemo, useState } from "react";
import { useCatalog } from "../context/CatalogContext";
import { API_BASE_URL } from "../services/api";
import {
  getTechniqueFromCatalog,
  normalizeRuntimeTechnique,
  slugify
} from "../data/techniqueCatalog";

function findTechnique(catalog, categorySlug, subcategorySlug, techniqueName) {
  const name = String(techniqueName || "").toLowerCase();
  for (const category of catalog) {
    if (categorySlug && slugify(category.category) !== categorySlug) continue;
    for (const subcategory of category.subcategories) {
      if (subcategorySlug && slugify(subcategory.name) !== subcategorySlug) continue;
      const technique = subcategory.techniques.find((item) => item.name.toLowerCase() === name);
      if (technique) return technique;
    }
  }
  return null;
}

async function fetchActivity(slug, version, signal) {
  const versionQuery = version ? `?v=${encodeURIComponent(version)}` : "";
  const apiResponse = await fetch(`${API_BASE_URL}/techniques/${encodeURIComponent(slug)}/training${versionQuery}`, {
    signal,
    cache: "no-cache"
  });
  if (apiResponse.ok) return apiResponse.json();

  const localResponse = await fetch(`/data/activities/${encodeURIComponent(slug)}.json${versionQuery}`, {
    signal,
    cache: "no-cache"
  });
  if (localResponse.ok) return localResponse.json();
  throw new Error(`Local activity file request failed (${localResponse.status})`);
}

export default function useRuntimeTechnique({ categorySlug, subcategorySlug, techniqueName }) {
  const { catalog } = useCatalog();
  const localTechnique = useMemo(
    () => getTechniqueFromCatalog({ categorySlug, subcategorySlug, techniqueName }),
    [categorySlug, subcategorySlug, techniqueName]
  );
  const catalogTechnique = useMemo(
    () => findTechnique(catalog, categorySlug, subcategorySlug, techniqueName),
    [catalog, categorySlug, subcategorySlug, techniqueName]
  );
  const fallback = localTechnique || catalogTechnique;
  const slug = catalogTechnique?.id || fallback?.id || slugify(techniqueName || "");
  const activityVersion = catalogTechnique?.activityVersion || null;
  const [state, setState] = useState({ key: "", technique: null, status: "idle" });

  useEffect(() => {
    if (!fallback || !techniqueName) return undefined;
    const controller = new AbortController();

    fetchActivity(slug, activityVersion, controller.signal)
      .then(({ technique, training_config: trainingConfig }) => {
        setState({
          key: slug,
          technique: normalizeRuntimeTechnique({ technique, trainingConfig, fallback }),
          status: "ready"
        });
      })
      .catch((error) => {
        if (error.name !== "AbortError") setState({ key: slug, technique: fallback, status: "fallback" });
      });

    return () => controller.abort();
  }, [activityVersion, fallback, slug, techniqueName]);

  if (!fallback || !techniqueName) return { technique: null, status: "missing" };
  if (state.key !== slug) return { technique: fallback, status: "loading" };
  return state;
}
