import { createContext, useContext } from "react";

/** A row's visible name/details are shared by its real native controls, even through portals. */
export const SettingControlContext = createContext<{ labelId?: string; descriptionId?: string }>({});
export const useSettingControl = () => useContext(SettingControlContext);
