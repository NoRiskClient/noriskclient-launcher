import { createContext, useContext } from "react";

export type PopupRole = "menu" | "listbox";
export const PopupScope = createContext<PopupRole>("menu");
export const usePopupRole = () => useContext(PopupScope);
