import { useState } from "react";
import { Icon } from "@iconify/react";
import type { BugVote, PendingKind, ReviewVote } from "../../types/tester";

interface VoteControlsProps {
  kind: PendingKind;
  busy: boolean;
  onSubmit: (vote: BugVote | ReviewVote, description?: string) => void;
}

type Tone = "success" | "warning" | "destructive" | "neutral";

const toneClasses: Record<Tone, string> = {
  success:
    "bg-emerald-600/20 hover:bg-emerald-600/30 text-white border-emerald-500/30 hover:border-emerald-500/50",
  warning:
    "bg-amber-600/20 hover:bg-amber-600/30 text-white border-amber-500/30 hover:border-amber-500/50",
  destructive:
    "bg-red-600/20 hover:bg-red-600/30 text-white border-red-500/30 hover:border-red-500/50",
  neutral:
    "bg-black/30 hover:bg-black/40 text-white/70 hover:text-white border-white/10 hover:border-white/20",
};

interface ChoiceButtonProps {
  icon: string;
  label: string;
  tone: Tone;
  busy: boolean;
  onClick: () => void;
}

function ChoiceButton({ icon, label, tone, busy, onClick }: ChoiceButtonProps) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={`flex items-center gap-2 px-2 py-0.5 text-2xl rounded-lg border font-minecraft lowercase transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 ${toneClasses[tone]}`}
    >
      <Icon icon={icon} className="w-4 h-4 flex-shrink-0" />
      <span style={{ transform: "translateY(-0.075em)" }}>{label}</span>
    </button>
  );
}

interface VoteOption {
  value: BugVote | ReviewVote;
  label: string;
  icon: string;
  tone: Tone;
  descriptionRequired?: boolean;
}

const optionsByKind: Record<PendingKind, VoteOption[]> = {
  review: [
    { value: "works_perfectly", label: "works", icon: "solar:check-circle-bold", tone: "success" },
    { value: "needs_changes", label: "polish", icon: "solar:settings-bold", tone: "warning", descriptionRequired: true },
    { value: "does_not_work", label: "broken", icon: "solar:close-circle-bold", tone: "destructive", descriptionRequired: true },
  ],
  bug: [
    { value: "valid", label: "reproducible", icon: "solar:check-circle-bold", tone: "success" },
    { value: "invalid", label: "cannot reproduce", icon: "solar:close-circle-bold", tone: "destructive" },
  ],
};

interface PendingState {
  option: VoteOption;
}

export function VoteControls({ kind, busy, onSubmit }: VoteControlsProps) {
  const [pending, setPending] = useState<PendingState | null>(null);
  const [description, setDescription] = useState("");

  const reset = () => {
    setPending(null);
    setDescription("");
  };

  const handleSubmit = () => {
    if (!pending) return;
    const trimmed = description.trim();
    if (pending.option.descriptionRequired && !trimmed) return;
    onSubmit(pending.option.value, trimmed || undefined);
    reset();
  };

  if (pending) {
    const required = !!pending.option.descriptionRequired;
    return (
      <div className="flex flex-col gap-2 w-full">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full bg-black/30 border border-white/10 hover:border-white/20 focus:border-white/40 rounded-md px-3 py-2 text-sm text-white/90 font-sans focus:outline-none resize-none transition-colors"
          placeholder={required ? "What broke? Where? Steps to reproduce?" : "Optional note"}
          autoFocus
        />
        <div className="flex items-center gap-2">
          <ChoiceButton
            icon="solar:upload-bold"
            label={`submit · ${pending.option.label}`}
            tone={pending.option.tone}
            busy={busy || (required && !description.trim())}
            onClick={handleSubmit}
          />
          <ChoiceButton
            icon="solar:close-circle-bold"
            label="cancel"
            tone="neutral"
            busy={busy}
            onClick={reset}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {optionsByKind[kind].map((opt) => (
        <ChoiceButton
          key={opt.value}
          icon={opt.icon}
          label={opt.label}
          tone={opt.tone}
          busy={busy}
          onClick={() => setPending({ option: opt })}
        />
      ))}
    </div>
  );
}
