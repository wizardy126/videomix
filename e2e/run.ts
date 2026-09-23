// `yarn test-e2e [playwright args]`: the Playwright e2e tests of the Electron app (T33), local only.
// 1. Builds the app (`electron-vite build`, into out/), which is what the tests run, unless E2E_SKIP_BUILD=1.
// 2. On Linux without a display ($DISPLAY unset), runs Playwright inside `xvfb-run` if available.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const repoDir = join(import.meta.dirname, '..');

function run(): number {
  // The tests use the synthetic media of T02 and the app needs ffmpeg (both git-ignored)
  if (!['h-1080p-10s.mp4', 'h-720p-25fps-8s.mp4', 'v-1080x1920-12s.mp4', 'overlay-beep.wav'].every((name) => existsSync(join(repoDir, 'test-media', name)))) {
    console.error('Missing test media: run `yarn generate-test-media` first.');
    return 1;
  }
  if (!existsSync(join(repoDir, 'ffmpeg', `${process.platform}-${process.arch}`))) {
    console.error(`No ffmpeg in ffmpeg/${process.platform}-${process.arch}: run \`yarn download-ffmpeg-${process.platform}-${process.arch}\` first.`);
    return 1;
  }
  if (process.env['E2E_SKIP_BUILD'] !== '1') {
    const build = spawnSync(join(repoDir, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite'), ['build'], { stdio: 'inherit', cwd: repoDir, shell: process.platform === 'win32' });
    if (build.status !== 0) return build.status ?? 1;
  } else if (!existsSync(join(repoDir, 'out', 'main', 'index.js'))) {
    console.error('E2E_SKIP_BUILD=1 but there is no build in out/: run `yarn build` first.');
    return 1;
  }

  const playwrightCli = join(repoDir, 'node_modules', '@playwright', 'test', 'cli.js');
  const args = [playwrightCli, 'test', '-c', join('e2e', 'playwright.config.ts'), ...process.argv.slice(2)];

  const needsXvfb = process.platform === 'linux' && !process.env['DISPLAY'];
  if (!needsXvfb) return spawnSync(process.execPath, args, { stdio: 'inherit', cwd: repoDir }).status ?? 1;

  if (spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' }).error != null) {
    console.error('No $DISPLAY and no xvfb-run: install Xvfb (e.g. `apt install xvfb`) or run with a display.');
    return 1;
  }
  return spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1600x1000x24', process.execPath, ...args], { stdio: 'inherit', cwd: repoDir }).status ?? 1;
}

process.exitCode = run();
