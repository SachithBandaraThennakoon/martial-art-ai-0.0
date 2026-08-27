import { useContext, useCallback, useState } from "react";
import { Link } from "react-router";
import PayPalSubscriptionButton from "../components/PayPalSubscriptionButton";
import { AuthContext } from "../context/auth";
import { API_BASE_URL } from "../services/api";
import { authFetch } from "../services/authSession";
import {
  getPayPalPlanId,
  planFeatureNames,
  subscriptionPlans
} from "../data/subscriptionPlans";

function formatPrice(price) {
  return price === 0 ? "Free" : `$${price.toFixed(2)}`;
}

function formatFeature(value) {
  if (value === "Yes") return "Included";
  if (value === "No") return "Not included";
  return value;
}

export default function Pricing() {
  const { isGuest, token, userPlan, refreshProfile } = useContext(AuthContext) || {};
  const [activationMessage, setActivationMessage] = useState("");

  const createCheckoutContext = useCallback(
    async (planCode) => {
      const response = await authFetch(
        `${API_BASE_URL}/subscription/checkout-context`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ plan: planCode })
        }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || "Unable to prepare secure checkout");
      }
      return response.json();
    },
    [token]
  );

  const activatePlan = useCallback(
    async ({ planCode, subscriptionId }) => {
      if (!token) {
        setActivationMessage(
          "Payment approved, but your session expired. Please sign in again."
        );
        return;
      }

      try {
        const response = await authFetch(`${API_BASE_URL}/subscription/activate`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            plan: planCode,
            paypal_subscription_id: subscriptionId
          })
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.detail || "We couldn’t activate your plan.");
        }

        await refreshProfile?.();
        setActivationMessage(
          `${planCode.replace("_PLAN", "")} package activated.`
        );
      } catch (error) {
        setActivationMessage(
          error.message ||
            "Payment was approved, but we couldn’t activate your plan. Please contact support."
        );
      }
    },
    [refreshProfile, token]
  );

  return (
    <main className="page pricing-page">
      <section className="pricing-hero">
        <p className="eyebrow">Simple monthly membership</p>
        <h1>Choose the coaching depth you need.</h1>
        <p>
          Start with the full learning loop: Guide, Train, Practice, and Analysis. Upgrade when you need a larger library,
          longer coaching sessions, richer history, and performance reporting.
        </p>
        <div className="pricing-hero__facts"><span>Camera-based coaching</span><span>All disciplines</span><span>Secure PayPal checkout</span></div>
      </section>

      {activationMessage && (
        <p className="subscription-alert">{activationMessage}</p>
      )}

      <section className="pricing-grid">
        {subscriptionPlans.map((plan) => {
          const isActivePlan = Boolean(token) && userPlan === plan.code;

          return (
          <article
            className={`pricing-card ${
              plan.featured ? "pricing-card--featured" : ""
            } ${isActivePlan ? "pricing-card--active" : ""}`}
            key={plan.id}
          >
            {isActivePlan ? (
              <span className="pricing-badge pricing-badge--active">
                Active plan
              </span>
            ) : (
              plan.featured && <span className="pricing-badge">Best value</span>
            )}
            <p className="eyebrow">{plan.name}</p>
            <span className="pricing-audience">For {plan.audience}</span>
            <h2>{formatPrice(plan.price)}</h2>
            <span className="pricing-billing">{plan.billing}</span>
            <p className="pricing-description">{plan.description}</p>
            <ul className="pricing-highlights">
              {plan.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
            </ul>
            <span
              className={`current-plan-chip ${
                isActivePlan ? "current-plan-chip--active" : ""
              }`}
            >
              {isActivePlan ? "Current plan" : plan.code.replace("_PLAN", "")}
            </span>

            <div className="pricing-actions">
              {isActivePlan ? (
                <div className="active-plan-box">
                  <strong>Your active plan</strong>
                  <span>
                    {plan.price === 0
                      ? "Free training access is active on this account."
                      : "Payment is connected and this plan is active."}
                  </span>
                  <Link className="btn btn--light btn--full" to="/studio">
                    Open Studio
                  </Link>
                </div>
              ) : plan.price === 0 ? (
                <Link className="btn btn--light btn--full" to={token ? "/studio" : "/register"}>
                  {token ? plan.cta : "Start free"}
                </Link>
              ) : !token ? (
                <div className="pricing-login-box">
                  <p>Create an account or sign in before payment so we can attach this plan to your account.</p>
                  <Link className="btn btn--light btn--full" to="/login">
                    Sign in to pay
                  </Link>
                  <Link className="btn btn--ghost btn--full" to="/register">
                    Create an account
                  </Link>
                </div>
              ) : isGuest ? (
                <div className="pricing-login-box">
                  <p>The guest demo already includes Elite access. Create an account when you are ready to choose a paid plan.</p>
                  <Link className="btn btn--light btn--full" to="/register">
                    Create an account
                  </Link>
                </div>
              ) : (
                <PayPalSubscriptionButton
                  createCheckoutContext={createCheckoutContext}
                  onApproved={activatePlan}
                  planCode={plan.code}
                  planId={getPayPalPlanId(plan)}
                  planName={plan.name}
                />
              )}
            </div>

            <details className="pricing-details">
              <summary>
                <span>View plan details</span>
                <b aria-hidden="true">+</b>
              </summary>
              <dl className="plan-features">
                {planFeatureNames.map((featureName) => (
                  <div key={featureName}>
                    <dt>{featureName}</dt>
                    <dd>{formatFeature(plan.features[featureName])}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </article>
          );
        })}
      </section>

      <section className="pricing-guidance">
        <div><p className="eyebrow">Quick recommendation</p><h2>Most learners should start Free, then move to Starter when training becomes a weekly habit.</h2></div>
        <div className="pricing-guidance__steps"><span><b>Free</b> Try camera coaching</span><span><b>Starter</b> Build consistency</span><span><b>Pro</b> Analyze performance</span><span><b>Elite</b> Train at scale</span></div>
      </section>

      <section className="pricing-faq">
        <div className="section-heading"><p className="eyebrow">Plan questions</p><h2>What to know before you choose.</h2></div>
        <div className="pricing-faq__grid">
          <article><h3>Do I need equipment?</h3><p>No wearables are required. Use a supported browser, a camera, and enough space to move safely.</p></article>
          <article><h3>Are all disciplines available?</h3><p>Yes. Plans change technique quantity, coaching time, history, and analysis depth—not the discipline list.</p></article>
          <article><h3>How is payment handled?</h3><p>Paid memberships use PayPal subscription checkout. Your plan becomes active only after the payment and selected plan are verified.</p></article>
          <article><h3>Need help choosing?</h3><p>Tell us how often you train and what you want to improve.</p><Link to="/contact">Contact our team →</Link></article>
        </div>
      </section>
    </main>
  );
}
