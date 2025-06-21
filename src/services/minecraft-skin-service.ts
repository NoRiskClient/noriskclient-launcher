import { invoke } from "@tauri-apps/api/core";
import type { 
    MinecraftProfile 
} from "../types/minecraft"; // Relative path
import type { 
    MinecraftSkin, 
    SkinVariant, 
    AddLocalSkinCommandPayload, 
    GetStarlightSkinRenderPayload, // Added new payload type
    SkinSourceDetails // Keep this for internal construction
} from "../types/localSkin"; // Relative path

// Regex for basic Minecraft username validation (could also be a global constant)
const MINECRAFT_USERNAME_REGEX = /^[a-zA-Z0-9_]{2,16}$/;
// Regex to check for UUID format (either 32 hex chars without hyphens, or 36 chars with hyphens in 8-4-4-4-12 format)
const UUID_REGEX = /^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

export class MinecraftSkinService {

    /**
     * Fetches the skin profile data for a given user from Mojang.
     * @param uuid - The user's Minecraft UUID.
     * @param accessToken - The user's valid access token.
     * @returns A promise resolving to the MinecraftProfile containing skin data.
     */
    static async getUserSkinData(uuid: string, accessToken: string): Promise<MinecraftProfile> {
        return await invoke<MinecraftProfile>("get_user_skin_data", { uuid, accessToken });
    }

    /**
     * Retrieves all skins stored locally in the application's database.
     * @returns A promise resolving to an array of MinecraftSkin objects.
     */
    static async getAllSkins(): Promise<MinecraftSkin[]> {
        return await invoke<MinecraftSkin[]>("get_all_skins");
    }

    /**
     * Initiates the process to upload a new skin file for the user.
     * NOTE: This likely triggers a file dialog on the Rust side.
     * @param uuid - The user's Minecraft UUID.
     * @param accessToken - The user's valid access token.
     * @param skinVariant - The model variant ('classic' or 'slim').
     * @returns A promise that resolves when the upload process is initiated or completed.
     */
    static async uploadSkin(uuid: string, accessToken: string, skinVariant: SkinVariant): Promise<void> {
        // Assuming "upload_skin" handles file selection internally via Tauri dialogs
        await invoke("upload_skin", { uuid, accessToken, skinVariant });
    }

    /**
     * Resets the user's skin back to the default (Steve/Alex).
     * @param uuid - The user's Minecraft UUID.
     * @param accessToken - The user's valid access token.
     * @returns A promise that resolves when the reset is complete.
     */
    static async resetSkin(uuid: string, accessToken: string): Promise<void> {
        await invoke("reset_skin", { uuid, accessToken });
    }

    /**
     * Applies a locally stored skin (using its base64 data) to the user's profile.
     * @param uuid - The user's Minecraft UUID.
     * @param accessToken - The user's valid access token.
     * @param base64Data - The base64 encoded PNG data of the skin.
     * @param skinVariant - The model variant ('classic' or 'slim').
     * @returns A promise that resolves when the skin is applied.
     */
    static async applySkinFromBase64(uuid: string, accessToken: string, base64Data: string, skinVariant: SkinVariant): Promise<void> {
        await invoke("apply_skin_from_base64", { uuid, accessToken, base64Data, skinVariant });
    }

    /**
     * Updates the properties (name, variant) of a locally stored skin.
     * @param id - The database ID of the skin to update.
     * @param name - The new name for the skin.
     * @param variant - The new variant ('classic' or 'slim') for the skin.
     * @returns A promise resolving to the updated MinecraftSkin object or null if not found.
     */
    static async updateSkinProperties(id: string, name: string, variant: SkinVariant): Promise<MinecraftSkin | null> {
        return await invoke<MinecraftSkin | null>("update_skin_properties", { id, name, variant });
    }

    /**
     * Adds a skin to the local database from various sources.
     * Determines the source type (Profile or URL) based on the skinInput.
     * @param skinInput - The username, UUID, or URL for the skin source.
     * @param targetName - The name to save the skin as.
     * @param targetVariant - The skin model variant ('classic' or 'slim').
     * @param description - Optional description for the skin.
     * @returns A promise resolving to the newly added MinecraftSkin object.
     */
    static async addSkinLocally(
        skinInput: string, 
        targetName: string, 
        targetVariant: SkinVariant, 
        description?: string | null
    ): Promise<MinecraftSkin> {
        let sourceDetails: SkinSourceDetails;

        if (MINECRAFT_USERNAME_REGEX.test(skinInput)) {
            sourceDetails = { type: "Profile", details: { query: skinInput } };
        } else if (UUID_REGEX.test(skinInput)) {
            sourceDetails = { type: "Profile", details: { query: skinInput } };
        } else {
            let isHttpUrl = false;
            let isFileProtocolUrl = false;
            let pathFromUrlIfFileProtocol = "";
    
            try {
                const parsedUrl = new URL(skinInput); 
                if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:" ) {
                    isHttpUrl = true;
                } else if (parsedUrl.protocol === "file:") {
                    isFileProtocolUrl = true;
                    let rawPath = decodeURIComponent(parsedUrl.pathname);
                    // Normalize path: remove leading slash on Windows if it looks like /C:/path
                    // This pattern /X:/ is typical for Windows paths coming from file URLs.
                    if (rawPath.length > 2 && rawPath.startsWith('/') && rawPath[2] === ':') {
                        rawPath = rawPath.substring(1);
                    }
                    pathFromUrlIfFileProtocol = rawPath;
                }
            } catch (e) {
                // Not a parsable URL (e.g. "/path/to/file.png" or "C:\path\to\file.png")
                // It will be treated as a FilePath by default in the logic below.
            }
    
            if (isHttpUrl) {
                sourceDetails = { type: "Url", details: { url: skinInput } };
            } else if (isFileProtocolUrl) {
                sourceDetails = { type: "FilePath", details: { path: pathFromUrlIfFileProtocol } };
            } else {
                // Not a username, UUID, or a parsable http/https/file URL.
                // Assume it's a direct file path like "/path/file.png" or "C:\path\file.png".
                sourceDetails = { type: "FilePath", details: { path: skinInput } };
            }
        }

        const payload: AddLocalSkinCommandPayload = {
            source: sourceDetails,
            target_skin_name: targetName,
            target_skin_variant: targetVariant,
            description: description ?? null
        };

        return await invoke<MinecraftSkin>("add_skin_locally", { payload });
    }

    /**
     * Removes a locally stored skin from the database.
     * @param skinId - The ID of the skin to remove.
     * @returns A promise resolving to true if the skin was successfully removed, false otherwise.
     */
    static async removeSkin(skinId: string): Promise<boolean> {
        return await invoke<boolean>("remove_skin", { id: skinId });
    }

    /**
     * Fetches a cached skin render from the Starlight API via the backend.
     * The backend handles caching and potential background updates.
     * @param payload - The parameters for the skin render.
     * @returns A promise resolving to the local file path (string) of the cached rendered skin image.
     */
    static async getStarlightSkinRender(payload: GetStarlightSkinRenderPayload): Promise<string> {
        // The Rust command returns a PathBuf, which will be serialized as a string (the path).
        return await invoke<string>("get_starlight_skin_render", { payload });
    }
} 