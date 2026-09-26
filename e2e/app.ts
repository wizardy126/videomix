import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ConsoleMessage, ElectronApplication, Page } from '@playwright/test';
import { _electron as electron } from '@playwright/test';

// Helpers to drive the real VideoMix app (production build in out/) from Playwright (T33).

export const repoDir = resolve(import.meta.dirname, '..');
export const mediaDir = join(repoDir, 'test-media');
export const media = (name: string) => join(mediaDir, name);
export const screenshotsDir = join(repoDir, 'test-results', 'e2e-screenshots');

const electronBin = join(repoDir, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

const ffDir = join(repoDir, 'ffmpeg', `${process.platform}-${process.arch}`, ...(process.platform === 'darwin' ? [] : ['lib']));

/** Runs the bundled ffprobe (the same one the app uses in development) and returns its JSON output. */
export function ffprobe(filePath: string) {
  const out = execFileSync(join(ffDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath], {
    env: { ...process.env, LD_LIBRARY_PATH: ffDir },
  });
  return JSON.parse(out.toString('utf8')) as {
    format: { duration: string },
    streams: { codec_type: string, width?: number, height?: number }[],
  };
}

/** One frame at `time` of `filePath` through the bundled ffmpeg with the filters `vf`, as raw RGB24. */
export function ffmpegFrame(filePath: string, time: number, vf: string) {
  return execFileSync(join(ffDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), ['-v', 'error', '-ss', String(time), '-i', filePath, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
    env: { ...process.env, LD_LIBRARY_PATH: ffDir },
    maxBuffer: 1e8,
  });
}

export interface LaunchedApp {
  app: ElectronApplication,
  page: Page,
  configDir: string,
  /** Console errors of the renderer, and uncaught page errors, since launch (or since the last `clear`). */
  consoleErrors: string[],
  close: () => Promise<void>,
}

/** Console errors that are expected in this environment and say nothing about the app. */
const ignoredConsoleErrors = [
  // no D-Bus in a container
  /dbus/i,
  // Xvfb without GPU
  /gpu|gles|egl|viz/i,
];

export async function launchApp({ language = 'en', args = [] }: { language?: string, args?: string[] } = {}): Promise<LaunchedApp> {
  // A fresh config and user data dir per launch: no settings, key bindings, recent projects or recovery file of a
  // previous run (or of the user's own VideoMix)
  const configDir = mkdtempSync(join(tmpdir(), 'videomix-e2e-config-'));

  const app = await electron.launch({
    executablePath: electronBin,
    cwd: repoDir,
    args: [
      // Containers usually have no usable sandbox (no user namespaces) nor GPU
      '--no-sandbox',
      '--disable-gpu',
      // Chromium's and Electron's userData (recovery files, render cache of unsaved projects…), isolated as well
      `--user-data-dir=${configDir}`,
      // The app, then its own options (docs/cli.md)
      '.',
      '--config-dir', configDir,
      // - language: the UI texts the tests look for
      // - storeWindowBounds: a fixed window size (below), not the one of a previous run
      '--settings-json', JSON.stringify({ language, storeWindowBounds: false }),
      // No update check or other network access
      '--disable-networking',
      ...args,
    ],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SANDBOX: '1',
    },
  });

  const page = await app.firstWindow();
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  if (userData !== configDir) throw new Error(`userData is ${userData}, not the temp dir`);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.setSize(1400, 900);
    win?.center();
  });

  const consoleErrors: string[] = [];
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (ignoredConsoleErrors.some((re) => re.test(text))) return;
    consoleErrors.push(text);
  };
  page.on('console', onConsole);
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  // The main UI is up once the source list is shown
  await page.getByTestId('source-list').waitFor();

  return {
    app,
    page,
    configDir,
    consoleErrors,
    close: async () => {
      // Skip the "unsaved changes" confirmations of the renderer and of main
      await app.evaluate(({ app: electronApp }) => { electronApp.exit(0); }).catch(() => undefined);
      await app.close().catch(() => undefined);
      rmSync(configDir, { recursive: true, force: true });
    },
  };
}

/**
 * The next native open dialog(s) answer with `filePaths` (native dialogs can't be driven). The renderer calls them
 * through @electron/remote, which looks the method up on main's `dialog` module on every call.
 */
export async function mockOpenDialog(app: ElectronApplication, filePaths: string[]) {
  await app.evaluate(({ dialog }, paths) => {
    // eslint-disable-next-line no-param-reassign
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog;
  }, filePaths);
}

/** Same for the save dialog (save project, render). */
export async function mockSaveDialog(app: ElectronApplication, filePath: string) {
  await app.evaluate(({ dialog }, path) => {
    // eslint-disable-next-line no-param-reassign
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
  }, filePath);
}

/** What a menu item does: sends its IPC message to the renderer (see src/main/menu.ts). */
export async function sendMenuAction(app: ElectronApplication, channel: string) {
  await app.evaluate(({ BrowserWindow }, ch) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send(ch);
  }, channel);
}

export async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: join(screenshotsDir, `${name}.png`) });
}

/**
 * Presses an app keyboard shortcut with the focus where it is, like a user would (G4, T51: the shortcuts work with the
 * focus anywhere but in text fields, dialogs and menus). `blur` first moves the focus to the body: only for a key a
 * focused element keeps for itself (Space/Enter on a button, arrows on a slider…).
 */
export async function pressShortcut(page: Page, key: string, { blur = false }: { blur?: boolean } = {}) {
  if (blur) await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(key);
}
