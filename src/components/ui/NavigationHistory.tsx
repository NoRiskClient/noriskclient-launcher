"use client";

import { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";

interface NavigationHistoryProps {
  className?: string;
}

// Custom navigation icon button component
interface NavIconButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  "aria-label": string;
  className?: string;
}

function NavIconButton({
  icon,
  onClick,
  disabled = false,
  "aria-label": ariaLabel,
  className
}: NavIconButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "flex items-center justify-center h-8 w-8 rounded duration-150",
        "focus:outline-none focus:ring-0 active:bg-transparent",
        disabled
          ? "opacity-30 cursor-not-allowed"
          : "text-white/100 hover:text-white hover:bg-white/5 active:bg-transparent",
        className
      )}
    >
      {icon}
    </button>
  );
}

export function NavigationHistory({ className }: NavigationHistoryProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [history, setHistory] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const isNavigatingRef = useRef(false);

  // Helper function for navigation buttons
  const createNavButton = (
    icon: React.ReactNode,
    onClick: () => void,
    disabled: boolean,
    ariaLabel: string
  ) => (
    <NavIconButton
      icon={icon}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  );

  // Initialize history with current location
  useEffect(() => {
    if (history.length === 0) {
      const currentPath = location.pathname.replace('/', '') || 'play';
      setHistory([currentPath]);
      setCurrentIndex(0);
    }
  }, []); // Only run once on mount

  // Track navigation changes
  useEffect(() => {
    const currentPath = location.pathname.replace('/', '') || 'play';

    if (isNavigatingRef.current) {
      isNavigatingRef.current = false;
      return;
    }

    setHistory(prev => {
      if (prev[currentIndex] === currentPath) {
        return prev;
      }

      const newHistory = [...prev.slice(0, currentIndex + 1), currentPath];
      setCurrentIndex(newHistory.length - 1);
      return newHistory;
    });
  }, [location.pathname, currentIndex]);

  const canGoBack = currentIndex > 0;
  const canGoForward = currentIndex < history.length - 1;

  const handleGoBack = () => {
    if (canGoBack) {
      const newIndex = currentIndex - 1;
      const targetPath = history[newIndex];
      isNavigatingRef.current = true;
      setCurrentIndex(newIndex);
      navigate(`/${targetPath}`);
    }
  };

  const handleGoForward = () => {
    if (canGoForward) {
      const newIndex = currentIndex + 1;
      const targetPath = history[newIndex];
      isNavigatingRef.current = true;
      setCurrentIndex(newIndex);
      navigate(`/${targetPath}`);
    }
  };

  // Keyboard shortcut support: Alt+Arrow and Cmd+Arrow (macOS)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field or textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Handle Alt+Arrow or Meta+Arrow (Cmd key on macOS)
      if ((e.altKey || e.metaKey) && e.key === 'ArrowLeft') {
        e.preventDefault();
        handleGoBack();
      } else if ((e.altKey || e.metaKey) && e.key === 'ArrowRight') {
        e.preventDefault();
        handleGoForward();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [history, currentIndex]);

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {createNavButton(
        <Icon icon="solar:arrow-left-bold" className="w-4 h-4 text-current" />,
        handleGoBack,
        !canGoBack,
        "Go back"
      )}
      {createNavButton(
        <Icon icon="solar:arrow-right-bold" className="w-4 h-4 text-current" />,
        handleGoForward,
        !canGoForward,
        "Go forward"
      )}
    </div>
  );
}
