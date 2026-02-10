import { memo } from "react";

interface NotificationBadgeProps {
  count: number;
  maxCount?: number;
}

export const NotificationBadge = memo(function NotificationBadge({
  count,
  maxCount = 9,
}: NotificationBadgeProps) {
  if (count <= 0) return null;

  const displayCount = count > maxCount ? `${maxCount}+` : count;

  return (
    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-minecraft-ten min-w-[16px] h-[16px] flex items-center justify-center px-1 pointer-events-none leading-none">
      {displayCount}
    </span>
  );
});
