import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  accentColor: string;
}

export function ChatInput({ onSend, disabled, accentColor }: ChatInputProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed || disabled) return;

    onSend(trimmed);
    setMessage("");
    inputRef.current?.focus();
  };

  return (
    <div className="p-3" style={{ borderTop: `1px solid ${accentColor}30` }}>
      <div
        className="flex items-end gap-2 p-2 rounded-xl"
        style={{
          backgroundColor: `${accentColor}10`,
          border: `1px solid ${accentColor}30`,
        }}
      >
        <textarea
          ref={inputRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.type_message')}
          rows={1}
          disabled={disabled}
          className={cn(
            "flex-1 resize-none px-2 py-1.5 rounded-lg text-sm font-minecraft-ten",
            "bg-transparent text-white placeholder-white/40",
            "focus:outline-none transition-all duration-200",
            "max-h-32 overflow-y-auto custom-scrollbar",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          style={{ minHeight: "32px" }}
        />

        <button
          onClick={handleSend}
          disabled={disabled || !message.trim()}
          className="p-2 rounded-lg transition-all duration-200"
          style={{
            backgroundColor: message.trim() ? `${accentColor}30` : "transparent",
            color: message.trim() ? accentColor : "rgba(255,255,255,0.3)",
          }}
        >
          <Icon icon="solar:plain-bold" className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
