const platform = import.meta.env.TAURI_ENV_PLATFORM;
export const isMobile = platform === "android" || platform === "ios";
