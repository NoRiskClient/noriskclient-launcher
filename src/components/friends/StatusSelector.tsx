import { useState, useRef } from "react";
import { Icon } from "@iconify/react";
import { OnlineState, useFriendsStore } from "../../store/friends-store";
import { useThemeStore } from "../../store/useThemeStore";
import { Dropdown } from "../ui/dropdown/Dropdown";
import { DropdownItem } from "../ui/dropdown/DropdownItem";
import { cn } from "../../lib/utils";

interface StatusSelectorProps {
  currentStatus: OnlineState;
}

const statuses: { value: OnlineState; label: string; color: string; glow: string }[] = [
  { value: "ONLINE", label: "Online", color: "#22c55e", glow: "0 0 8px rgba(34, 197, 94, 0.6)" },
  { value: "AFK", label: "Away", color: "#f97316", glow: "0 0 8px rgba(249, 115, 22, 0.6)" },
  { value: "BUSY", label: "Busy", color: "#ef4444", glow: "0 0 8px rgba(239, 68, 68, 0.6)" },
  { value: "INVISIBLE", label: "Invisible", color: "#6b7280", glow: "none" },
];

export function StatusSelector({ currentStatus }: StatusSelectorProps) {
  const { setStatus } = useFriendsStore();
  const { accentColor } = useThemeStore();
  const [isOpen, setIsOpen] = useState(false);
  const [isChanging, setIsChanging] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const current = statuses.find((s) => s.value === currentStatus) || statuses[0];

  const handleSelect = async (status: OnlineState) => {
    if (isChanging || status === currentStatus) {
      setIsOpen(false);
      return;
    }
    setIsChanging(true);
    try {
      await setStatus(status);
    } catch (e) {
      console.error("Failed to change status:", e);
    } finally {
      setIsChanging(false);
      setIsOpen(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200",
          isChanging && "opacity-50 cursor-not-allowed"
        )}
        style={{
          backgroundColor: `${accentColor.value}15`,
          border: `1px solid ${accentColor.value}40`,
        }}
        disabled={isChanging}
      >
        <div
          className="w-3.5 h-3.5 rounded-full"
          style={{
            backgroundColor: current.color,
            boxShadow: current.glow,
          }}
        />
        <span className="text-sm text-white font-minecraft-ten">{current.label}</span>
        <Icon
          icon="solar:alt-arrow-down-linear"
          className={cn(
            "w-4 h-4 ml-auto transition-transform duration-200",
            isOpen && "rotate-180"
          )}
          style={{ color: accentColor.value }}
        />
      </button>

      <Dropdown
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        triggerRef={triggerRef}
        width={200}
      >
        {statuses.map((status) => (
          <DropdownItem
            key={status.value}
            onClick={() => handleSelect(status.value)}
            isActive={status.value === currentStatus}
            icon={
              <div
                className="w-3 h-3 rounded-full"
                style={{
                  backgroundColor: status.color,
                  boxShadow: status.glow,
                }}
              />
            }
          >
            {status.label}
          </DropdownItem>
        ))}
      </Dropdown>
    </>
  );
}
