"use client";
// The user's profile picture laid over an initials circle. The server returns
// their upload or an initials SVG, so the initials underneath only show while
// the image loads (or if it fails).
export function AvatarImg({ id, v }: { id?: string | null; v?: string | number | null }) {
  if (!id) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- authorized avatar route
    <img
      src={`/api/users/${id}/avatar${v ? `?v=${v}` : ""}`}
      alt=""
      loading="lazy"
      draggable={false}
      onError={(e) => e.currentTarget.remove()}
      className="absolute inset-0 h-full w-full rounded-full object-cover"
    />
  );
}
