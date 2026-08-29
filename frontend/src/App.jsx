import { lazy, Suspense, useContext, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router";
import { AuthProvider } from "./context/AuthContext";
import { AuthContext } from "./context/auth";
import { CatalogProvider } from "./context/CatalogContext";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import ProtectedRoute from "./components/ProtectedRoute";
import AnalyticsSamplePreview from "./components/AnalyticsSamplePreview";
import FloatingParticles from "./components/MeditationHero/components/FloatingParticles";

import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Studio from "./pages/Studio";
import CategoryPage from "./pages/CategoryPage";
import Pricing from "./pages/Pricing";
import NotFound from "./pages/NotFound";
import Contact from "./pages/Contact";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import PrivacyNotice from "./pages/PrivacyNotice";
import Terms from "./pages/Terms";
import AccountPrivacy from "./pages/AccountPrivacy";

const Training = lazy(() => import("./pages/Training"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const ManualTechniqueCatalogAdmin = lazy(() => import("./pages/ManualTechniqueCatalogAdmin"));

function TrainingRoute() {
  const location = useLocation();
  const { authReady, loginAsGuest, token } = useContext(AuthContext);
  const [guestError, setGuestError] = useState("");
  const searchParams = new URLSearchParams(location.search);
  const mode = searchParams.get("mode");
  const techniqueName = searchParams.get("technique") || "Jab";
  const training = <Training />;

  useEffect(() => {
    if (!authReady || token || mode === "analysis") return;
    let active = true;
    loginAsGuest().catch((error) => {
      if (active) setGuestError(error.message || "Guest mode is temporarily unavailable.");
    });
    return () => {
      active = false;
    };
  }, [authReady, loginAsGuest, mode, token]);

  if (mode === "analysis") {
    return (
        <ProtectedRoute
          preview={<AnalyticsSamplePreview techniqueName={techniqueName} variant="analysis" />}
        >
          {training}
        </ProtectedRoute>
    );
  }

  if (!authReady || !token) {
    return (
      <main className="route-loader" role={guestError ? "alert" : "status"}>
        <span className="studio-live-dot" aria-hidden="true" />
        {guestError ? guestError : "Opening your private guest Studio…"}
        {guestError ? (
          <button
            className="btn btn--light btn--small"
            onClick={() => {
              setGuestError("");
              loginAsGuest().catch((error) => {
                setGuestError(error.message || "Guest mode is temporarily unavailable.");
              });
            }}
            type="button"
          >
            Try again
          </button>
        ) : null}
      </main>
    );
  }

  return training;
}

function AppRoutes() {
  const location = useLocation();
  const isStudio =
    location.pathname === "/training" || location.pathname === "/admin-training" || location.pathname === "/admin-manual-catalog";
  const isLiveStudioRoute = [
    "/admin-studio",
    "/training",
    "/admin-training",
    "/admin-manual-catalog",
  ].includes(location.pathname);
  const showSharedParticles = location.pathname !== "/" && !isLiveStudioRoute;
  const isDashboard = location.pathname.startsWith("/dashboard");

  return (
    <div className={`app-shell ${isStudio ? "app-shell--studio" : ""}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Navbar />

      <div id="main-content" tabIndex="-1">
        {showSharedParticles ? (
          <FloatingParticles
            className="meditation-particles--app"
            count={140}
            seed={97}
            area="app-page"
          />
        ) : null}
        <Suspense
          fallback={
            <main className="route-loader" role="status">
              <span className="studio-live-dot" aria-hidden="true" />
              Preparing movement engine…
            </main>
          }
        >
          <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/categories/:categorySlug" element={<CategoryPage />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/contact" element={<Contact />} />
        <Route
          path="/admin-manual-catalog"
          element={
            <ProtectedRoute requiredRole="admin">
              <ManualTechniqueCatalogAdmin />
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/privacy" element={<PrivacyNotice />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/account/privacy" element={<ProtectedRoute><AccountPrivacy /></ProtectedRoute>} />

        <Route path="/studio" element={<Studio />} />

        <Route
          path="/dashboard/:page?"
          element={
            <ProtectedRoute preview={<AnalyticsSamplePreview variant="dashboard" />}>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin-studio"
          element={
            <ProtectedRoute requiredRole="admin">
              <Studio isAdminStudio />
            </ProtectedRoute>
          }
        />

        <Route path="/training" element={<TrainingRoute />} />

        <Route
          path="/admin-training"
          element={
            <ProtectedRoute requiredRole="admin">
              <Training studioMode="admin" />
            </ProtectedRoute>
          }
        />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </div>
      {!isStudio && !isDashboard ? <Footer /> : null}
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <CatalogProvider>
          <AppRoutes />
        </CatalogProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
