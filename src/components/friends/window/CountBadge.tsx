/** Red count pill, capped at `max`. */
export function CountBadge({ count, max = 99, corner = false }: { count: number; max?: number; corner?: boolean }) {
  if (count <= 0) return null;
  return <span className={corner ? "fw-badge fw-badge-corner" : "fw-badge"}>{count > max ? `${max}+` : count}</span>;
}
