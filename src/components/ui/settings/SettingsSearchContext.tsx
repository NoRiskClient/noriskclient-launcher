"use client";

import { createContext, useContext } from "react";

export const SettingsSearchContext = createContext<string>("");

export function useSettingsSearch() {
  return useContext(SettingsSearchContext);
}

export function fuzzyMatch(haystack: string, query: string): boolean {
  if (!query) return true;
  return haystack.toLowerCase().includes(query.toLowerCase());
}
