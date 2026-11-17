export interface FontPreset {
  id: string;
  name: string;
  smallcaps: string;
  minecraft: string;
  preview: string;
}

export const FONT_PRESETS: Record<string, FontPreset> = {
  minecraft: {
    id: "minecraft",
    name: "Minecraft",
    smallcaps: '"SmallCaps", monospace',
    minecraft: '"MinecraftTen", sans-serif',
    preview: '"MinecraftTen", "SmallCaps", sans-serif',
  },
  system: {
    id: "system",
    name: "System",
    smallcaps: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    minecraft: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    preview: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  mono: {
    id: "mono",
    name: "Mono",
    smallcaps: 'ui-monospace, "Cascadia Code", "Consolas", monospace',
    minecraft: 'ui-monospace, "Cascadia Code", "Consolas", monospace',
    preview: 'ui-monospace, "Cascadia Code", "Consolas", monospace',
  },
};

export const DEFAULT_FONT_ID = "minecraft";
