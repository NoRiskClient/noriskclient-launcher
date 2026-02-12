import { memo } from "react";

interface FriendSkeletonProps {
  accentColor: string;
}

export const FriendSkeleton = memo(function FriendSkeleton({ accentColor }: FriendSkeletonProps) {
  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl"
      style={{ backgroundColor: `${accentColor}15` }}
    >
      <div
        className="w-12 h-12 rounded-lg flex-shrink-0"
        style={{ backgroundColor: `${accentColor}25` }}
      />
      <div className="flex-1">
        <div
          className="h-4 rounded-md w-28 mb-2"
          style={{ backgroundColor: `${accentColor}20` }}
        />
        <div
          className="h-3 rounded-md w-20"
          style={{ backgroundColor: `${accentColor}15` }}
        />
      </div>
    </div>
  );
});
