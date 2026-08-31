import { useContext, useEffect, useState } from "react";
import { AuthContext } from "../context/auth";
import { API_BASE_URL } from "../services/api";
import { getApiErrorMessage } from "../services/apiError";
import { authFetch } from "../services/authSession";
import ProfileAvatar from "../components/ProfileAvatar";

const GOALS = [
  ["technique", "Sharper technique"],
  ["fitness", "Fitness & conditioning"],
  ["flexibility", "Mobility & flexibility"],
  ["self_defense", "Self-defense"],
  ["competition", "Competition"],
  ["mindfulness", "Mindfulness"],
];

const SAMPLE_AVATARS = [
  "01_guard_stance.png",
  "02_jab.png",
  "03_cross.png",
  "04_hook.png",
  "05_uppercut.png",
  "06_front_kick.png",
  "07_roundhouse_kick.png",
  "08_side_kick.png",
  "09_knee_strike.png",
  "10_elbow_strike.png",
  "11_high_block.png",
  "12_low_block.png",
  "13_dodge_lean_back.png",
  "14_grappling_stance.png",
  "15_meditation.png",
  "16_bow_respect.png",
  "17_sword_guard.png",
  "18_nunchaku_pose.png",
  "19_footwork_stance.png",
  "20_spinning_kick.png",
  "21_defensive_guard.png",
  "22_low_stance.png",
  "23_muay_thai_guard.png",
  "24_taekwondo_kick.png",
];

const sampleLabel = (fileName) => fileName
  .replace(/^\d+_/, "")
  .replace(".png", "")
  .replaceAll("_", " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const EMPTY_PROFILE = {
  name: "",
  primary_martial_art: "",
  experience_level: "",
  preferred_stance: "",
  training_goals: [],
  measurement_units: "metric",
  coaching_style: "balanced",
};

