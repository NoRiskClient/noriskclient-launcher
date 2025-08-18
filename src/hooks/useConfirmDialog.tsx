"use client";

import type React from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/buttons/Button";
import { Input } from "../components/ui/Input";
import { Label } from "../components/ui/Label";
import { StatusMessage } from "../components/ui/StatusMessage";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  inputLabel?: string;
  inputPlaceholder?: string;
  inputInitialValue?: string;
  inputRequired?: boolean;
  type?: "confirm" | "input" | "warning" | "danger";
  fullscreen?: boolean;
}

export function useConfirmDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions>({
    title: "Confirm",
    fullscreen: true,
  });
  const [inputValue, setInputValue] = useState("");
  const [isValid, setIsValid] = useState(true);
  const [resolveRef, setResolveRef] = useState<(value: any) => void>(() => {});

  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  const confirm = (options: ConfirmOptions): Promise<string | boolean> => {
    return new Promise((resolve) => {
      setOptions({ ...options, fullscreen: options.fullscreen ?? true });
      setInputValue(options.inputInitialValue || "");
      setIsValid(!options.inputRequired || !!options.inputInitialValue);
      setResolveRef(() => resolve);
      setIsOpen(true);
    });
  };

  const handleClose = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }

    setIsOpen(false);
    resolveRef(false);
  };

  const handleConfirm = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }

    setIsOpen(false);
    if (options.type === "input") {
      resolveRef(inputValue);
    } else {
      resolveRef(true);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setIsValid(!options.inputRequired || !!value.trim());
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Enter" && isValid) {
        e.preventDefault();
        handleConfirm();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isValid]);

  const renderFooter = () => (
    <div className="flex justify-end gap-3">
      <Button
        variant="secondary"
        onClick={handleClose}
        size="md"
        className="text-2xl"
      >
        {options.cancelText || "Cancel"}
      </Button>
      <Button
        variant={options.type === "danger" ? "destructive" : "default"}
        onClick={handleConfirm}
        disabled={options.type === "input" && !isValid}
        size="md"
        className="text-2xl"
      >
        {options.confirmText || "Confirm"}
      </Button>
    </div>
  );

  const getStatusMessageType = () => {
    switch (options.type) {
      case "warning":
        return "warning";
      case "danger":
        return "error";
      default:
        return "info";
    }
  };

  const renderContent = () => (
    <div className="p-6 space-y-6" onClick={(e) => e.stopPropagation()}>
      {options.message && (
        <StatusMessage
          type={getStatusMessageType()}
          message={options.message}
        />
      )}

      {options.type === "input" && (
        <div className="space-y-4">
          {options.inputLabel && (
            <p className="text-lg font-minecraft-ten">{options.inputLabel}</p>
          )}
          <Input
            value={inputValue}
            onChange={handleInputChange}
            placeholder={options.inputPlaceholder}
            className="text-2xl py-3"
            error={!isValid ? "This field is required" : undefined}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
  const confirmDialog =
    isMounted && isOpen
      ? createPortal(
          <Modal
            title={options.title}
            onClose={handleClose}
            width="md"
            footer={renderFooter()}
          >
            {renderContent()}
          </Modal>,
          document.body,
        )
      : null;

  return {
    confirm,
    confirmDialog,
  };
}
