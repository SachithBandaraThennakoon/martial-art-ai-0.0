import { useContext, useState } from "react";
import { useNavigate } from "react-router";
import { AuthContext } from "../context/auth";
import { API_BASE_URL } from "../services/api";
import { authFetch } from "../services/authSession";

export default function AccountPrivacy() {
  const { logout, userRole } = useContext(AuthContext);
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const exportData = async () => {
    setBusy(true);
    setStatus("");
    try {
      const response = await authFetch(`${API_BASE_URL}/account/export`);
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || "We couldn’t prepare your account export.");
      const blob = new Blob([JSON.stringify(await response.json(), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `xmartialart-account-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setStatus("Your account export was downloaded.");
    } catch (error) {
      setStatus(error.message || "Your account export is temporarily unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async (event) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const response = await authFetch(`${API_BASE_URL}/account`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmation })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "We couldn’t delete your account.");
      logout();
      navigate("/", { replace: true });
    } catch (error) {
      setStatus(error.message || "Account deletion is temporarily unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-panel account-privacy-page">
      <header className="account-panel__header"><div><p className="eyebrow">Your data controls</p><h1>Privacy &amp; account</h1><p>Download your information or permanently close your account.</p></div><span className="account-panel__badge">Private</span></header>
      <section className="privacy-card">
        <h2>Download your data</h2>
        <p>Download your profile, consent, training, practice, calibration, support, and billing data as a JSON file. The export also lists your movement tapes and secure download links.</p>
        <button className="btn btn--light" disabled={busy} onClick={exportData} type="button">Download account export</button>
      </section>
      <section className="privacy-card privacy-card--danger">
        <h2>Delete your account</h2>
        {userRole === "admin" ? (
          <p>Administrator accounts require the documented operational deletion process so ownership and audit duties can be reassigned safely.</p>
        ) : (
          <form onSubmit={deleteAccount}>
            <p>This action cannot be undone. Your active PayPal subscription is canceled first, then your stored tapes and account records are erased. Residual backups expire according to their retention schedule.</p>
            <label className="field"><span>Current password</span><input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
            <label className="field"><span>Type DELETE</span><input onChange={(event) => setConfirmation(event.target.value)} pattern="DELETE" required value={confirmation} /></label>
            <button className="btn btn--danger" disabled={busy || confirmation !== "DELETE"} type="submit">Permanently delete account</button>
          </form>
        )}
      </section>
      {status ? <p className="form-status" role="status">{status}</p> : null}
    </div>
  );
}
