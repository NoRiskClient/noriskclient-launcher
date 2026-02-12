import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useFriendsStore } from "../../store/friends-store";
import { useThemeStore } from "../../store/useThemeStore";
import { cn } from "../../lib/utils";

export function AddFriendInput() {
  const { t } = useTranslation();
  const { sendRequest } = useFriendsStore();
  const { accentColor } = useThemeStore();
  const [username, setUsername] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);
    setSuccess(false);

    try {
      await sendRequest(username.trim());
      setSuccess(true);
      setUsername("");
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: any) {
      setError(e?.message || t('friends.send_request_failed'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div
        className="relative flex items-center gap-2 rounded-xl transition-all duration-200"
        style={{
          backgroundColor: `${accentColor.value}15`,
          border: `1px solid ${error ? "rgba(239, 68, 68, 0.5)" : isFocused ? accentColor.value : `${accentColor.value}40`}`,
        }}
      >
        <Icon
          icon="solar:user-plus-bold"
          className="w-5 h-5 ml-4 flex-shrink-0"
          style={{ color: `${accentColor.value}80` }}
        />
        <input
          type="text"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setError(null);
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={t('friends.enter_username')}
          className={cn(
            "flex-1 bg-transparent py-3 pr-3 text-white font-minecraft-ten",
            "placeholder:text-white/30 focus:outline-none"
          )}
          style={{ fontSize: "14px" }}
          disabled={isLoading}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={isLoading || !username.trim()}
          className={cn(
            "flex items-center justify-center w-10 h-10 mr-1 rounded-lg transition-all duration-200",
            !username.trim() && "opacity-40 cursor-not-allowed"
          )}
          style={{
            backgroundColor: username.trim() ? `${accentColor.value}30` : "transparent",
            color: username.trim() ? accentColor.value : "rgba(255,255,255,0.3)",
          }}
        >
          {isLoading ? (
            <Icon icon="solar:refresh-bold" className="w-5 h-5 animate-spin" />
          ) : (
            <Icon icon="solar:arrow-right-bold" className="w-5 h-5" />
          )}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg font-minecraft-ten text-xs text-red-400 bg-red-500/10 border border-red-500/20">
          <Icon icon="solar:danger-circle-bold" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span className="break-words min-w-0">{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg font-minecraft-ten text-xs text-green-400 bg-green-500/10 border border-green-500/20">
          <Icon icon="solar:check-circle-bold" className="w-4 h-4 flex-shrink-0" />
          {t('friends.request_sent')}
        </div>
      )}
    </form>
  );
}
