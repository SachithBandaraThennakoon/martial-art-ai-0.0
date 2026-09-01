import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import { slugify } from "../data/techniqueCatalog";
import { useCatalog } from "../context/CatalogContext";
import { API_BASE_URL } from "../services/api";
import { authFetch } from "../services/authSession";

const CATEGORY_DETAILS = {
  "Flexibility & Mobility": { code: "FM", description: "Build range, control, and movement quality." },
  "Conditioning & Fitness": { code: "CF", description: "Develop the engine behind every technique." },
  "Technique Training": { code: "TT", description: "Refine strikes and movement with live form feedback." },
  "Meditation & Posture": { code: "MP", description: "Train alignment, breathing, and focused control." },
  Forms: { code: "FO", description: "Connect techniques into precise movement sequences." },
  Weapons: { code: "WE", description: "Practice handling, positioning, and safe mechanics." },
  "Self-Defense": { code: "SD", description: "Build practical responses for real-world situations." },
  Fighting: { code: "FI", description: "Develop timing, combinations, and tactical awareness." }
};

export default function Studio({ isAdminStudio = false }) {
  const { catalog, status: catalogStatus, refreshCatalog } = useCatalog();
  const [query, setQuery] = useState("");
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);
  const [catalogRefreshMessage, setCatalogRefreshMessage] = useState("");
  const [syncingDatabase, setSyncingDatabase] = useState(false);
  const [databaseSyncMessage, setDatabaseSyncMessage] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const handleSystemCatalogRefresh = useCallback(async () => {
    setRefreshingCatalog(true);
    setCatalogRefreshMessage("");
    try {
      const response = await authFetch(`${API_BASE_URL}/admin/catalog/refresh-cache`, {
        method: "POST"
      });
      if (!response.ok) throw new Error("System catalog refresh failed");
      const result = await response.json();
      await refreshCatalog();
      setCatalogRefreshMessage(
        `${result.disciplines} disciplines and ${result.technique_snapshots} technique snapshots refreshed from PostgreSQL.`
      );
    } catch {
      setCatalogRefreshMessage("Could not refresh the system catalog. Please try again.");
    } finally {
      setRefreshingCatalog(false);
    }
  }, [refreshCatalog]);

  const handleDatabaseSync = useCallback(async (direction) => {
    const directionLabel = direction === "cloud_to_local" ? "cloud to local" : "local to cloud";
    const confirmation = window.prompt(
      `This replaces the destination database's application data (${directionLabel}). Type SYNC to continue.`
    );
    if (confirmation !== "SYNC") return;

    setSyncingDatabase(true);
    setDatabaseSyncMessage("");
    try {
      const response = await authFetch(`${API_BASE_URL}/admin/database-sync/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, confirmation })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || "Database sync failed.");
      await refreshCatalog();
      setDatabaseSyncMessage(result.message);
    } catch (error) {
      setDatabaseSyncMessage(error.message || "Database sync failed.");
    } finally {
      setSyncingDatabase(false);
    }
  }, [refreshCatalog]);

  const totals = useMemo(
    () =>
      catalog.reduce(
        (summary, category) => {
          category.subcategories.forEach((subcategory) => {
            summary.subcategories += 1;
            summary.techniques += subcategory.techniques.length;
            summary.steps += subcategory.techniques.reduce(
              (count, technique) => count + (technique.steps?.length || 0),
              0
            );
          });
          return summary;
        },
        { subcategories: 0, techniques: 0, steps: 0 }
      ),
    [catalog]
  );

  const visibleCategories = useMemo(() => {
    if (!normalizedQuery) return catalog;

    return catalog
      .map((category) => {
        const categoryMatches = category.category.toLowerCase().includes(normalizedQuery);
        const matches = category.subcategories.flatMap((subcategory) =>
          subcategory.techniques.filter(
            (technique) =>
              categoryMatches ||
              subcategory.name.toLowerCase().includes(normalizedQuery) ||
              technique.name.toLowerCase().includes(normalizedQuery) ||
              technique.difficulty.toLowerCase().includes(normalizedQuery)
          )
        );
        return { ...category, matches };
      })
      .filter((category) => category.matches.length > 0);
  }, [catalog, normalizedQuery]);

  return (
    <main className={`studio-page ${isAdminStudio ? "studio-page--admin" : ""}`}>
      <section className="studio-hub" aria-label="Training Studio library">
        <header className="studio-hero">
          <div className="studio-hub__intro">
            <p className="eyebrow">
              <span className="studio-live-dot" aria-hidden="true" />
              {isAdminStudio ? "Research environment" : "AI training environment"}
            </p>
            <h1>
              {isAdminStudio ? "Inspect every layer." : "Train with intent."}
              <span>{isAdminStudio ? " Measure every signal." : " Move with precision."}</span>
            </h1>
            <p>
              {isAdminStudio
                ? "Open a technique to inspect motion, action, and predictive layers in real time."
                : "Choose a discipline, understand the technique in Guide mode, then train, practice, and review your progress with coaching shaped around your movement."}
            </p>

            <div className="studio-hero__actions">
              <a className="btn btn--light" href="#studio-library">
                Explore library
              </a>
              {!isAdminStudio ? (
                <>
                  <Link className="btn btn--ghost" to="/dashboard/overview">
                    View my analysis
                  </Link>
                  <Link className="btn btn--ghost" to="/pricing">
                    View plans
                  </Link>
                </>
              ) : (
                <>
                  <button
                    className="btn btn--ghost"
                    disabled={refreshingCatalog}
                    onClick={handleSystemCatalogRefresh}
                    type="button"
                  >
                    {refreshingCatalog ? "Refreshing…" : "Refresh system data"}
                  </button>
                  <button
                    className="btn btn--ghost"
                    disabled={syncingDatabase}
                    onClick={() => handleDatabaseSync("cloud_to_local")}
                    type="button"
                  >
                    {syncingDatabase ? "Syncing…" : "Pull cloud data"}
                  </button>
                  <button
                    className="btn btn--ghost"
                    disabled={syncingDatabase}
                    onClick={() => handleDatabaseSync("local_to_cloud")}
                    type="button"
                  >
                    {syncingDatabase ? "Syncing…" : "Push local data"}
                  </button>
                </>
              )}
            </div>
            {isAdminStudio && catalogRefreshMessage ? (
              <p className="studio-catalog-refresh-status" role="status">{catalogRefreshMessage}</p>
            ) : null}
            {isAdminStudio && databaseSyncMessage ? (
              <p className="studio-catalog-refresh-status" role="status">{databaseSyncMessage}</p>
            ) : null}
          </div>

          <aside className="studio-overview" aria-label="Studio overview">
            <div className="studio-overview__topline">
              <span>{isAdminStudio ? "System coverage" : "Training library"}</span>
              <strong>Ready</strong>
            </div>
            <div className="studio-overview__score">
              <strong>{catalogStatus === "loading" ? "…" : totals.techniques}</strong>
              <span>guided techniques</span>
            </div>
            <div className="studio-overview__metrics">
              <div><strong>{catalog.length}</strong><span>Disciplines</span></div>
              <div><strong>{totals.subcategories}</strong><span>Programs</span></div>
              <div><strong>{totals.steps}</strong><span>Tracked steps</span></div>
            </div>
            <div className="studio-overview__signal">
              <span>Pose engine</span>
              <i aria-hidden="true"><b /><b /><b /><b /><b /><b /></i>
              <strong>Live</strong>
            </div>
          </aside>
        </header>

        <section className="studio-library" id="studio-library">
          <div className="studio-library__heading">
            <div>
              <p className="eyebrow">Your disciplines</p>
              <h2>Choose your focus</h2>
            </div>
            <label className="studio-search">
              <span className="sr-only">Search techniques</span>
              <span aria-hidden="true">⌕</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search techniques, programs, levels…"
                type="search"
                value={query}
              />
            </label>
          </div>

          {catalogStatus === "loading" ? (
            <div className="studio-empty">
              <span>…</span>
              <h3>Loading training library</h3>
              <p>Loading the local training library.</p>
            </div>
          ) : visibleCategories.length ? (
            <div className="studio-category-grid">
              {visibleCategories.map((category, index) => {
                const techniqueCount = category.subcategories.reduce(
                  (total, subcategory) => total + subcategory.techniques.length,
                  0
                );
                const detail = CATEGORY_DETAILS[category.category] || {
                  code: String(index + 1).padStart(2, "0"),
                  description: "Build skill with guided, measurable practice."
                };
                const resultNames = normalizedQuery
                  ? category.matches.slice(0, 3).map((technique) => technique.name)
                  : [];

                return (
                  <Link
                    className="studio-category-card"
                    key={category.category}
                    to={`/categories/${slugify(category.category)}${isAdminStudio ? "?admin=1" : ""}`}
                  >
                    <div className="studio-category-card__top">
                      <span className="studio-category-card__code">{detail.code}</span>
                      <span className="studio-category-card__count">
                        {techniqueCount} {techniqueCount === 1 ? "technique" : "techniques"}
                      </span>
                    </div>
                    <div className="studio-category-card__body">
                      <strong>{category.category}</strong>
                      <p>{detail.description}</p>
                      {resultNames.length ? (
                        <small>Matches: {resultNames.join(" · ")}</small>
                      ) : null}
                    </div>
                    <div className="studio-category-card__footer">
                      <span>
                        {category.subcategories.length} {category.subcategories.length === 1 ? "program" : "programs"}
                      </span>
                      <b aria-hidden="true">↗</b>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="studio-empty">
              <span>00</span>
              <h3>No techniques found</h3>
              <p>Try a category, technique, or difficulty such as “beginner”.</p>
              <button className="btn btn--ghost btn--small" onClick={() => setQuery("")} type="button">
                Clear search
              </button>
            </div>
          )}
        </section>

        {!isAdminStudio ? (
          <section className="studio-method" aria-label="How to use Training Studio">
            <div className="studio-method__heading">
              <p className="eyebrow">Recommended workflow</p>
              <h2>Turn feedback into a repeatable skill.</h2>
              <p>Use all four modes in sequence: understand the movement, learn it with guidance, build repetitions, then review your progress.</p>
            </div>
            <div className="studio-method__steps">
              <article><span>01</span><div><strong>Understand the movement</strong><p>Use Guide to explore a 3D reference, key phases, and safety guidance.</p></div></article>
              <article><span>02</span><div><strong>Train the shape</strong><p>Learn the steps and reach each target with live coaching.</p></div></article>
              <article><span>03</span><div><strong>Practice the rep</strong><p>Set a count and repeat the movement at a controlled pace.</p></div></article>
              <article><span>04</span><div><strong>Review the pattern</strong><p>Use Analysis to find recurring focus areas and plan your next session.</p></div></article>
            </div>
            <div className="studio-readiness"><strong>Before you begin</strong><span>Keep your full body in frame</span><span>Clear floor space</span><span>Even lighting from the front</span><span>Camera at waist–chest height</span></div>
          </section>
        ) : (
          <section className="studio-method" aria-label="Technique authoring workflow">
            <div className="studio-method__heading">
              <p className="eyebrow">Technique data</p>
              <h2>Maintain reviewed angle targets.</h2>
              <p>Author each step with explicit joint ranges used by the deterministic L1–L4 feedback engine.</p>
            </div>
            <div className="studio-hero__actions">
              <Link className="btn btn--light" to="/admin-manual-catalog">
                Open manual catalog
              </Link>
            </div>
          </section>
        )}

        <footer className="studio-footer-note">
          <span>{isAdminStudio ? "Deterministic technique workspace" : "Camera-based coaching · No wearables required"}</span>
          <span>XMartialArt / Studio</span>
        </footer>
      </section>
    </main>
  );
}
