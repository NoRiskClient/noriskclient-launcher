import { Icon } from "@iconify/react";
import type { HTMLAttributes } from "react";

interface ErrorMessageProps extends HTMLAttributes<HTMLDivElement> {
  message: string;
  className?: string;
}

export function ErrorMessage({ message, className = "", ...props }: ErrorMessageProps) {
  return (
    <div
      role="alert"
      className={`bg-red-900/50 border border-red-700/50 text-white font-smallcaps text-xs p-3 [overflow-wrap:anywhere] ${className}`}
      {...props}
    >
      <Icon aria-hidden="true" icon="pixel:exclamation-triangle-solid" className="inline-block mr-2 w-4 h-4" />
      {message}
    </div>
  );
}
