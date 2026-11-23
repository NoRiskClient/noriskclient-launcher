"use client";

import type { ComponentProps } from "react";
import { Button } from "./Button";
import { useClickGuard } from "../../../hooks/useClickGuard";

export function GuardedButton({ disabled, ...props }: ComponentProps<typeof Button>) {
  const armed = useClickGuard();
  return <Button {...props} disabled={disabled || !armed} />;
}
