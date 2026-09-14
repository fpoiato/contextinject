export function formatBytes(value: number | null | undefined): string {
  if (!value || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const precision = size >= 100 || index === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(precision).replace(/\.0+$/, "")} ${units[index]}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
