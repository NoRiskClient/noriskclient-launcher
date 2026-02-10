import { useThemeStore } from "../../store/useThemeStore";

export function FriendSkeleton() {
  const { accentColor } = useThemeStore();

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl"
      style={{ backgroundColor: `${accentColor.value}15` }}
    >
      <div
        className="w-12 h-12 rounded-lg animate-pulse"
        style={{ backgroundColor: `${accentColor.value}25` }}
      />
      <div className="flex-1">
        <div
          className="h-4 rounded-md w-28 mb-2 animate-pulse"
          style={{ backgroundColor: `${accentColor.value}20` }}
        />
        <div
          className="h-3 rounded-md w-20 animate-pulse"
          style={{ backgroundColor: `${accentColor.value}15` }}
        />
      </div>
    </div>
  );
}
