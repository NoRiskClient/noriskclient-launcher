import { writable } from "svelte/store";
import { push } from "svelte-spa-router";
import { get } from "svelte/store";

export const customServers = writable([]);
export const activeCustomServerId = writable("");
export const customServerBaseDomain = writable("");

export async function addCustomServer(server) {
    const newServers = get(customServers);
    newServers.push(server);
    customServers.set(newServers);
}

export async function removeCustomServer(serverId) {
    const newServers = get(customServers);
    newServers.splice(newServers.findIndex(server => server.id === serverId), 1);
    customServers.set(newServers);
}

export async function clearCustomServers() {
    customServers.set([]);
}

export async function setActiveCustomServerId(serverId) {
    activeCustomServerId.set(serverId);
    if (serverId != "") {
        push("/servers/custom/details");
    }
}

export async function setCustomServerBaseDomain(baseDomain) {
    customServerBaseDomain.set(baseDomain);
}