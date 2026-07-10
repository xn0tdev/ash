// Tauri → Wails shim for @tauri-apps/plugin-notification. Ash uses OS
// notifications for task-done/permission cues. Wails v2 has no built-in
// notification helper in the JS runtime, so we fall back to the Web
// Notification API (WebView2 supports it). Permission grant/requests map to
// Notification.requestPermission().

export async function isPermissionGranted(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  return Notification.permission === "granted";
}

export async function requestPermission(): Promise<"granted" | "denied" | "default"> {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission === "granted") return "granted";
  try {
    const p = await Notification.requestPermission();
    return p as "granted" | "denied" | "default";
  } catch {
    return "denied";
  }
}

export async function sendNotification(opts: { title: string; body?: string }): Promise<void> {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(opts.title, { body: opts.body });
  } catch {
    // best-effort
  }
}

export async function ensurePermissionGranted(): Promise<boolean> {
  const granted = await isPermissionGranted();
  if (granted) return true;
  return (await requestPermission()) === "granted";
}
