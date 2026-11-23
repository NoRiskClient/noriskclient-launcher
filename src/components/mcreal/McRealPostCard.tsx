"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import type { McRealPostWithRating } from "../../types/mcreal";
import { deleteMcRealPost } from "../../services/mcreal-service";
import { useMcRealStore } from "../../store/mcreal-store";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import { useThemeStore } from "../../store/useThemeStore";
import { McRealImage } from "./McRealImage";
import { McRealComments } from "./McRealComments";
import { parseErrorMessage } from "../../utils/error-utils";

/** "Xh Late" / "Xm Late" badge relative to the daily McReal window (15 min). */
function lateBadge(entry: McRealPostWithRating): string | null {
  try {
    const upload = new Date(`${entry.post.uploadDate}T${entry.post.uploadTime}`);
    const windowStart = new Date(`${entry.post.mcRealDate}T${entry.post.mcRealTime}`);
    const diffMin = Math.floor(
      (upload.getTime() - windowStart.getTime()) / 60000 - 15,
    );
    if (diffMin <= 0) return null;
    if (diffMin >= 60) return `${Math.floor(diffMin / 60)}h`;
    return `${diffMin}m`;
  } catch {
    return null;
  }
}

export function McRealPostCard({ entry }: { entry: McRealPostWithRating }) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const activeAccount = useMinecraftAuthStore((s) => s.activeAccount);
  const usernames = useMcRealStore((s) => s.usernames);
  const resolveUsername = useMcRealStore((s) => s.resolveUsername);
  const ratePost = useMcRealStore((s) => s.ratePost);
  const removePost = useMcRealStore((s) => s.removePost);
  const [showComments, setShowComments] = useState(false);

  const author = entry.post.author;
  const isOwn =
    activeAccount?.id?.replace(/-/g, "") === author.replace(/-/g, "");

  useEffect(() => {
    if (!isOwn) void resolveUsername(author);
  }, [author, isOwn, resolveUsername]);

  const name = isOwn
    ? t("mcreal.post.your_post")
    : usernames[author] || `${author.slice(0, 8)}…`;

  const late = useMemo(() => lateBadge(entry), [entry]);
  const score = entry.likes - entry.dislikes;
  const time = entry.post.uploadTime?.split(".")[0] ?? "";

  const handleDelete = async () => {
    try {
      await deleteMcRealPost(entry.post._id);
      removePost(entry.post._id);
      toast.success(t("mcreal.post.deleted"));
    } catch (e) {
      toast.error(parseErrorMessage(e));
    }
  };

  return (
    <div
      className="w-full rounded-lg border backdrop-blur-md p-3"
      style={{
        backgroundColor: "rgba(0,0,0,0.35)",
        borderColor: `${accentColor.value}30`,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-2.5">
        <img
          src={`https://mc-heads.net/avatar/${author}/40`}
          alt=""
          className="w-9 h-9 rounded-md flex-shrink-0"
          style={{ imageRendering: "pixelated" }}
        />
        <div className="flex-1 min-w-0">
          <div
            className="font-minecraft-ten text-sm truncate"
            style={{ color: isOwn ? "#3493eb" : "white" }}
          >
            {name}
          </div>
          <div className="font-minecraft-ten text-[11px] text-white/45 truncate">
            {entry.post.serverIp ? `${entry.post.serverIp} • ` : ""}
            {late ? t("mcreal.post.late", { time: late }) : time}
            {entry.post.friendsOnly ? " • 🔒" : ""}
          </div>
        </div>
        {isOwn && (
          <button
            onClick={handleDelete}
            className="bg-transparent border-none cursor-pointer text-white/40 hover:text-red-400 p-1"
            aria-label={t("mcreal.post.delete")}
          >
            <Icon icon="solar:trash-bin-trash-bold" className="w-4.5 h-4.5" />
          </button>
        )}
      </div>

      <McRealImage postId={entry.post._id} />

      {/* Footer */}
      <div className="flex items-start gap-2 mt-2.5">
        <div className="flex-1 min-w-0">
          {entry.post.title && (
            <div className="font-minecraft-ten text-xs text-white/90 break-words">
              {entry.post.title}
            </div>
          )}
          <button
            onClick={() => setShowComments((v) => !v)}
            className="bg-transparent border-none cursor-pointer p-0 mt-1 font-minecraft-ten text-[11px]"
            style={{ color: "#2995FF" }}
          >
            {showComments
              ? t("mcreal.comments.hide")
              : t("mcreal.comments.show")}
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span
            className={`font-minecraft-ten text-sm ${score > 0 ? "text-green-400" : score < 0 ? "text-red-400" : "text-white/50"}`}
          >
            {score}
          </span>
          <button
            onClick={() => ratePost(entry.post._id, true)}
            className={`bg-transparent border-none cursor-pointer p-1 ${entry.userRating?.isPositive ? "text-green-400" : "text-white/50 hover:text-white"}`}
            aria-label={t("mcreal.rating.like")}
          >
            <Icon icon="solar:like-bold" className="w-5 h-5" />
          </button>
          <button
            onClick={() => ratePost(entry.post._id, false)}
            className={`bg-transparent border-none cursor-pointer p-1 ${entry.userRating && !entry.userRating.isPositive ? "text-red-400" : "text-white/50 hover:text-white"}`}
            aria-label={t("mcreal.rating.dislike")}
          >
            <Icon icon="solar:dislike-bold" className="w-5 h-5" />
          </button>
        </div>
      </div>

      {showComments && <McRealComments postId={entry.post._id} />}
    </div>
  );
}
