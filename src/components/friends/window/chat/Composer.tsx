import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

const COMPOSER_MAX_PX = 140;

/** Enter sends, Shift+Enter adds a line. */
export function Composer({
  friendName,
  disabled,
  onSend,
}: {
  friendName: string;
  disabled: boolean;
  onSend: (content: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_PX)}px`;
  }, [value]);

  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled, friendName]);

  const submit = async () => {
    const content = value.trim();
    if (!content || disabled || sending) return;
    setSending(true);
    setValue("");
    const ok = await onSend(content);
    if (!ok) setValue(content);
    setSending(false);
    requestAnimationFrame(() => ref.current?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const canSend = !!value.trim() && !disabled && !sending;

  return (
    <div className="shrink-0 px-5 pb-2">
      <div className="fw-field fw-composer h-auto items-end py-2 pr-2">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("chat.message_placeholder", { name: friendName })}
          disabled={disabled}
          className="fw-scroll resize-none py-1"
          style={{ maxHeight: COMPOSER_MAX_PX }}
        />
        <button
          type="button"
          className="fw-icon-btn h-7 w-7"
          data-active={canSend}
          onClick={submit}
          disabled={!canSend}
          title={t("chat.send")}
          aria-label={t("chat.send")}
        >
          {sending ? (
            <Icon icon="svg-spinners:ring-resize" className="h-4 w-4" />
          ) : (
            <Icon icon="solar:plain-bold" className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
