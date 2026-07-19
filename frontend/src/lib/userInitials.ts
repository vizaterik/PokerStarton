/** Two letters for avatar fallback — always from nickname, never from email. */
export function userInitials(displayName: string | null | undefined): string {
  const name = displayName?.trim();
  if (!name) return "?";
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}
