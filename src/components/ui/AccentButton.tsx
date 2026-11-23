import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import { Button } from "./buttons/Button";
import { cn } from "../../lib/utils";

interface AccentButtonProps {
  disabled?: boolean;
  icon?: string;
  title?: string;
  className?: string;
  onClick: () => void;
  children?: ReactNode;
}

export function AccentButton({ disabled, icon, title, className, onClick, children }: AccentButtonProps) {
  return (
    <Button
      variant="flat"
      size="sm"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn("w-full", className)}
      icon={icon ? <Icon icon={icon} className="w-4 h-4" /> : undefined}
    >
      {children}
    </Button>
  );
}
