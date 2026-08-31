import { useContext } from "react";
import { Link } from "react-router";
import { AuthContext } from "../context/auth";
import { subscriptionPlans } from "../data/subscriptionPlans";

const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : "Not scheduled";

export default function AccountSubscription() {
  const { accountProfile, subscriptionStatus, userPlan } = useContext(AuthContext);
  const plan = subscriptionPlans.find((item) => item.code === userPlan) || subscriptionPlans[0];
  const renewalDate = accountProfile?.subscription_ends_at || accountProfile?.trial_ends_at;

  return (
    <div className="account-panel">
      <header className="account-panel__header"><div><p className="eyebrow">Training access</p><h1>Membership</h1><p>Review the plan currently connected to your account.</p></div><span className="account-panel__badge">{subscriptionStatus}</span></header>
      <section className="membership-card">
        <div><p className="eyebrow">Current plan</p><h2>{plan.name}</h2><p>{plan.description}</p></div>
        <strong>{plan.price === 0 ? "Free" : `$${plan.price.toFixed(2)}`}<small>{plan.price === 0 ? "current access" : plan.billing}</small></strong>
      </section>
      <div className="account-stat-grid">
        <article><span>Status</span><strong>{subscriptionStatus || "inactive"}</strong><small>Account billing state</small></article>
        <article><span>Access date</span><strong>{formatDate(renewalDate)}</strong><small>{accountProfile?.subscription_ends_at ? "Current period end" : "Trial end"}</small></article>
        <article><span>Member since</span><strong>{formatDate(accountProfile?.created_at)}</strong><small>Your XMartialArt journey</small></article>
      </div>
      <section className="account-callout"><div><h2>Need a different coaching depth?</h2><p>Compare technique access, history, analytics, and daily coaching limits.</p></div><Link className="btn btn--light" to="/pricing">Compare plans</Link></section>
    </div>
  );
}
