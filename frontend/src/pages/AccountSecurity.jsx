import { useContext, useState } from "react";
import { AuthContext } from "../context/auth";
import { API_BASE_URL } from "../services/api";
import { getApiErrorMessage } from "../services/apiError";
import { authFetch } from "../services/authSession";

export default function AccountSecurity() {
  const { accountProfile, logout } = useContext(AuthContext);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const changePassword = async (event) => {
    event.preventDefault();
    setError("");
    if (newPassword !== confirmation) {
      setError("New password and confirmation do not match.");
      return;
    }
    setBusy(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/account/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(getApiErrorMessage(data.detail, "We couldn’t update your password."));
      logout();
      window.location.assign("/login?password=changed");
    } catch (changeError) {
      setError(changeError.message || "We couldn’t update your password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-panel">
      <header className="account-panel__header"><div><p className="eyebrow">Account protection</p><h1>Security</h1><p>Keep access to your private coaching history protected.</p></div><span className="account-panel__badge account-panel__badge--secure">Protected</span></header>
      <section className="account-summary-card"><span>Sign-in email</span><strong>{accountProfile?.email}</strong><p>Your email is never displayed publicly.</p></section>
      <form className="account-form account-form--compact" onSubmit={changePassword}>
        <section className="account-form__section">
          <div className="account-form__heading"><span>01</span><div><h2>Change password</h2><p>Changing your password signs out every active session.</p></div></div>
          <div className="account-form__stack">
            <label className="field"><span>Current password</span><input autoComplete="current-password" onChange={(event) => setCurrentPassword(event.target.value)} required type="password" value={currentPassword} /></label>
            <label className="field"><span>New password</span><input autoComplete="new-password" minLength="8" onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} /><small>Use at least 8 characters.</small></label>
            <label className="field"><span>Confirm new password</span><input autoComplete="new-password" minLength="8" onChange={(event) => setConfirmation(event.target.value)} required type="password" value={confirmation} /></label>
          </div>
        </section>
        <div className="account-form__actions"><div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div><button className="btn btn--light" disabled={busy || newPassword.length < 8} type="submit">{busy ? "Updating…" : "Update password"}</button></div>
      </form>
    </div>
  );
}
