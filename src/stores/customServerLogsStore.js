import { writable } from "svelte/store";
import { listen } from "@tauri-apps/api/event";
import { get } from "svelte/store";

export const customServerLogs = writable({});
export const stillRunningCustomServer = writable(null);

export async function addCustomServerLog(serverId, log) {
    if (log.includes("RCON Client") && log.includes("127.0.0.1")) { return; }

    const logs = get(customServerLogs);
    if (logs[serverId] == undefined) {
        logs[serverId] = [log];
        customServerLogs.set(logs);
    } else {
        logs[serverId].push(log);
        customServerLogs.set(logs);
    }
}

export async function clearCustomServerLogs(serverId) {
    const logs = get(customServerLogs);
    delete logs[serverId];
    customServerLogs.set(logs);

}

listen("custom-server-process-output", event => {
    console.debug("Received process-output event", event.payload);
    addCustomServerLog(event.payload.server_id, event.payload.data);
});

export function setStillRunningCustomServer(serverId) {
    stillRunningCustomServer.set(serverId);
}

export function clearStillRunningCustomServer() {
    stillRunningCustomServer.set(null);
}