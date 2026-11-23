import type { ComponentType } from "react";
import type { TFunction } from "i18next";
import type { Profile } from "../../../types/profile";
import type { PreparedItem } from "../../../types/support-request";

export interface SupportPreviewContext {
  profile: Profile | null;
}

export interface SupportPreviewProps {
  item: PreparedItem;
  ctx: SupportPreviewContext;
}

export interface SupportPreviewTemplate {
  Preview?: ComponentType<SupportPreviewProps>;
  summarize?: (item: PreparedItem, t: TFunction, ctx: SupportPreviewContext) => string | null;
}
