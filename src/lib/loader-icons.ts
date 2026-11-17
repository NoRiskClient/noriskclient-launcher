export const LOADER_ICONS: Record<string, string> = {
  fabric: "/icons/fabric.png",
  forge: "/icons/forge.png",
  quilt: "/icons/quilt.png",
  neoforge: "/icons/neoforge.png",
};

export const VANILLA_ICON = "/icons/minecraft.png";

export function loaderIconSrc(loader: string | null | undefined): string {
  return LOADER_ICONS[(loader ?? "").toLowerCase()] ?? VANILLA_ICON;
}

export function loaderLabel(loader: string | null | undefined): string {
  const key = (loader ?? "").toLowerCase();
  switch (key) {
    case "fabric":
      return "Fabric";
    case "forge":
      return "Forge";
    case "quilt":
      return "Quilt";
    case "neoforge":
      return "NeoForge";
    default:
      return "Vanilla";
  }
}
