import { writable } from "svelte/store";
import { listen } from "@tauri-apps/api/event";

export const customServerLogs = writable({});

export async function addCustomServerLog(serverId, log) {
    if (customServerLogs[serverId] == undefined) {
        customServerLogs.set({ ...customServerLogs, [serverId]: [] });
    } else {
        // customServerLogs.update({ ...customServerLogs, [serverId]: [...customServerLogs[serverId], log] });
    }
}

export async function clearCustomServerLogs(serverId) {
    customServerLogs.set({ ...customServerLogs, [serverId]: [] });
}

listen("custom-server-process-output", event => {
    console.log("Received process-output event", event.payload);
    addCustomServerLog(event.payload.server_id, event.payload.data);
});
