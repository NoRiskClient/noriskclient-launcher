import { cn } from "../../lib/utils";
import { useTranslation } from "react-i18next";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  onClick?: () => void;
}

export function Logo({ size = "md", className, onClick }: LogoProps) {
  const { t } = useTranslation();
  const sizeClasses = {
    sm: "w-10 h-10",
    md: "w-16 h-16",
    lg: "w-24 h-24",
  };

  const classes = cn("relative", sizeClasses[size], className,
    onClick && "cursor-pointer hover:scale-105 transition-transform duration-200");
  const image = <img src="/logo.png" alt={onClick ? "" : "NoRisk Logo"} className="w-full h-full object-contain" />;

  return onClick ? (
    <button type="button" aria-label={t("credits_modal.title")} onClick={onClick}
      className={cn(classes, "block border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80")}>
      {image}
    </button>
  ) : <div className={classes}>{image}</div>;
}
