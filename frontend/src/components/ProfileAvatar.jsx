import { useContext, useEffect, useState } from "react";
import { AuthContext } from "../context/auth";
import { API_BASE_URL } from "../services/api";
import { authFetch } from "../services/authSession";

const initials = (name = "") => name
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0]?.toUpperCase())
  .join("") || "MA";

export default function ProfileAvatar({ className = "", name = "", previewUrl = "" }) {
  const { accountProfile } = useContext(AuthContext);
  const [avatarUrl, setAvatarUrl] = useState("");

  useEffect(() => {
    if (!accountProfile?.has_avatar) {
      return undefined;
    }

    const controller = new AbortController();
    let objectUrl = "";
    authFetch(`${API_BASE_URL}/me/avatar`, { signal: controller.signal })
      .then((response) => response.ok ? response.blob() : Promise.reject(new Error("Avatar unavailable")))
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setAvatarUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvatarUrl("");
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accountProfile?.avatar_updated_at, accountProfile?.has_avatar]);

  const source = previewUrl || (accountProfile?.has_avatar ? avatarUrl : "");
  return (
    <span className={`profile-avatar ${className}`.trim()} aria-hidden="true">
      {source ? <img alt="" src={source} /> : initials(name)}
    </span>
  );
}
