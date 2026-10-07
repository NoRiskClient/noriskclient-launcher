import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import type { BugVote, PendingKind, ReviewVote } from "../../types/tester";

interface VoteControlsProps {
  kind: PendingKind;
  busy: boolean;
  onSubmit: (vote: BugVote | ReviewVote, description?: string) => Promise<boolean>;
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
      className={`flex items-center gap-2 px-2 py-0.5 text-base rounded-lg border font-smallcaps transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 ${toneClasses[tone]}`}
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
  const [submitting, setSubmitting] = useState(false);
  const submitRef = useRef(false);
  const mountedRef = useRef(true);
  const attemptRef = useRef(0);
  const isBusy = busy || submitting;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      attemptRef.current++;
      submitRef.current = false;
    };
  }, []);

  const reset = () => {
    if (busy || submitRef.current) return;
    setPending(null);
    setDescription("");
  };

  const handleSubmit = async () => {
    if (!pending || busy || submitRef.current || !mountedRef.current) return;
    const trimmed = description.trim();
    if (pending.option.descriptionRequired && !trimmed) return;
    const attempt = ++attemptRef.current;
    submitRef.current = true;
    setSubmitting(true);
    try {
      const accepted = await onSubmit(pending.option.value, trimmed || undefined);
      if (accepted && mountedRef.current && attempt === attemptRef.current) {
        setPending(null);
        setDescription("");
      }
    } catch (error) {
      // The parent owns error feedback; an unexpected reject must not erase the draft.
      console.error("[VoteControls] vote submission rejected:", error);
    } finally {
      if (attempt === attemptRef.current) {
        submitRef.current = false;
        if (mountedRef.current) setSubmitting(false);
      }
    }
  };

  if (pending) {
    const required = !!pending.option.descriptionRequired;
    return (
      <div className="flex flex-col gap-2 w-full" aria-busy={isBusy}>
        <textarea
          value={description}
          readOnly={isBusy}
          onChange={(e) => {
            if (!busy && !submitRef.current) setDescription(e.target.value);
          }}
          aria-label={required ? "What broke? Where? Steps to reproduce?" : "Optional note"}
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
            busy={isBusy || (required && !description.trim())}
            onClick={handleSubmit}
          />
          <ChoiceButton
            icon="solar:close-circle-bold"
            label="cancel"
            tone="neutral"
            busy={isBusy}
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
          busy={isBusy}
          onClick={() => {
            if (!busy && !submitRef.current) setPending({ option: opt });
          }}
        />
      ))}
    </div>
  );
}
