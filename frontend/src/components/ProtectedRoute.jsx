import { useContext } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { AuthContext } from "../context/auth";
import AuthStory from "./AuthStory";

function SignInPanel({ isAnalysis, location }) {
  return (
    <section className="auth-card guest-preview-gate__panel" aria-labelledby="sign-in-required-title">
      <p className="eyebrow">Personal workspace</p>
      <h1 id="sign-in-required-title">Sign in to continue</h1>
      <p className="auth-card__subtitle">
        {isAnalysis
          ? "Sign in to connect your progress, session history, and coaching results."
          : "This area saves personal training information and requires an account."}
      </p>
      <Link className="btn btn--light btn--full" state={{ from: location }} to="/login">
        Sign in and continue
      </Link>
      <p className="auth-card__footer">
        New here? <Link state={{ from: location }} to="/register">Create an account</Link>
      </p>
      <p className="auth-card__footer"><Link to="/studio">Continue browsing Studio</Link></p>
    </section>
  );
}

export default function ProtectedRoute({ children, preview = null, requiredRole }) {
  const { token, authReady, userRole } = useContext(AuthContext);
  const location = useLocation();

  if (!authReady) {
    return (
      <main className="route-loader" role="status">
        <span className="studio-live-dot" aria-hidden="true" />
        Checking your session…
      </main>
    );
  }

  if (!token) {
    const isAnalysis = location.pathname.startsWith("/dashboard") ||
      new URLSearchParams(location.search).get("mode") === "analysis";

    if (preview) {
      return (
        <main className={`guest-preview-gate ${isAnalysis ? "guest-preview-gate--interactive" : ""}`}>
          <div
            aria-hidden={isAnalysis ? undefined : "true"}
            className={`guest-preview-gate__background ${
              isAnalysis ? "guest-preview-gate__background--interactive" : ""
            }`}
            inert={isAnalysis ? undefined : ""}
          >
            {preview}
          </div>
          <div className="guest-preview-gate__overlay">
            <SignInPanel isAnalysis={isAnalysis} location={location} />
          </div>
        </main>
      );
    }

    return (
      <main className="page auth-page">
        <AuthStory mode="login" />
        <SignInPanel isAnalysis={isAnalysis} location={location} />
      </main>
    );
  }

  if (requiredRole && userRole !== requiredRole) {
    return <Navigate replace to="/studio" />;
  }

  return children;
}
