import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useFriendsStore } from "../../../store/friends-store";
import { translateApiError } from "../../../utils/nrc-error-translations";

interface AddFriendFormProps {
  autoFocus?: boolean;
}

export function AddFriendForm({ autoFocus = false }: AddFriendFormProps) {
  const { t } = useTranslation();
  const sendRequest = useFriendsStore((s) => s.sendRequest);
  const loadPendingRequests = useFriendsStore((s) => s.loadPendingRequests);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!sentTo) return;
    const id = window.setTimeout(() => setSentTo(null), 4000);
    return () => window.clearTimeout(id);
  }, [sentTo]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const target = name.trim();
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    setSentTo(null);
    try {
      await sendRequest(target);
      setSentTo(target);
      setName("");
      void loadPendingRequests();
    } catch (err) {
      setError(translateApiError(err, t("friends.send_request_failed")));
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-1.5">
        <label className="fw-field min-w-0 flex-1" data-invalid={!!error}>
          <Icon icon="solar:user-linear" className="fw-faint h-3.5 w-3.5 shrink-0" />
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder={t("friends.enter_username")}
            maxLength={16}
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
          />
        </label>
        <button type="submit" className="fw-btn fw-btn-primary" disabled={busy || !name.trim()}>
          {busy ? <Icon icon="svg-spinners:ring-resize" className="h-4 w-4" /> : t("friends.send_request")}
        </button>
      </div>
      {error && (
        <p className="fw-meta flex items-start gap-1.5" style={{ color: "var(--fw-danger)" }}>
          <Icon icon="solar:danger-circle-bold" className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </p>
      )}
      {sentTo && (
        <p className="fw-meta flex items-center gap-1.5" style={{ color: "var(--fw-success)" }}>
          <Icon icon="solar:check-circle-bold" className="h-3.5 w-3.5 shrink-0" />
          {t("friends.request_sent_to", { name: sentTo })}
        </p>
      )}
    </form>
  );
}
