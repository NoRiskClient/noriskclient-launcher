interface LoadingIndicatorProps {
  message?: string;
  className?: string;
}

export function LoadingIndicator({
  message,
  className = "",
}: LoadingIndicatorProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center p-6 select-none ${className}`}
    >
      <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin mb-4"></div>
      {message && (        <p className="text-white/70 text-xl font-minecraft tracking-wide lowercase">
          {message}
        </p>
      )}
    </div>
  );
}
