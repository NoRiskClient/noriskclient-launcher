import { usePlayerAvatar } from "../../hooks/usePlayerAvatar";

export function AccountAvatar({ uuid, name }: { uuid: string; name: string }) {
  const avatarUrl = usePlayerAvatar({ uuid, overlay: true });
  if (!avatarUrl) return null;
  return (
    <img
      src={avatarUrl}
      alt={name}
      className="h-full w-full object-cover"
      style={{ imageRendering: "pixelated" }}
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  );
}
