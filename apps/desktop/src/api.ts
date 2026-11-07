import { invoke, isTauri } from "@tauri-apps/api/core";
export const desktop = isTauri();
export async function call<T>(action: string, args: unknown = {}): Promise<T> {
  if (!desktop)
    throw new Error(
      "Open the Enderlink desktop app to manage servers. This browser build has no access to your computer.",
    );
  try {
    return await invoke<T>("command", { action, args });
  } catch (e) {
    throw new Error(
      typeof e === "string"
        ? e
        : e instanceof Error
          ? e.message
          : "The operation could not be completed.",
    );
  }
}
export const label = (engine: string) =>
  engine === "paper" ? "Paper" : "Fabric";
export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(0)} MB`;
  return `${(n / 1073741824).toFixed(1)} GB`;
}
export function date(n: number | null) {
  return n ? new Date(n * 1000).toLocaleString() : "Never";
}
