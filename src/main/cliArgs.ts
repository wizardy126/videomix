/**
 * The command line arguments of VideoMix itself (files and options), without the executable and, when running unpackaged
 * (`electron . file.mp4`, `process.defaultApp`), the app path.
 *
 * T33: unpackaged, only the first 2 arguments used to be skipped. But Chromium/Node switches can come before the app
 * path (`electron --no-sandbox . file.mp4`, and Playwright's `_electron.launch` always adds `--inspect=0
 * --remote-debugging-port=0` first), and then the app path itself (".") was taken as a file to open: the app opened
 * its own folder, recursively, and any project file found in it.
 * Electron's default app takes the first argument that isn't a switch as the app path; so do we.
 */
export default function getArgsWithoutAppName(rawArgv: readonly string[], defaultApp: boolean) {
  if (!defaultApp) return rawArgv.slice(1);
  const appPathIndex = rawArgv.findIndex((arg, i) => i > 0 && !arg.startsWith('-'));
  return appPathIndex === -1 ? [] : rawArgv.slice(appPathIndex + 1);
}