export default function AccountProfile() {
  const { accountProfile, refreshProfile } = useContext(AuthContext);
  const [form, setForm] = useState(EMPTY_PROFILE);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [selectedSample, setSelectedSample] = useState("");

  useEffect(() => {
    if (!accountProfile) return;
    setForm({
      ...EMPTY_PROFILE,
      ...accountProfile,
      training_goals: accountProfile.training_goals || [],
    });
  }, [accountProfile]);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview("");
      return undefined;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const toggleGoal = (goal) => setForm((current) => ({
    ...current,
    training_goals: current.training_goals.includes(goal)
      ? current.training_goals.filter((item) => item !== goal)
      : [...current.training_goals, goal],
  }));

  const saveProfile = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await authFetch(`${API_BASE_URL}/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(getApiErrorMessage(data.detail, "We couldn’t save your profile."));
      await refreshProfile();
      setStatus("Your training profile is up to date.");
    } catch (saveError) {
      setError(saveError.message || "We couldn’t save your profile.");
    } finally {
      setBusy(false);
    }
  };

  const selectAvatar = (event) => {
    const file = event.target.files?.[0];
    setError("");
    setStatus("");
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPEG, PNG, or WebP image.");
      event.target.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Profile images must be 2 MB or smaller.");
      event.target.value = "";
      return;
    }
    setAvatarFile(file);
    setSelectedSample("");
  };

  const selectSampleAvatar = async (fileName) => {
    setError("");
    setStatus("");
    try {
      const response = await fetch(`/profile-avatars/${fileName}`);
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      setAvatarFile(new File([blob], fileName, { type: "image/png" }));
      setSelectedSample(fileName);
    } catch {
      setError("We couldn’t load that sample image. Please choose another one.");
    }
  };

  const uploadAvatar = async () => {
    if (!avatarFile) return;
    setAvatarBusy(true);
    setError("");
    setStatus("");
    try {
      const data = new FormData();
      data.append("avatar", avatarFile);
      const response = await authFetch(`${API_BASE_URL}/me/avatar`, { method: "PUT", body: data });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(getApiErrorMessage(result.detail, "We couldn’t save your profile image."));
      await refreshProfile();
      setAvatarFile(null);
      setSelectedSample("");
      setStatus("Your profile image is up to date.");
    } catch (uploadError) {
      setError(uploadError.message || "We couldn’t save your profile image.");
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await authFetch(`${API_BASE_URL}/me/avatar`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(getApiErrorMessage(result.detail, "We couldn’t remove your profile image."));
      await refreshProfile();
      setAvatarFile(null);
      setSelectedSample("");
      setStatus("Profile image removed.");
    } catch (removeError) {
      setError(removeError.message || "We couldn’t remove your profile image.");
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <div className="account-panel">
      <header className="account-panel__header">
        <div><p className="eyebrow">Personal coaching foundation</p><h1>Training profile</h1><p>Tell the coach how you train. These details stay private to your account.</p></div>
        <span className="account-panel__badge">Private</span>
      </header>

      <form className="account-form" onSubmit={saveProfile}>
        <section className="account-form__section account-avatar-editor">
          <div className="account-form__heading"><span>00</span><div><h2>Profile image</h2><p>Upload a private image used across your account.</p></div></div>
          <div className="account-avatar-editor__layout">
            <div className="account-avatar-editor__body">
              <ProfileAvatar className="account-avatar account-avatar--large" name={form.name} previewUrl={avatarPreview} />
              <div className="account-avatar-editor__controls">
                <label className="btn btn--ghost account-avatar-picker">
                  <input accept="image/jpeg,image/png,image/webp" onChange={selectAvatar} type="file" />
                  Choose image
                </label>
                {avatarFile ? <button className="btn btn--light" disabled={avatarBusy} onClick={uploadAvatar} type="button">{avatarBusy ? "Uploading…" : "Upload image"}</button> : null}
                {accountProfile?.has_avatar && !avatarFile ? <button className="btn btn--ghost" disabled={avatarBusy} onClick={removeAvatar} type="button">{avatarBusy ? "Removing…" : "Remove"}</button> : null}
                <small>JPEG, PNG, or WebP · maximum 2 MB</small>
              </div>
            </div>
            <div className="account-avatar-samples">
              <div><strong>Choose your martial arts avatar</strong><span>Pick a pose, preview it, then save.</span></div>
              <div className="account-avatar-samples__grid">
                {SAMPLE_AVATARS.map((fileName) => (
                  <button
                    aria-label={`Choose ${sampleLabel(fileName)}`}
                    className={selectedSample === fileName ? "is-selected" : ""}
                    key={fileName}
                    onClick={() => selectSampleAvatar(fileName)}
                    title={sampleLabel(fileName)}
                  type="button"
                >
                  <img alt="" loading="lazy" src={`/profile-avatars/${fileName}`} />
                </button>
                ))}
              </div>
            </div>
          </div>
        </section>
        <section className="account-form__section">
          <div className="account-form__heading"><span>01</span><div><h2>Identity</h2><p>The essentials shown across your training space.</p></div></div>
          <div className="account-form__grid">
            <label className="field"><span>Full name</span><input autoComplete="name" maxLength="100" minLength="2" onChange={(event) => setField("name", event.target.value)} required value={form.name} /></label>
            <label className="field"><span>Email</span><input disabled type="email" value={accountProfile?.email || ""} /><small>Contact support if you need to change your sign-in email.</small></label>
          </div>
        </section>

        <section className="account-form__section">
          <div className="account-form__heading"><span>02</span><div><h2>Martial arts background</h2><p>Used to choose appropriate explanations and progressions.</p></div></div>
          <div className="account-form__grid account-form__grid--three">
            <label className="field"><span>Primary martial art</span><input list="martial-art-options" maxLength="64" onChange={(event) => setField("primary_martial_art", event.target.value)} placeholder="e.g. Karate" value={form.primary_martial_art} /><datalist id="martial-art-options"><option value="Karate" /><option value="Taekwondo" /><option value="Muay Thai" /><option value="Boxing" /><option value="Kickboxing" /><option value="Brazilian Jiu-Jitsu" /><option value="Judo" /><option value="Kung Fu" /><option value="MMA" /></datalist></label>
            <label className="field"><span>Experience</span><select onChange={(event) => setField("experience_level", event.target.value)} value={form.experience_level}><option value="">Not set</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option><option value="instructor">Instructor</option></select></label>
            <label className="field"><span>Preferred stance</span><select onChange={(event) => setField("preferred_stance", event.target.value)} value={form.preferred_stance}><option value="">Not set</option><option value="orthodox">Orthodox</option><option value="southpaw">Southpaw</option><option value="switch">Switch</option><option value="not_sure">Not sure yet</option></select></label>
          </div>
        </section>

        <section className="account-form__section">
          <div className="account-form__heading"><span>03</span><div><h2>Training goals</h2><p>Select every outcome that matters to you.</p></div></div>
          <div className="account-goals">
            {GOALS.map(([value, label]) => <label className={form.training_goals.includes(value) ? "is-selected" : ""} key={value}><input checked={form.training_goals.includes(value)} onChange={() => toggleGoal(value)} type="checkbox" /><span>{label}</span></label>)}
          </div>
        </section>

        <section className="account-form__section">
          <div className="account-form__heading"><span>04</span><div><h2>Coach preferences</h2><p>Control the tone and measurements used in future coaching.</p></div></div>
          <div className="account-form__grid">
            <label className="field"><span>Coaching style</span><select onChange={(event) => setField("coaching_style", event.target.value)} value={form.coaching_style}><option value="supportive">Supportive — more encouragement</option><option value="balanced">Balanced — clear and encouraging</option><option value="direct">Direct — concise corrections</option></select></label>
            <label className="field"><span>Measurement units</span><select onChange={(event) => setField("measurement_units", event.target.value)} value={form.measurement_units}><option value="metric">Metric (cm, kg)</option><option value="imperial">Imperial (in, lb)</option></select></label>
          </div>
        </section>

        <div className="account-form__actions">
          <div>{error ? <p className="form-error" role="alert">{error}</p> : null}{status ? <p className="form-success" role="status">{status}</p> : null}</div>
          <button className="btn btn--light" disabled={busy} type="submit">{busy ? "Saving…" : "Save profile"}</button>
        </div>
      </form>
    </div>
  );
}
