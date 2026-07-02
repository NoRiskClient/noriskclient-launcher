"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import type { McRealCommentWithRating } from "../../types/mcreal";
import {
  addMcRealComment,
  getMcRealComments,
  rateMcRealComment,
  unrateMcRealComment,
} from "../../services/mcreal-service";
import { useMcRealStore } from "../../store/mcreal-store";
import { useThemeStore } from "../../store/useThemeStore";
import { parseErrorMessage } from "../../utils/error-utils";

function CommentRow({ entry }: { entry: McRealCommentWithRating }) {
  const usernames = useMcRealStore((s) => s.usernames);
  const resolveUsername = useMcRealStore((s) => s.resolveUsername);
  const [local, setLocal] = useState(entry);

  const author = local.comment.author;
  useEffect(() => {
    void resolveUsername(author);
  }, [author, resolveUsername]);

  const name = usernames[author] || `${author.slice(0, 8)}…`;
  const score = local.likes - local.dislikes;

  const rate = async (isPositive: boolean) => {
    const had = local.userRating;
    try {
      if (had && had.isPositive === isPositive) {
        await unrateMcRealComment(local.comment._id);
        setLocal({
          ...local,
          likes: local.likes - (had.isPositive ? 1 : 0),
          dislikes: local.dislikes - (had.isPositive ? 0 : 1),
          userRating: null,
        });
      } else {
        await rateMcRealComment(local.comment._id, isPositive);
        setLocal({
          ...local,
          likes: local.likes + (isPositive ? 1 : 0) - (had?.isPositive ? 1 : 0),
          dislikes:
            local.dislikes + (isPositive ? 0 : 1) - (had && !had.isPositive ? 1 : 0),
          userRating: { user: "", isPositive },
        });
      }
    } catch (e) {
      toast.error(parseErrorMessage(e));
    }
  };

  return (
    <div className="flex items-start gap-2 py-1.5">
      <img
        src={`https://mc-heads.net/avatar/${author}/16`}
        alt=""
        className="w-4 h-4 mt-0.5 rounded-sm"
        style={{ imageRendering: "pixelated" }}
      />
      <div className="flex-1 min-w-0">
        <span className="font-minecraft-ten text-[11px] text-white/60 mr-2">
          {name}
        </span>
        <span className="font-minecraft-ten text-xs text-white/90 break-words">
          {local.comment.text}
        </span>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <span
          className={`font-minecraft-ten text-[11px] ${score > 0 ? "text-green-400" : score < 0 ? "text-red-400" : "text-white/40"}`}
        >
          {score}
        </span>
        <button
          onClick={() => rate(true)}
          className={`bg-transparent border-none cursor-pointer p-0.5 ${local.userRating?.isPositive ? "text-green-400" : "text-white/40 hover:text-white"}`}
        >
          <Icon icon="solar:like-bold" className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => rate(false)}
          className={`bg-transparent border-none cursor-pointer p-0.5 ${local.userRating && !local.userRating.isPositive ? "text-red-400" : "text-white/40 hover:text-white"}`}
        >
          <Icon icon="solar:dislike-bold" className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function McRealComments({ postId }: { postId: string }) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const [comments, setComments] = useState<McRealCommentWithRating[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const load = async (nextPage: number) => {
    setLoading(true);
    try {
      const holder = await getMcRealComments(postId, nextPage);
      setComments((prev) =>
        nextPage === 0 ? holder.comments : [...prev, ...holder.comments],
      );
      setTotal(Number(holder.singleTotalComments));
      setPage(nextPage);
    } catch (e) {
      toast.error(parseErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const created = await addMcRealComment(postId, trimmed);
      setComments((prev) => [created, ...prev]);
      setTotal((prev) => prev + 1);
      setText("");
    } catch (e) {
      toast.error(parseErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-2 border-t border-white/10 pt-2">
      <div className="flex items-center gap-2">
        <input
          value={text}
          maxLength={150}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={t("mcreal.comments.placeholder")}
          className="flex-1 bg-white/5 border border-white/15 rounded-md px-2 py-1.5 font-minecraft-ten text-xs text-white placeholder:text-white/30 outline-none focus:border-white/40"
        />
        <button
          onClick={submit}
          disabled={sending || !text.trim()}
          className="border-none rounded-md px-2.5 py-1.5 cursor-pointer disabled:opacity-40"
          style={{ backgroundColor: `${accentColor.value}50` }}
        >
          <Icon icon="solar:plain-bold" className="w-4 h-4 text-white" />
        </button>
      </div>

      <div className="mt-1">
        {comments.map((c) => (
          <CommentRow key={c.comment._id} entry={c} />
        ))}
      </div>

      {comments.length < total && (
        <button
          onClick={() => load(page + 1)}
          disabled={loading}
          className="bg-transparent border-none cursor-pointer font-minecraft-ten text-[11px] text-white/50 hover:text-white p-0 mt-1"
        >
          {loading ? t("mcreal.comments.loading") : t("mcreal.comments.load_more")}
        </button>
      )}
    </div>
  );
}
