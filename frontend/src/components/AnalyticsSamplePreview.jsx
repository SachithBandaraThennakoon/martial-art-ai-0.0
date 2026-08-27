const SAMPLE_POINTS = "0,88 92,72 184,78 276,48 368,58 460,34 552,42 644,19 736,29 828,12";

const KPI_ITEMS = [
  ["Sessions", "12", "10 completed"],
  ["Average form", "82%", "Best 91%"],
  ["Practice reps", "64", "78% clean"],
  ["Consistency", "86%", "Repeatability"]
];

export default function AnalyticsSamplePreview({ techniqueName = "Jab", variant = "dashboard" }) {
  const isAnalysis = variant === "analysis";
  return (
    <div className="analytics-sample-preview">
      <aside className="analytics-sample-preview__rail">
        <p>Performance filters</p>
        <strong>Last 30 days</strong>
        <span>All modes</span>
        <span>{techniqueName}</span>
        <span>Beginner</span>
      </aside>
      <div className="analytics-sample-preview__main">
        <nav className="analytics-sample-preview__tabs">
          <span className="is-active">Overview</span>
          <span>Performance</span>
          <span>Techniques</span>
          <span>Activity</span>
        </nav>
        <header className="analytics-sample-preview__header">
          <div>
            <p>Personal analytics preview</p>
            <h1>{isAnalysis ? `${techniqueName} analysis` : "Dashboard overview"}</h1>
            <span>Your full insights become available after sign-in</span>
          </div>
          <b>PREVIEW</b>
        </header>
        <div className="analytics-sample-preview__kpis">
          {KPI_ITEMS.map(([label, value, detail]) => (
            <article key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>
          ))}
        </div>
        <section className="analytics-sample-preview__chart">
          <div><p>Form trajectory</p><h2>Accuracy over time</h2></div>
          <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 828 110">
            <polyline points={SAMPLE_POINTS} />
          </svg>
        </section>
        <div className="analytics-sample-preview__lower">
          <section>
            <p>Strongest skills</p>
            <h2>{techniqueName}</h2>
            <div><i style={{ width: "88%" }} /><span>88%</span></div>
            <div><i style={{ width: "79%" }} /><span>79%</span></div>
            <div><i style={{ width: "71%" }} /><span>71%</span></div>
          </section>
          <section>
            <p>Coach recommendation</p>
            <h2>Keep the correction focused</h2>
            <span>Maintain guard recovery while improving extension timing.</span>
          </section>
        </div>
      </div>
    </div>
  );
}
