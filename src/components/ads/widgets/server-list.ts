import type { ServerInfo } from "../../../types/minecraft";

const VANILLA_DEFAULT_NAME = "Minecraft Server";
const MASKED_ADDRESS = "***.***.***.***";
const HIDDEN_HOST = /(^|\.)norisk\.(space|host)(:\d+)?$/i;
const IP_ADDRESS = /^(\d{1,3}(\.\d{1,3}){3}|\[?[0-9a-f]*:[0-9a-f:]*\]?)(:\d+)?$/i;

export type QuickJoinServer = ServerInfo & { address: string };

export function quickJoinServers(servers: ServerInfo[], limit = Infinity): QuickJoinServer[] {
  return servers
    .filter((server): server is QuickJoinServer => !!server.address && !HIDDEN_HOST.test(server.address))
    .slice(0, limit);
}

export function displayAddress(address: string): string {
  return IP_ADDRESS.test(address) ? MASKED_ADDRESS : address;
}

export function serverDisplayName(server: Pick<ServerInfo, "name" | "address">): string {
  const plain = server.name?.replace(/§./g, "").trim();
  if (plain && plain !== VANILLA_DEFAULT_NAME) return server.name!;
  return displayAddress(server.address ?? "");
}
