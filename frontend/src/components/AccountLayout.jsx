import { useContext } from "react";
import { NavLink, Outlet } from "react-router";
import { AuthContext } from "../context/auth";
import ProfileAvatar from "./ProfileAvatar";

export default function AccountLayout() {
  const { accountProfile, userName, userPlan } = useContext(AuthContext);
  const profileFields = [
    accountProfile?.name,
    accountProfile?.primary_martial_art,
    accountProfile?.experience_level,
    accountProfile?.preferred_stance,
    accountProfile?.training_goals?.length,
  ];
  const completion = Math.round((profileFields.filter(Boolean).length / profileFields.length) * 100);
  const navClass = ({ isActive }) => `account-nav__link${isActive ? " is-active" : ""}`;

  return (
    <main className="page account-center">
      <aside className="account-sidebar">
        <div className="account-identity">
          <ProfileAvatar className="account-avatar" name={userName} />
          <div>
            <strong>{userName || "Your account"}</strong>
            <span>{(userPlan || "FREE_PLAN").replace("_PLAN", "")} member</span>
          </div>
        </div>

        <div className="account-completion" aria-label={`Profile ${completion}% complete`}>
          <div><span>Profile strength</span><strong>{completion}%</strong></div>
          <i><span style={{ width: `${completion}%` }} /></i>
        </div>

        <nav className="account-nav" aria-label="Account settings">
          <NavLink className={navClass} to="/account/profile"><span>01</span><div><strong>Training profile</strong><small>Identity and coaching preferences</small></div></NavLink>
          <NavLink className={navClass} to="/account/security"><span>02</span><div><strong>Security</strong><small>Password and access</small></div></NavLink>
          <NavLink className={navClass} to="/account/subscription"><span>03</span><div><strong>Membership</strong><small>Plan and billing status</small></div></NavLink>
          <NavLink className={navClass} to="/account/privacy"><span>04</span><div><strong>Privacy</strong><small>Export and deletion controls</small></div></NavLink>
        </nav>
      </aside>
      <section className="account-workspace">
        <Outlet />
      </section>
    </main>
  );
}
