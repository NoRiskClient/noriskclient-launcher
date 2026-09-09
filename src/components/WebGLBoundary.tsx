"use client";

import { Component, type ReactNode } from "react";

import { getWebGLSupport } from "@noriskclient/nrc-skin-renderer";
import { logWarn } from "../utils/logging-utils";

interface Props {
  children: ReactNode;
  fallback: ReactNode;
  label?: string;
}

interface State {
  failed: boolean;
}

export class WebGLBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    logWarn(
      `[WebGL] ${this.props.label ?? "surface"} failed, using the 2D fallback: ${error.message}`,
    );
  }

  render(): ReactNode {
    if (this.state.failed || !getWebGLSupport().available) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
