import { Icon } from "@iconify/react";

interface ErrorMessageProps {
  message: string;
  className?: string;
}

export function ErrorMessage({ message, className = "" }: ErrorMessageProps) {
  return (
    <div
      className={`bg-red-900/50 border border-red-700/50 text-white font-minecraft text-sm p-3 ${className}`}
    >
      <Icon icon="pixel:exclamation-triangle-solid" className="inline-block mr-2 w-4 h-4" />
      {message}
    </div>
  );
}
