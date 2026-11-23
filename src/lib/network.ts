const NETWORK_ERROR =
  /error sending request|dns error|failed to lookup address|tcp connect error|connection (refused|reset|closed)|network is unreachable|timed out|failed to fetch/i;

export function isNetworkError(message: unknown): boolean {
  return typeof message === "string" && NETWORK_ERROR.test(message);
}
