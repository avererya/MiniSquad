// Visible build label, e.g. "MiniSquad v0.3 · 1a2b3c4" (package 0.3.0 -> "v0.3"; a patch
// version other than .0 is shown in full, e.g. 0.3.1 -> "v0.3.1").
export const VERSION_SHORT = __APP_VERSION_SHORT__; // computed in vite.config.ts
export const VERSION_LABEL = `MiniSquad v${VERSION_SHORT} · ${__APP_COMMIT__}`;
