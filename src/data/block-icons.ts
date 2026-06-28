// Curated list of Minecraft block textures used as ready-made profile icons.
// Textures are served straight from the InventivetalentDev/minecraft-assets repo
// (raw.githubusercontent.com is already allowed in the CSP img-src list).

/** Ref (tag/branch) of the minecraft-assets repo to pull block textures from. */
export const MC_ASSETS_REF = "26.1.2";

/** Builds the raw texture URL for a block id (e.g. "diamond_block"). */
export function blockTextureUrl(id: string): string {
  return `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/${MC_ASSETS_REF}/assets/minecraft/textures/block/${id}.png`;
}

export interface BlockIcon {
  /** Texture file name without extension. */
  id: string;
  /** Human-readable label for tooltips. */
  name: string;
  /** Full raw.githubusercontent.com URL of the 16x16 texture. */
  url: string;
}

// Texture file names (curated for blocks that read well as a single flat tile).
const BLOCK_IDS: string[] = [
  "diamond_block", "gold_block", "iron_block", "emerald_block", "netherite_block",
  "redstone_block", "lapis_block", "coal_block", "copper_block", "amethyst_block",
  "raw_iron_block", "raw_gold_block", "raw_copper_block",
  "diamond_ore", "emerald_ore", "gold_ore", "iron_ore",
  "bricks", "bookshelf", "crafting_table_top", "tnt_side", "obsidian",
  "crying_obsidian", "glowstone", "sea_lantern", "shroomlight", "slime_block",
  "honeycomb_block", "sculk", "netherrack", "end_stone",
  "oak_planks", "spruce_planks", "dark_oak_planks", "cherry_planks", "oak_log",
  "cobblestone", "mossy_cobblestone", "stone", "dirt", "sand", "gravel", "bedrock",
  "melon_side", "pumpkin_side", "hay_block_side", "sponge", "note_block",
  "nether_bricks", "quartz_block_side", "prismarine", "dark_prismarine", "magma",
  "gilded_blackstone", "blue_ice", "packed_ice", "moss_block", "dripstone_block",
  "calcite", "tuff", "deepslate", "redstone_lamp",
  // Froglights & copper family
  "ochre_froglight_side", "verdant_froglight_side", "pearlescent_froglight_side",
  "oxidized_copper", "weathered_copper", "exposed_copper", "cut_copper",
  "chiseled_copper", "copper_bulb",
  // Nether woods & growth
  "warped_planks", "crimson_planks", "warped_wart_block", "nether_wart_block",
  "warped_nylium", "crimson_nylium",
  // Blackstone & chiseled variants
  "blackstone", "polished_blackstone_bricks", "chiseled_polished_blackstone",
  "chiseled_quartz_block", "chiseled_stone_bricks", "chiseled_deepslate",
  "chiseled_nether_bricks", "chiseled_tuff", "tuff_bricks",
  // Glazed terracotta
  "lime_glazed_terracotta", "magenta_glazed_terracotta",
  "light_blue_glazed_terracotta", "orange_glazed_terracotta",
  // Decorative & misc
  "purpur_block", "end_stone_bricks", "jack_o_lantern", "carved_pumpkin",
  "mud_bricks", "terracotta", "bone_block_side", "target_side", "resin_bricks",
  "smooth_basalt", "bamboo_planks", "mangrove_planks", "pale_oak_planks",
  "budding_amethyst",
];

/** Turns a texture id into a readable label ("tnt_side" -> "TNT"). */
function prettyName(id: string): string {
  return id
    .replace(/_(side|top|front|bottom)$/, "")
    .split("_")
    .map((w) => (w === "tnt" ? "TNT" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export const BLOCK_ICONS: BlockIcon[] = BLOCK_IDS.map((id) => ({
  id,
  name: prettyName(id),
  url: blockTextureUrl(id),
}));

/** Returns a random block icon — used as the default icon for new profiles. */
export function getRandomBlockIcon(): BlockIcon {
  return BLOCK_ICONS[Math.floor(Math.random() * BLOCK_ICONS.length)];
}
