import { Link } from "react-router";

export default function PrivacyNotice() {
  return (
    <main className="page legal-page">
      <p className="eyebrow">Version 2026-08-30</p>
      <h1>Privacy notice</h1>
      <p>XMartialArt uses the minimum information needed to provide accounts, movement coaching, support, security, and subscriptions.</p>
      <h2>Information we process</h2>
      <p>Your name, email, account and subscription status; calibration ratios; training sessions, repetitions, feedback, movement landmark tapes, and raw Practice recordings used for recorded-video verification; support messages; and limited security/session metadata. We do not need your date of birth for registration.</p>
      <h2>How we use and share it</h2>
      <p>We use this information to authenticate you, deliver and improve coaching, remember progress, provide support, prevent abuse, and administer billing. Production data is handled by our contracted hosting, storage, monitoring, email, and payment providers only as needed for those services. PayPal processes payment details under its own notice.</p>
      <h2>Retention and choices</h2>
      <p>Practice tapes are scheduled for deletion after 90 days. Raw Practice recordings and core account and training records remain until you delete your account, unless a legal hold requires us to retain them. Contact messages are retained for 365 days, and expired, used, or revoked authentication records for 30 days. Backups expire according to their retention schedule.</p>
      <p>You can download a machine-readable copy of your data or delete your account from <Link to="/account/privacy">Privacy &amp; account</Link>. You may also request access, correction, erasure, or restriction, or raise an objection through <Link to="/contact">Contact</Link>. We may need to verify your identity, and lawful exceptions may apply.</p>
      <h2>Contact and changes</h2>
      <p>Contact the XMartialArt privacy team through the contact page. Material changes receive a new notice version and may require fresh acceptance.</p>
    </main>
  );
}
