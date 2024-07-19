import { writable } from "svelte/store";

export const customServerLogs = writable({});

export async function addCustomServerLog(serverId, log) {
    customServerLogs.set({ ...customServerLogs, [serverId]: [...customServerLogs[serverId], log] });
}

export async function clearCustomServerLogs(serverId) {
    customServerLogs.set({ ...customServerLogs, [serverId]: [] });
}
