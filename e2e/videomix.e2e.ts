import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSON5 from 'json5';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import type { LaunchedApp } from './app.ts';
import { ffmpegFrame, ffprobe, launchApp, media, mockOpenDialog, mockSaveDialog, pressShortcut, screenshot, sendMenuAction } from './app.ts';

// End-to-end scenarios of T33 on the real app. They run in order on one app and build one project, like a user would:
// sources → clips → rect → reorder → save/reopen → settings → overlays → live preview → render → undo/redo.

const sourceFiles = ['h-1080p-10s.mp4', 'h-720p-25fps-8s.mp4', 'v-1080x1920-12s.mp4'];

interface SavedProject {
  sources: { name: string }[],
  clips: { id: string, name: string, sourceId: string, start: number, end: number, maxRect: { x: number, y: number, width: number, height: number } }[],
  settings: {
    maxColumns: number,
    output: { resolution: string },
    preset: string,
    transition: { type: string },
    fill: { mode: string },
    reorderWindow: number | 'unlimited',
  },
  overlays: ({ id: string, type: string, name: string, duration?: number, anchor: { kind: string, time?: number, clipId?: string, elementId?: string, edge?: string, offset?: number } })[],
}

// .vmx files are JSON5 (projectFile.ts)
const readProject = (path: string) => JSON5.parse(readFileSync(path, 'utf8')) as SavedProject;

const clipRows = (page: Page) => page.getByTestId('clip-row');
const clipNames = async (page: Page) => clipRows(page).locator('input').evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value));

/** The source player's current time. */
const playerTime = async (page: Page) => page.locator('video').first().evaluate((v) => (v as HTMLVideoElement).currentTime);

/**
 * Seeks the source player with the arrow keys (1 s per press) and waits until it gets there. A press right after a
 * source has been activated can be lost while the player settles: then the missing presses are repeated.
 */
async function seekBy(page: Page, seconds: number) {
  const target = (await playerTime(page)) + seconds;
  await expect(async () => {
    const remaining = Math.round(target - (await playerTime(page)));
    // blur: a focused rect overlay (after a drag) takes the arrows as nudges, a focused field as the caret
    for (let i = 0; i < Math.abs(remaining); i += 1) await pressShortcut(page, remaining > 0 ? 'ArrowRight' : 'ArrowLeft', { blur: true });
    await expect.poll(async () => playerTime(page), { timeout: 2000 }).toBeCloseTo(target, 1);
  }).toPass({ timeout: 15_000 });
}

/** The file shown by the source player (a converted preview, if any). */
const playerSrc = async (page: Page) => page.locator('video').first().evaluate((v) => (v as HTMLVideoElement).src).then((src) => (src.startsWith('file:') ? fileURLToPath(src.replace(/\?.*$/, '')) : src));

/**
 * What's at the middle of the element is the element itself: nothing covers it, e.g. the Mix view's live preview
 * (T41, T43). A modal dialog turns off the pointer events of the rest of the page, which hit testing skips: on again
 * for the check.
 */
const isOnTop = async (locator: Locator) => locator.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const { pointerEvents } = document.body.style;
  document.body.style.pointerEvents = 'auto';
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  document.body.style.pointerEvents = pointerEvents;
  return el.contains(top);
});

/**
 * The render progress dialog (T41) is shown, on top (not hidden behind the Mix view), with its title, a progress bar
 * and the times.
 */
async function expectRenderProgress(page: Page, title: string) {
  const dialog = page.getByTestId('render-progress');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: title })).toBeVisible();
  const bar = dialog.getByRole('progressbar');
  await expect(bar).toHaveAttribute('aria-valuenow', /^\d+(\.\d)?$/);
  await expect(dialog.getByTestId('render-progress-percent')).toHaveText(/^\d+\.\d %$/);
  await expect(dialog.getByTestId('render-progress-elapsed')).toHaveText(/^\d+:\d\d$/);
  await expect(dialog.getByTestId('render-progress-remaining')).toHaveText(/^(Calculating…|≈ \d+:\d\d)$/);
  // (the Working overlay the render used before was hidden behind the Mix view's live preview). Polled: right after
  // "Render anyway", the confirmation's fade-out (SweetAlert, `swal2-hide`) may still cover it for a moment.
  await expect.poll(async () => isOnTop(dialog)).toBe(true);
}

/** Until the "working" overlay (loading a source, rendering…), which covers the whole window, is gone. */
async function waitIdle(page: Page) {
  await expect(page.getByTestId('working')).toHaveCount(0, { timeout: 30_000 });
}

async function activateSource(page: Page, index: number, fileName: string) {
  await page.getByTestId('source-row').nth(index).click();
  await expect.poll(async () => page.locator('video').first().evaluate((v) => decodeURIComponent((v as HTMLVideoElement).src))).toContain(fileName);
  await expect.poll(async () => page.locator('video').first().evaluate((v) => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => playerTime(page)).toBe(0);
  await waitIdle(page);
}

/**
 * Taps the live preview's audio graph (scenario 7): every node connected to an AudioContext's destination also feeds
 * an analyser, in `window.e2eAnalysers`. The preview engine lives as long as the app and creates its AudioContext
 * once, on its first media element (T32), so this must run before the Mix tab is first shown.
 */
async function installAudioTap(page: Page) {
  await page.evaluate(() => {
    const w = globalThis as unknown as { e2eAnalysers: AnalyserNode[] };
    w.e2eAnalysers = [];
    const originalConnect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown;
    // eslint-disable-next-line func-names
    AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
      const [destination] = args;
      if (destination instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        originalConnect.call(this, analyser);
        w.e2eAnalysers.push(analyser);
      }
      return originalConnect.apply(this, args);
    } as typeof AudioNode.prototype.connect;
  });
}

/** Loudest RMS of the tapped preview output (see installAudioTap) over `ms`. */
async function measurePeakRms(page: Page, ms: number) {
  return page.evaluate(async (duration) => {
    const { e2eAnalysers } = globalThis as unknown as { e2eAnalysers: AnalyserNode[] };
    let peak = 0;
    const buf = new Float32Array(2048);
    const until = performance.now() + duration;
    while (performance.now() < until) {
      for (const analyser of e2eAnalysers) {
        analyser.getFloatTimeDomainData(buf);
        const rms = Math.sqrt(buf.reduce((acc, v) => acc + v * v, 0) / buf.length);
        peak = Math.max(peak, rms);
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { peak, analysers: e2eAnalysers.length, contexts: e2eAnalysers.map((a) => a.context.state) };
  }, ms);
}

/** A button by its text (not its title: e.g. the settings gear at the top right is also called "Settings"). */
const textButton = (page: Page, text: string) => page.locator('button').filter({ hasText: new RegExp(`^${text}$`) });

/** A labelled field (`Row`) of the overlay properties panel. */
const panelField = (panel: Locator, label: string, element: 'select' | 'input') => panel.locator(`xpath=.//div[span[normalize-space()="${label}"]]//${element}`).first();

/** A `<label>`led field of the mix settings dialog. */
const settingsField = (dialog: Locator, label: string) => dialog.locator('label', { hasText: label }).locator('select').first();

test.describe.serial('VideoMix (English UI)', () => {
  let ctx: LaunchedApp;
  let page: Page;
  let workDir: string;
  let projectPath: string;

  test.beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'videomix-e2e-'));
    projectPath = join(workDir, 'e2e-project.vmx');
    ctx = await launchApp();
    ({ page } = ctx);
    await installAudioTap(page);
  });

  // eslint-disable-next-line no-empty-pattern
  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) await screenshot(page, `failed-${testInfo.title.replaceAll(/\W+/g, '-')}`);
  });

  test.afterAll(async () => {
    await ctx?.close();
    if (workDir != null) rmSync(workDir, { recursive: true, force: true });
  });

  test('1. add 3 sources', async () => {
    await expect(page).toHaveTitle(/^Untitled project - VideoMix/);
    await mockOpenDialog(ctx.app, sourceFiles.map((f) => media(f)));
    await page.getByTestId('add-sources').click();

    await expect(page.getByTestId('source-row')).toHaveCount(3);
    for (const [i, name] of sourceFiles.entries()) await expect(page.getByTestId('source-row').nth(i)).toContainText(`${i + 1}. ${name}`);
    await expect(page.getByTestId('source-list')).toContainText('Sources (3)');
    // the first one is loaded in the player
    await expect.poll(async () => page.locator('video').first().evaluate((v) => decodeURIComponent((v as HTMLVideoElement).src))).toContain(sourceFiles[0]);
    await expect(page.getByTestId('source-row').first()).toContainText('0:10');
    await waitIdle(page);
    await expect(page).toHaveTitle(/^Untitled project\* - /);
    await screenshot(page, '01-sources');
  });

  test('2. create clips with I/O/N and drag a rect', async () => {
    // source 1: I at 0 s, O at 2 s
    await expect.poll(async () => page.locator('video').first().evaluate((v) => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
    // no clips yet: the mix duration estimate isn't shown
    await expect(page.getByTestId('mix-duration-estimate')).toHaveCount(0);
    await pressShortcut(page, 'i');
    // E1: with a start marked and no end, the counter (elapsed time to the cursor) shows in the bottom bar (and, the
    // same value, next to the playhead in the timeline: see cursorDuration.ts), and grows as the cursor moves
    await expect(page.getByTestId('cursor-duration')).toHaveText('0:00');
    await seekBy(page, 2);
    await expect(page.getByTestId('cursor-duration')).toHaveText('0:02');
    await pressShortcut(page, 'o');
    await expect(clipRows(page)).toHaveCount(1);
    await expect(clipRows(page).nth(0)).toContainText('0:00 – 0:02');
    // E3: the estimated duration is now shown next to Settings/Preview/Render, with the project's single clip
    await expect(page.getByTestId('mix-duration-estimate')).toHaveText('≈ 0:02');

    // source 2: I at 1 s, O at 3 s
    await activateSource(page, 1, sourceFiles[1]!);
    await seekBy(page, 1);
    await pressShortcut(page, 'i');
    await seekBy(page, 2);
    await pressShortcut(page, 'o');
    await expect(clipRows(page)).toHaveCount(2);
    await expect(clipRows(page).nth(1)).toContainText('0:01 – 0:03');

    // source 3 (vertical): N at 4 s adds a 5 s clip
    await activateSource(page, 2, sourceFiles[2]!);
    await seekBy(page, 4);
    await pressShortcut(page, 'n');
    await expect(clipRows(page)).toHaveCount(3);
    await expect(clipRows(page).nth(2)).toContainText('0:04 – 0:09');

    expect(await clipNames(page)).toEqual(['h-1080p-10s #1', 'h-720p-25fps-8s #1', 'v-1080x1920-12s #1']);
    await expect(page.getByTestId('source-row').nth(0)).toContainText('1 clip');

    // select the first clip (activates its source) and drag the right edge of its max rect to the middle of the frame
    // (on its times: the middle of the row is its name field)
    await clipRows(page).nth(0).getByText('0:00 – 0:02').click();
    await expect.poll(async () => page.locator('video').first().evaluate((v) => decodeURIComponent((v as HTMLVideoElement).src))).toContain(sourceFiles[0]);
    await waitIdle(page);
    const label = page.getByTestId('rect-label');
    await expect(label).toContainText('Max 1920×1080');
    const east = page.getByTestId('rect-handle-max-e');
    const west = page.getByTestId('rect-handle-max-w');
    const eastBox = (await east.boundingBox())!;
    const westBox = (await west.boundingBox())!;
    const frameWidth = eastBox.x - westBox.x;
    // The right edge of the frame is the edge of the player area: grab the half of the handle that is inside it
    const grab = { x: eastBox.x + eastBox.width * 0.25, y: eastBox.y + eastBox.height / 2 };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x - frameWidth / 4, grab.y, { steps: 5 });
    await page.mouse.move(grab.x - frameWidth / 2, grab.y, { steps: 5 });
    await page.mouse.up();
    // ≈ 960 px wide (the exact value depends on the rounding of the screen → source px conversion)
    await expect(label).toContainText(/Max (9[4-7]\d)×1080/);
    await screenshot(page, '02-clips-rect');
  });

  test('3. reorder the clips by dragging', async () => {
    // drag the third clip's handle above the first one
    const handle = page.getByTestId('clip-drag-handle').nth(2);
    const target = clipRows(page).nth(0);
    const from = (await handle.boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y - 20, { steps: 5 });
    await page.mouse.move(from.x + from.width / 2, to.y + 5, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => clipNames(page)).toEqual(['v-1080x1920-12s #1', 'h-1080p-10s #1', 'h-720p-25fps-8s #1']);
    await screenshot(page, '03-reordered');
  });

  test('4. save and reopen the .vmx', async () => {
    await mockSaveDialog(ctx.app, projectPath);
    await pressShortcut(page, 'Control+s');
    await expect.poll(() => existsSync(projectPath)).toBe(true);
    await expect(page).toHaveTitle(/^e2e-project - /);

    const saved = readProject(projectPath);
    expect(saved.sources.map((s) => s.name)).toEqual(sourceFiles);
    expect(saved.clips.map((c) => c.name)).toEqual(['v-1080x1920-12s #1', 'h-1080p-10s #1', 'h-720p-25fps-8s #1']);
    expect(saved.clips.map((c) => [c.start, c.end])).toEqual([[4, 9], [0, 2], [1, 3]]);
    const rect = saved.clips[1]!.maxRect;
    expect(rect.x).toBe(0);
    expect(rect.height).toBe(1080);
    expect(rect.width).toBeGreaterThan(900);
    expect(rect.width).toBeLessThan(1000);

    // New project, then Open project...
    await sendMenuAction(ctx.app, 'newProject');
    await expect(page.getByTestId('source-row')).toHaveCount(0);
    await expect(clipRows(page)).toHaveCount(0);
    await expect(page).toHaveTitle(/^Untitled project - VideoMix/);

    await mockOpenDialog(ctx.app, [projectPath]);
    await sendMenuAction(ctx.app, 'openProject');
    await expect(page.getByTestId('source-row')).toHaveCount(3);
    await expect.poll(async () => clipNames(page)).toEqual(['v-1080x1920-12s #1', 'h-1080p-10s #1', 'h-720p-25fps-8s #1']);
    await expect(page).toHaveTitle(/^e2e-project - /);
    await screenshot(page, '04-reopened');
  });

  test('5. mix settings', async () => {
    await textButton(page, 'Settings').click();
    const dialog = page.getByTestId('mix-settings');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Mix settings');

    await settingsField(dialog, 'Maximum visible columns').selectOption('2');
    // the smallest output the app offers (the render in scenario 8 stays short)
    await settingsField(dialog, 'Resolution').selectOption('720');
    await settingsField(dialog, 'Encoding speed preset').selectOption('ultrafast');
    await settingsField(dialog, 'Transition type').selectOption('dissolve');
    await settingsField(dialog, 'Fill empty space with').selectOption('color');
    // E8 (T38c): a number without practical limit, or unlimited; unchecking goes back to the number. It ends at 3 (the
    // default) so the later scenarios keep their plan.
    const reorderWindow = dialog.locator('label', { hasText: 'Reorder window' }).locator('input');
    const unlimited = dialog.getByRole('checkbox', { name: 'Unlimited' });
    await reorderWindow.fill('25');
    await unlimited.click();
    await expect(reorderWindow).toBeDisabled();
    await expect(dialog).toContainText('Clips may come from anywhere in the project');
    await unlimited.click();
    await expect(reorderWindow).toBeEnabled();
    await expect(reorderWindow).toHaveValue('25');
    await reorderWindow.fill('3');
    await screenshot(page, '05-settings');
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveTitle(/^e2e-project\* - /);

    await pressShortcut(page, 'Control+s');
    await expect(page).toHaveTitle(/^e2e-project - /);
    const { settings } = readProject(projectPath);
    expect(settings.maxColumns).toBe(2);
    expect(settings.output.resolution).toBe('720');
    expect(settings.preset).toBe('ultrafast');
    expect(settings.transition.type).toBe('dissolve');
    expect(settings.fill.mode).toBe('color');
    expect(settings.reorderWindow).toBe(3);
  });

  test('6. overlays: countdown, text and sound, anchored', async () => {
    await page.getByRole('button', { name: 'Mix', exact: true }).click();
    const planView = page.getByTestId('mix-plan-view');
    await expect(planView).toBeVisible();
    const panel = page.getByTestId('overlay-panel');

    // countdown of 3 s at the cursor (0 s)
    await planView.getByRole('button', { name: 'Add countdown' }).click();
    await expect(panel).toBeVisible();
    const duration = panelField(panel, 'Duration', 'input');
    await duration.fill('3');
    await duration.press('Enter');
    await expect(duration).toHaveValue('3');

    // text anchored to the end of the first clip in the list, 0.5 s before it
    await planView.getByRole('button', { name: 'Add text' }).click();
    await expect(panel).toContainText('Text');
    await panelField(panel, 'Start', 'select').selectOption('clip');
    await panelField(panel, 'Clip', 'select').selectOption({ label: 'h-1080p-10s #1' });
    await panelField(panel, 'Edge', 'select').selectOption('end');
    const offset = panelField(panel, 'Offset', 'input');
    await offset.fill('-0.5');
    await offset.press('Enter');
    // 2 s, so it ends before the video does
    const textDuration = panelField(panel, 'Duration', 'input');
    await textDuration.fill('2');
    await textDuration.press('Enter');

    // sound (beep) anchored to the end of the countdown
    await mockOpenDialog(ctx.app, [media('overlay-beep.wav')]);
    await planView.getByRole('button', { name: 'Add sound…' }).click();
    await expect(panel).toContainText('overlay-beep.wav');
    await panelField(panel, 'Start', 'select').selectOption('element');
    await panelField(panel, 'Overlay', 'select').selectOption({ label: 'Countdown #1' });
    await panelField(panel, 'Edge', 'select').selectOption('end');
    await screenshot(page, '06-overlays');

    await expect(planView.getByTestId('overlay-block')).toHaveCount(3);
    // no warnings on any of them (all inside the video, no broken anchors)
    await expect(planView.getByTestId('overlay-block').locator('svg')).toHaveCount(0);

    await pressShortcut(page, 'Control+s');
    await expect(page).toHaveTitle(/^e2e-project - /);
    const { overlays, clips } = readProject(projectPath);
    expect(overlays.map((o) => o.type)).toEqual(['countdown', 'text', 'sound']);
    const [countdown, text, sound] = overlays;
    expect(countdown!.duration).toBe(3);
    expect(text!.duration).toBe(2);
    expect(text!.anchor).toEqual({ kind: 'clip', clipId: clips.find((c) => c.name === 'h-1080p-10s #1')!.id, edge: 'end', offset: -0.5 });
    expect(sound!.anchor).toEqual({ kind: 'element', elementId: countdown!.id, edge: 'end', offset: 0 });
  });

  test('7. live preview plays, without console errors, with sound', async () => {
    // Close the overlay panel: the clip list is back
    await page.getByTestId('overlay-panel').getByTitle('Close').click();

    const preview = page.getByTestId('mix-live-preview');
    await expect(preview).toBeVisible();
    const slider = preview.getByRole('slider');
    const duration = Number(await slider.getAttribute('aria-valuemax'));
    expect(duration).toBeGreaterThan(4);

    const errorsBefore = ctx.consoleErrors.length;
    await preview.getByTitle('Play').click();
    await expect(preview.getByTitle('Pause')).toBeVisible();

    // Loudest RMS seen in 2.5 s of playback. The clips haven't been analysed yet, so they play at their own level
    // (T32): the first ones are the 660 Hz tone of h-720p (−33 dBFS RMS ≈ 0.022) and the 440 Hz one of h-1080p
    // (−21 dBFS ≈ 0.09), with the fade-in and transitions (measured here: ≈ 0.02–0.04).
    const peakRms = await measurePeakRms(page, 2500);
    await screenshot(page, '07-live-preview');
    console.log('Live preview audio:', JSON.stringify(peakRms));

    // the time advances
    expect(Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThan(1);

    // the canvas shows something (not a black/empty frame)
    const canvasLitFraction = async () => preview.locator('canvas').evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i]! + data[i + 1]! + data[i + 2]! > 60) lit += 1;
      return lit / (data.length / 4);
    });
    expect(await preview.locator('canvas').evaluate((el) => (el as HTMLCanvasElement).width)).toBeGreaterThan(100);
    expect(await canvasLitFraction()).toBeGreaterThan(0.2);

    await preview.getByTitle('Pause').click();
    await expect(preview.getByTitle('Play')).toBeVisible();

    // paused: silence (the analysers do measure the preview's output)
    await page.waitForTimeout(500);
    const pausedRms = await page.evaluate(() => {
      const { e2eAnalysers } = globalThis as unknown as { e2eAnalysers: AnalyserNode[] };
      const buf = new Float32Array(2048);
      return Math.max(...e2eAnalysers.map((analyser) => {
        analyser.getFloatTimeDomainData(buf);
        return Math.sqrt(buf.reduce((acc, v) => acc + v * v, 0) / buf.length);
      }));
    });
    expect(pausedRms).toBeLessThan(0.001);

    // seeking while paused draws that frame: back to the start (black: global fade-in), then the middle
    const sliderBox = (await slider.boundingBox())!;
    await page.mouse.click(sliderBox.x + 1, sliderBox.y + sliderBox.height / 2);
    await expect.poll(canvasLitFraction).toBeLessThan(0.05);
    await page.mouse.click(sliderBox.x + sliderBox.width / 2, sliderBox.y + sliderBox.height / 2);
    await expect.poll(async () => Number(await slider.getAttribute('aria-valuenow'))).toBeCloseTo(duration / 2, 0);
    await expect.poll(canvasLitFraction).toBeGreaterThan(0.2);
    await screenshot(page, '07-live-preview-paused-middle');

    expect(ctx.consoleErrors.slice(errorsBefore)).toEqual([]);
    expect(peakRms.analysers).toBeGreaterThan(0);
    expect(peakRms.contexts).toContain('running');
    // WebAudio from the <video> elements (MediaElementAudioSourceNode, file:// media) is not silent: T32's open risk
    // was that Chromium would treat the media as cross-origin and output zeros
    expect(peakRms.peak, JSON.stringify(peakRms)).toBeGreaterThan(0.005);
  });

  test('8a. preview render (640×360), which also analyses the loudness', async () => {
    const preview = page.getByTestId('mix-live-preview');
    const expectedDuration = Number(await preview.getByRole('slider').getAttribute('aria-valuemax'));
    await expect(preview).toContainText('Audio levels are not normalized');

    await textButton(page, 'Preview').click();
    const previewAnyway = page.getByRole('button', { name: 'Preview anyway' });
    const dialogTitle = page.getByText('Mix preview', { exact: true });
    await expect(previewAnyway.or(dialogTitle)).toBeVisible({ timeout: 60_000 });
    if (await previewAnyway.isVisible()) await previewAnyway.click();
    await expect(dialogTitle).toBeVisible({ timeout: 110_000 });

    const dialogVideo = page.getByRole('dialog').locator('video');
    const src = await dialogVideo.evaluate((v) => (v as HTMLVideoElement).src);
    const probe = ffprobe(fileURLToPath(src));
    const video = probe.streams.find((s) => s.codec_type === 'video');
    expect([video?.width, video?.height]).toEqual([640, 360]);
    expect(Number(probe.format.duration)).toBeCloseTo(expectedDuration, 0);
    // it plays (autoplay)
    await expect.poll(async () => dialogVideo.evaluate((v) => (v as HTMLVideoElement).currentTime)).toBeGreaterThan(0.5);
    // not hidden behind the live preview (T43)
    expect(await isOnTop(page.getByRole('dialog'))).toBe(true);
    await screenshot(page, '08a-preview-dialog');
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialogTitle).toBeHidden();

    // the analysis is cached: the live preview plays normalized levels now, like the render (≈ −18 dBFS RMS here,
    // ≈ 0.12, instead of 0.02–0.04 before)
    await expect(preview).not.toContainText('Audio levels are not normalized');
    const slider = preview.getByRole('slider');
    const sliderBox = (await slider.boundingBox())!;
    const seekTo = async (fraction: number) => page.mouse.click(sliderBox.x + sliderBox.width * fraction, sliderBox.y + sliderBox.height / 2);
    // T40: this used to take a single fixed-length measurement right after clicking Play, which is intermittently
    // flaky (an exact 0, or a peak just under a threshold): both seeks below are genuinely silent while the element
    // is still seeking/decoding (nothing to measure yet, correctly), and how long that takes depends on the machine
    // and its current load, not on the app — a single short window can start (and end) entirely inside it. So both
    // measurements below poll in the same short windows, for a generous budget, until they actually hear the clip; a
    // real regression (frozen forever, as before the seek lead fix, T33) still fails once its budget runs out. See
    // docs/videomix/execution/T40-v3-cierre.md for the analysis (measured seek/decode durations under load).
    // two clips at once (≈ 1.9–3.5 s)
    await seekTo(0.4);
    await preview.getByTitle('Play').click();
    let twoClips = 0;
    await expect.poll(async () => {
      twoClips = (await measurePeakRms(page, 1000)).peak;
      return twoClips;
    }, { timeout: 10_000 }).toBeGreaterThan(0.05);
    await preview.getByTitle('Pause').click();
    // then (paused seek, play) where only the vertical clip plays, ≈ 7.5 s into its source: 7 s of decoding from the
    // previous keyframe (a much longer seek than above, so a longer budget)
    await seekTo(0.7);
    await preview.getByTitle('Play').click();
    let farFromKeyframe = 0;
    await expect.poll(async () => {
      // G1 (T52): only the last 1.5 s of this 5 s mix is left after the seek, so a slow seek can reach the end
      // (which pauses) before anything is heard: seek and play again (the decoded data is warm by then)
      if (await preview.getByTitle('Play').isVisible()) {
        await seekTo(0.7);
        await preview.getByTitle('Play').click();
      }
      farFromKeyframe = (await measurePeakRms(page, 1500)).peak;
      return farFromKeyframe;
    }, { timeout: 30_000 }).toBeGreaterThan(0.02);
    // G1 (T52): the safety net plays this mix in list order (5 s, the vertical clip alone for its last 1.5 s), so it
    // may have ended during the measurement, which pauses it
    await preview.getByTitle('Pause').click({ timeout: 2000 }).catch(() => undefined);
    await expect(preview.getByTitle('Play')).toBeVisible();
    console.log('Live preview audio, normalized:', JSON.stringify({ twoClips, farFromKeyframe }));

    // T43: the Working overlay (here loading another source, with the Mix tab shown) is above the live preview. It's
    // usually gone too fast to poll for, so the check runs in the page as soon as it's added: what's at the middle of
    // the preview is Working
    const current = await playerSrc(page);
    const other = sourceFiles.findIndex((name) => !current.endsWith(name));
    await page.evaluate(() => {
      const w = globalThis as unknown as { e2eWorkingOnTop: Promise<boolean> };
      w.e2eWorkingOnTop = new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          const working = document.querySelector('[data-testid="working"]');
          const livePreview = document.querySelector('[data-testid="mix-live-preview"]');
          if (working == null || livePreview == null) return;
          observer.disconnect();
          const r = livePreview.getBoundingClientRect();
          resolve(working.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)));
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });
    });
    await page.getByTestId('source-row').nth(other).click();
    expect(await page.evaluate(async () => (globalThis as unknown as { e2eWorkingOnTop: Promise<boolean> }).e2eWorkingOnTop)).toBe(true);
    await expect.poll(async () => playerSrc(page)).toContain(sourceFiles[other]!);
    await waitIdle(page);
    await expect(preview).toBeVisible();
  });

  test('8b. a render can be cancelled from its progress dialog (T41)', async () => {
    const outPath = join(workDir, 'e2e-render-cancelled.mp4');
    await mockSaveDialog(ctx.app, outPath);
    await page.getByRole('button', { name: 'Render', exact: true }).click();

    const renderAnyway = page.getByRole('button', { name: 'Render anyway' });
    const progressDialog = page.getByTestId('render-progress');
    await expect(renderAnyway.or(progressDialog)).toBeVisible({ timeout: 30_000 });
    if (await renderAnyway.isVisible()) await renderAnyway.click();
    await expectRenderProgress(page, 'Rendering the mix');
    // (the loudness was analysed in 8a)
    await expect(progressDialog.getByTestId('render-progress-phase')).toHaveText('Rendering video and audio');
    // Esc doesn't close it (nor cancel the render)
    await page.keyboard.press('Escape');
    await expect(progressDialog).toBeVisible();
    await screenshot(page, '08b-render-progress');

    await progressDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(progressDialog).toHaveCount(0, { timeout: 15_000 });
    // no error, no result, and the progress is gone from the title
    await expect(page).not.toHaveTitle(/%/);
    await expect(page.getByText('Failed to render the mix')).toHaveCount(0);
    await expect(page.getByText('Success!')).toHaveCount(0);
    expect(existsSync(outPath)).toBe(false);
    await screenshot(page, '08b-render-cancelled');
    // the UI works again: 8c renders
  });

  test('8c. render and check the file with ffprobe', async () => {
    const outPath = join(workDir, 'e2e-render.mp4');
    const expectedDuration = Number(await page.getByTestId('mix-live-preview').getByRole('slider').getAttribute('aria-valuemax'));

    await mockSaveDialog(ctx.app, outPath);
    await page.getByRole('button', { name: 'Render', exact: true }).click();

    // plan warnings (e.g. fill around the vertical clip), if any
    const renderAnyway = page.getByRole('button', { name: 'Render anyway' });
    const success = page.getByText('Success!');
    const progressDialog = page.getByTestId('render-progress');
    await expect(renderAnyway.or(progressDialog).or(success)).toBeVisible({ timeout: 30_000 });
    if (await renderAnyway.isVisible()) {
      await screenshot(page, '08-render-warnings');
      await renderAnyway.click();
    }
    // T41: the progress dialog (checked in 8b), with some progress, for the screenshot (this render is short: it may be
    // over already)
    for (let i = 0; i < 100 && await progressDialog.isVisible(); i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const percent = Number(await progressDialog.getByRole('progressbar').getAttribute('aria-valuenow', { timeout: 500 }).catch(() => 0));
      if (percent >= 30) {
        // eslint-disable-next-line no-await-in-loop
        await screenshot(page, '08c-render-progress');
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(100);
    }
    await expect(success).toBeVisible({ timeout: 110_000 });
    await expect(page.getByText(`The mix has been rendered to: ${outPath}`)).toBeVisible();
    await screenshot(page, '08-rendered');
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    expect(existsSync(outPath)).toBe(true);
    const probe = ffprobe(outPath);
    const video = probe.streams.find((s) => s.codec_type === 'video');
    expect(video?.width).toBe(1280);
    expect(video?.height).toBe(720);
    expect(probe.streams.some((s) => s.codec_type === 'audio')).toBe(true);
    expect(Number(probe.format.duration)).toBeCloseTo(expectedDuration, 0);
  });

  test('9. undo and redo', async () => {
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await clipRows(page).nth(0).getByText('0:04 – 0:09').click();
    await waitIdle(page);
    await pressShortcut(page, 'Delete');
    await expect(clipRows(page)).toHaveCount(2);
    expect(await clipNames(page)).toEqual(['h-1080p-10s #1', 'h-720p-25fps-8s #1']);

    await pressShortcut(page, 'Control+z');
    await expect(clipRows(page)).toHaveCount(3);
    expect(await clipNames(page)).toEqual(['v-1080x1920-12s #1', 'h-1080p-10s #1', 'h-720p-25fps-8s #1']);

    await pressShortcut(page, 'Control+Shift+z');
    await expect(clipRows(page)).toHaveCount(2);

    await pressShortcut(page, 'Control+z');
    await expect(clipRows(page)).toHaveCount(3);

    await screenshot(page, '09-undo');
  });

  test('9b. "New clip from here" starts a new clip inside another one, without changing it (E6)', async () => {
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    // clip "h-1080p-10s #1" (0:00 – 0:02, at index 1 after the reorder of scenario 3): select it (activates its
    // source and seeks to its start) so the cursor lands inside its range
    await clipRows(page).nth(1).getByText('0:00 – 0:02').click();
    await waitIdle(page);
    await pressShortcut(page, 'Control+Home');
    await seekBy(page, 1); // now at 1 s, inside the clip's 0–2 s range

    // BottomBar button: unlike plain "Mark start" (which would move clip #1's own start), it always starts a new
    // marker, even with the cursor inside another clip's range, and never touches that clip
    await page.getByTestId('new-clip-from-cursor-button').click();
    await expect(clipRows(page)).toHaveCount(3); // a marker isn't a clip yet
    await expect(clipRows(page).nth(1)).toContainText('0:00 – 0:02'); // clip #1 untouched

    await seekBy(page, 1); // now at 2 s
    await pressShortcut(page, 'o'); // "Mark end" closes the NEW marker as a new clip, not clip #1
    await expect(clipRows(page)).toHaveCount(4);
    expect(await clipNames(page)).toEqual(['v-1080x1920-12s #1', 'h-1080p-10s #1', 'h-720p-25fps-8s #1', 'h-1080p-10s #2']);
    await expect(clipRows(page).nth(1)).toContainText('0:00 – 0:02'); // clip #1 still untouched
    await expect(clipRows(page).nth(3)).toContainText('0:01 – 0:02'); // the new clip, overlapping clip #1
    await screenshot(page, '09b-new-clip-from-here');

    // undo it so the remaining scenarios (an app closed and relaunched) don't depend on it
    await pressShortcut(page, 'Control+z');
    await expect(clipRows(page)).toHaveCount(3);
    expect(await clipNames(page)).toEqual(['v-1080x1920-12s #1', 'h-1080p-10s #1', 'h-720p-25fps-8s #1']);

    // the Shift+I shortcut path does the same thing (still with the cursor inside clip #1)
    await pressShortcut(page, 'Shift+i');
    await expect(clipRows(page)).toHaveCount(3); // still just a marker
    await expect(clipRows(page).nth(1)).toContainText('0:00 – 0:02'); // clip #1 untouched
  });
});

test.describe('VideoMix (anamorphic source)', () => {
  test('11. a source with non-square pixels works in display pixels (B1, T35)', async () => {
    const ctx = await launchApp();
    const { page } = ctx;
    const workDir = mkdtempSync(join(tmpdir(), 'videomix-e2e-sar-'));
    try {
      // 1280x720 coded at 87:82 (≈ 679:640): Chromium shows it at 1358x720
      const file = 'ana-1280x720-sar-6s.mp4';
      await mockOpenDialog(ctx.app, [media(file)]);
      await page.getByTestId('add-sources').click();
      await expect(page.getByTestId('source-row')).toHaveCount(1);
      await expect.poll(async () => page.locator('video').first().evaluate((v) => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
      expect(await page.locator('video').first().evaluate((v) => [(v as HTMLVideoElement).videoWidth, (v as HTMLVideoElement).videoHeight])).toEqual([1358, 720]);
      await waitIdle(page);
      await pressShortcut(page, 'n');
      await expect(clipRows(page)).toHaveCount(1);
      // the whole frame, in the same pixels as the editor
      await expect(page.getByTestId('rect-label')).toContainText('Max 1358×720');

      const projectPath = join(workDir, 'sar.vmx');
      await mockSaveDialog(ctx.app, projectPath);
      await pressShortcut(page, 'Control+s');
      // Not just existsSync: the title loses its "*" only once the save (the write included) has actually finished
      await expect(page).toHaveTitle(/^sar - /);
      const saved = JSON5.parse(readFileSync(projectPath, 'utf8')) as { sources: { width: number, height: number, sar?: { num: number, den: number } }[], clips: SavedProject['clips'] };
      expect(saved.sources[0]).toMatchObject({ width: 1358, height: 720, sar: { num: 87, den: 82 } });
      expect(saved.clips[0]!.maxRect).toEqual({ x: 0, y: 0, width: 1358, height: 720 });

      // the render accepts the rect (before T35: max-rect-outside-frame) and crops it in coded pixels
      await page.getByRole('button', { name: 'Mix', exact: true }).click();
      await textButton(page, 'Preview').click();
      const previewAnyway = page.getByRole('button', { name: 'Preview anyway' });
      const dialogTitle = page.getByText('Mix preview', { exact: true });
      await expect(previewAnyway.or(dialogTitle)).toBeVisible({ timeout: 60_000 });
      if (await previewAnyway.isVisible()) await previewAnyway.click();
      await expect(dialogTitle).toBeVisible({ timeout: 110_000 });
      const src = await page.getByRole('dialog').locator('video').evaluate((v) => (v as HTMLVideoElement).src);
      const video = ffprobe(fileURLToPath(src)).streams.find((s) => s.codec_type === 'video');
      expect([video?.width, video?.height]).toEqual([640, 360]);
      await screenshot(page, '11-anamorphic-preview');
      expect(ctx.consoleErrors).toEqual([]);
    } finally {
      await ctx.close();
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  test('12. an old project whose anamorphic source has a stale (pre-SAR) cache renders without reactivating it (T35b)', async () => {
    const ctx = await launchApp();
    const { page } = ctx;
    const workDir = mkdtempSync(join(tmpdir(), 'videomix-e2e-sar-stale-'));
    try {
      const regularFile = sourceFiles[0]!;
      const anaFile = 'ana-1280x720-sar-6s.mp4';

      // A normal project with a regular source (loaded first) and the anamorphic one, each with a clip; the
      // anamorphic source is activated once here, so its clip's max rect can be set to the real bug case below.
      await mockOpenDialog(ctx.app, [media(regularFile), media(anaFile)]);
      await page.getByTestId('add-sources').click();
      await expect(page.getByTestId('source-row')).toHaveCount(2);
      await waitIdle(page);
      await pressShortcut(page, 'n');

      await page.getByTestId('source-row').nth(1).click();
      await expect.poll(async () => page.locator('video').first().evaluate((v) => (v as HTMLVideoElement).videoWidth)).toBe(1358);
      await waitIdle(page);
      await pressShortcut(page, 'n');
      await expect(clipRows(page)).toHaveCount(2);

      const projectPath = join(workDir, 'sar-stale.vmx');
      await mockSaveDialog(ctx.app, projectPath);
      await pressShortcut(page, 'Control+s');
      // Not just existsSync: the title loses its "*" only once the save (the write included) has actually finished
      await expect(page).toHaveTitle(/^sar-stale - /);

      // Simulate a project saved before T35 (B1): the anamorphic source's cache is its coded size, with no SAR, and
      // its clip's max rect is the real bug case (78,14 1232×694 — invalid at 1280×720, valid at 1358×720)
      const saved = JSON5.parse(readFileSync(projectPath, 'utf8')) as {
        sources: { id: string, name: string, width: number, height: number, sar?: { num: number, den: number } }[],
        clips: SavedProject['clips'],
      };
      const anaSource = saved.sources.find((s) => s.name === anaFile)!;
      expect(anaSource).toMatchObject({ width: 1358, height: 720, sar: { num: 87, den: 82 } }); // sanity: really refreshed above
      delete anaSource.sar;
      anaSource.width = 1280;
      anaSource.height = 720;
      const anaClip = saved.clips.find((c) => c.sourceId === anaSource.id)!;
      anaClip.maxRect = { x: 78, y: 14, width: 1232, height: 694 };
      writeFileSync(projectPath, JSON5.stringify(saved, null, 2));

      await sendMenuAction(ctx.app, 'newProject');
      await expect(page.getByTestId('source-row')).toHaveCount(0);

      // Reopen: the regular source (first) is activated automatically, the anamorphic one never is
      await mockOpenDialog(ctx.app, [projectPath]);
      await sendMenuAction(ctx.app, 'openProject');
      await expect(page.getByTestId('source-row')).toHaveCount(2);
      await expect.poll(async () => clipNames(page)).toHaveLength(2);
      await waitIdle(page);

      // Before T35b this fails validation (max-rect-outside-frame): the cache still says 1280×720
      await page.getByRole('button', { name: 'Mix', exact: true }).click();
      await textButton(page, 'Preview').click();
      const previewAnyway = page.getByRole('button', { name: 'Preview anyway' });
      const dialogTitle = page.getByText('Mix preview', { exact: true });
      await expect(previewAnyway.or(dialogTitle)).toBeVisible({ timeout: 60_000 });
      if (await previewAnyway.isVisible()) await previewAnyway.click();
      await expect(dialogTitle).toBeVisible({ timeout: 110_000 });
      await screenshot(page, '12-stale-sar-reopened-preview');
      expect(ctx.consoleErrors).toEqual([]);
    } finally {
      await ctx.close();
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

test.describe('VideoMix (turned clip)', () => {
  test('13. a turned clip is edited on the turned picture and rendered turned (E9, T38d)', async () => {
    const ctx = await launchApp();
    const { page } = ctx;
    const workDir = mkdtempSync(join(tmpdir(), 'videomix-e2e-rotation-'));
    try {
      const file = sourceFiles[0]!; // 1920x1080
      await mockOpenDialog(ctx.app, [media(file)]);
      await page.getByTestId('add-sources').click();
      await expect(page.getByTestId('source-row')).toHaveCount(1);
      await expect.poll(async () => page.locator('video').first().evaluate((v) => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
      await waitIdle(page);
      await pressShortcut(page, 'n');
      await expect(clipRows(page)).toHaveCount(1);
      await expect(page.getByTestId('rect-label')).toContainText('Max 1920×1080 · 16:9 · Horizontal');
      const playerTransform = async () => page.locator('video').first().evaluate((v) => v.parentElement?.style.transform ?? '');
      expect(await playerTransform()).toBe('');

      // R (+90°), the toolbar's 180° (→ 270°), Shift+R (−90° → 180°) and the toolbar's −90° (→ 90°)
      await pressShortcut(page, 'r');
      await expect(page.getByTestId('rect-label')).toContainText('Max 1080×1920 · 9:16 · Vertical');
      await page.getByTestId('rotate-clip-180').click();
      await expect(page.getByTestId('clip-rotation')).toHaveText('270°');
      await pressShortcut(page, 'Shift+r');
      await expect(page.getByTestId('clip-rotation')).toHaveText('180°');
      await expect(page.getByTestId('rect-label')).toContainText('Max 1920×1080 · 16:9 · Horizontal');
      await page.getByTestId('rotate-clip-ccw').click();
      await expect(page.getByTestId('clip-rotation')).toHaveText('90°');
      await expect(page.getByTestId('clip-rotation-indicator')).toHaveText('90°');
      await expect(page.getByTestId('rect-label')).toContainText('Max 1080×1920 · 9:16 · Vertical');

      // the player shows the turned picture, and the max rect (the whole turned frame) is drawn tall over it
      expect(await playerTransform()).toMatch(/^rotate\(90deg\) scale\([\d.]+\)$/);
      const nw = (await page.getByTestId('rect-handle-max-nw').boundingBox())!;
      const se = (await page.getByTestId('rect-handle-max-se').boundingBox())!;
      expect((se.x - nw.x) / (se.y - nw.y)).toBeCloseTo(1080 / 1920, 1);
      // the thumbnail of the row is turned too (tall)
      await expect.poll(async () => clipRows(page).first().locator('img').evaluate((img) => (img as HTMLImageElement).naturalHeight / Math.max(1, (img as HTMLImageElement).naturalWidth)), { timeout: 20_000 }).toBeGreaterThan(1.5);
      await screenshot(page, '13a-turned-clip-editor');

      const projectPath = join(workDir, 'rotation.vmx');
      await mockSaveDialog(ctx.app, projectPath);
      await pressShortcut(page, 'Control+s');
      await expect(page).toHaveTitle(/^rotation - /);
      const saved = JSON5.parse(readFileSync(projectPath, 'utf8')) as { clips: (SavedProject['clips'][number] & { rotation?: number })[] };
      expect(saved.clips[0]).toMatchObject({ rotation: 90, maxRect: { x: 0, y: 0, width: 1080, height: 1920 } });
      const { start } = saved.clips[0]!;

      // the live preview draws it turned, and the rendered preview shows the source turned clockwise
      await page.getByRole('button', { name: 'Mix', exact: true }).click();
      const preview = page.getByTestId('mix-live-preview');
      await expect(preview).toBeVisible();
      const slider = preview.getByRole('slider');
      const sliderBox = (await slider.boundingBox())!;
      await page.mouse.click(sliderBox.x + sliderBox.width / 2, sliderBox.y + sliderBox.height / 2);
      // the source's colour bars (red on the left … cyan on the right) turned clockwise: red at the top, cyan at the bottom
      const canvasColor = async (fy: number) => preview.locator('canvas').evaluate((el, y) => {
        const canvas = el as HTMLCanvasElement;
        const { data } = canvas.getContext('2d')!.getImageData(Math.round(canvas.width / 2) - 2, Math.round(canvas.height * y) - 2, 4, 4);
        const [r, g, b] = [0, 1, 2].map((c) => [0, 1, 2, 3].reduce((acc, i) => acc + data[i * 16 + c]!, 0) / 4) as [number, number, number];
        if (r > 150 && g < 100 && b < 100) return 'red';
        if (r < 100 && g > 150 && b > 150) return 'cyan';
        return `other ${Math.round(r)},${Math.round(g)},${Math.round(b)}`;
      }, fy);
      await expect.poll(async () => canvasColor(0.08)).toBe('red');
      expect(await canvasColor(0.92)).toBe('cyan');
      await screenshot(page, '13b-turned-clip-live-preview');
      await textButton(page, 'Preview').click();
      const previewAnyway = page.getByRole('button', { name: 'Preview anyway' });
      const dialogTitle = page.getByText('Mix preview', { exact: true });
      await expect(previewAnyway.or(dialogTitle)).toBeVisible({ timeout: 60_000 });
      if (await previewAnyway.isVisible()) await previewAnyway.click();
      await expect(dialogTitle).toBeVisible({ timeout: 110_000 });
      const out = fileURLToPath(await page.getByRole('dialog').locator('video').evaluate((v) => (v as HTMLVideoElement).src));
      expect(ffprobe(out).streams.find((s) => s.codec_type === 'video')).toMatchObject({ width: 640, height: 360 });
      // a 100 px strip at the centre of the pillarboxed 9:16 clip (202x360 at x 219) against the source turned both ways
      const strip = ffmpegFrame(out, 1, 'crop=100:360:270:0');
      const turned = (transpose: string) => ffmpegFrame(media(file), start + 1, `${transpose},scale=202:360,crop=100:360:51:0`);
      const diff = (a: Buffer, b: Buffer) => a.reduce((acc, v, i) => acc + Math.abs(v - b[i]!), 0) / a.length;
      const clockwise = diff(strip, turned('transpose=clock'));
      const counterclockwise = diff(strip, turned('transpose=cclock'));
      expect(clockwise).toBeLessThan(25);
      expect(counterclockwise).toBeGreaterThan(2 * clockwise);
      await screenshot(page, '13c-turned-clip-preview');
      expect(ctx.consoleErrors).toEqual([]);
    } finally {
      await ctx.close();
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

test.describe('VideoMix (chains, always-visible sequence and maximum duration)', () => {
  test('14. linked clips share a slot, the sequence has its own, and the mix is cut at its maximum duration (E2, E4, E5, T39)', async () => {
    const ctx = await launchApp();
    const { page } = ctx;
    const workDir = mkdtempSync(join(tmpdir(), 'videomix-e2e-chains-'));
    try {
      // two vertical sources, so the chain and the sequence fit side by side in 16:9
      const sequenceFile = 'v-720x1280-silent-7s.mp4';
      await mockOpenDialog(ctx.app, [media(sourceFiles[2]!), media(sequenceFile)]);
      await page.getByTestId('add-sources').click();
      await expect(page.getByTestId('source-row')).toHaveCount(2);
      await expect.poll(async () => page.locator('video').first().evaluate((v) => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
      await waitIdle(page);

      // two clips of the first source that touch (0–5 s and 5–10 s): linked automatically, a chain of 2
      await pressShortcut(page, 'n');
      await seekBy(page, 5);
      await pressShortcut(page, 'n');
      await expect(clipRows(page)).toHaveCount(2);
      await expect(clipRows(page).nth(1)).toContainText('0:05 – 0:10');
      await expect(clipRows(page).nth(0).getByTestId('clip-link-indicator')).toHaveText('1/2');
      await expect(clipRows(page).nth(1).getByTestId('clip-link-indicator')).toHaveText('2/2');

      // the link can be broken and made again from its indicator (one undo step each)
      await clipRows(page).nth(1).getByTestId('clip-link-toggle').click();
      await expect(clipRows(page).nth(1).getByTestId('clip-unlinked-indicator')).toBeVisible();
      await expect(page.getByTestId('clip-link-indicator')).toHaveCount(0);
      await clipRows(page).nth(1).getByTestId('clip-unlinked-indicator').click();
      await expect(clipRows(page).nth(1).getByTestId('clip-link-indicator')).toHaveText('2/2');

      // a clip of the other source, dragged into the always-visible sequence
      await activateSource(page, 1, sequenceFile);
      await pressShortcut(page, 'n');
      await expect(clipRows(page)).toHaveCount(3);
      const section = page.getByTestId('sequence-section');
      await expect(section).toContainText('Drag clips here');
      const handle = (await page.getByTestId('clip-drag-handle').nth(2).boundingBox())!;
      const sectionBox = (await section.boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2, handle.y - 20, { steps: 5 });
      await page.mouse.move(handle.x + handle.width / 2, sectionBox.y + sectionBox.height / 2, { steps: 10 });
      await page.mouse.up();
      await expect(page.getByTestId('sequence-row')).toHaveCount(1);
      await expect(page.getByTestId('sequence-row')).toContainText('v-720x1280-silent-7s #1');
      await expect(clipRows(page).nth(2).getByTestId('clip-sequence-indicator')).toHaveText('1');
      // the list order doesn't change (once the drop animation's copy of the row is gone)
      await expect.poll(async () => clipNames(page)).toEqual(['v-1080x1920-12s #1', 'v-1080x1920-12s #2', 'v-720x1280-silent-7s #1']);
      await screenshot(page, '14a-chain-and-sequence-list');

      // the Mix view: the chain's clips one after the other in a lane, the sequence in another one
      await page.getByRole('button', { name: 'Mix', exact: true }).click();
      await expect(page.getByTestId('mix-plan-view')).toBeVisible();
      const blocks = page.getByTestId('mix-block');
      await expect(blocks).toHaveCount(3);
      const laneOf = async (clipName: string) => blocks.filter({ hasText: clipName }).evaluate((el) => el.parentElement!.getBoundingClientRect().top);
      expect(await laneOf('v-1080x1920-12s #1')).toBe(await laneOf('v-1080x1920-12s #2'));
      expect(await laneOf('v-720x1280-silent-7s #1')).not.toBe(await laneOf('v-1080x1920-12s #1'));
      await expect(blocks.filter({ hasText: 'v-1080x1920-12s #2' })).toHaveAttribute('data-linked', 'true');
      await expect(blocks.filter({ hasText: 'v-720x1280-silent-7s #1' })).toHaveAttribute('data-sequence', '1');
      // direct cut: the second block starts where the first one ends
      const edges = async (clipName: string) => blocks.filter({ hasText: clipName }).evaluate((el) => { const r = el.getBoundingClientRect(); return [r.left, r.right]; });
      const [, firstRight] = await edges('v-1080x1920-12s #1');
      const [secondLeft] = await edges('v-1080x1920-12s #2');
      expect(Math.abs(secondLeft! - firstRight!)).toBeLessThan(2);

      // maximum duration 0:06 (the mix lasts 10 s) and the global transition between linked clips
      await textButton(page, 'Settings').click();
      const dialog = page.getByTestId('mix-settings');
      await expect(dialog).toBeVisible();
      await dialog.getByText('Limit the length of the mix').locator('xpath=following-sibling::*[1]').click();
      const maxDuration = dialog.locator('label', { hasText: 'Maximum duration (m:ss)' }).locator('input');
      await maxDuration.fill('0:06');
      await maxDuration.press('Enter');
      await expect(dialog.getByTestId('links-max-gap')).toHaveValue('10');
      await dialog.getByTestId('links-transition').selectOption('global');
      await screenshot(page, '14b-settings');
      await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
      await expect(dialog).toBeHidden();

      // the Mix view ends at the cut; the cut clip tells why
      await expect(page.getByTestId('mix-truncated')).toContainText(/Cut at 0:06 \(−\d s\)/);
      await expect(blocks.filter({ hasText: 'v-1080x1920-12s #2' })).toHaveAttribute('title', /Cut at 0:06: the mix reaches its maximum duration/);
      // E3's estimate (the whole mix) tells where it's cut
      await expect(page.getByText('→ cut at 0:06')).toBeVisible();
      await screenshot(page, '14c-mix-view-cut');

      const projectPath = join(workDir, 'chains.vmx');
      await mockSaveDialog(ctx.app, projectPath);
      await pressShortcut(page, 'Control+s');
      await expect(page).toHaveTitle(/^chains - /);
      const saved = JSON5.parse(readFileSync(projectPath, 'utf8')) as { clips: { id: string, link?: string }[], settings: { maxDuration?: number, links: { maxGap: number, transition: string }, alwaysVisible: { clipIds: string[] } } };
      expect(saved.settings).toMatchObject({ maxDuration: 6, links: { maxGap: 10, transition: 'global' }, alwaysVisible: { clipIds: [saved.clips[2]!.id] } });
      // linked again by hand after breaking it: back to the automatic rule, nothing stored
      expect(saved.clips.map((c) => c.link)).toEqual([undefined, undefined, undefined]);

      // the preview asks first (the cut, with its seconds and the cut clip), then lasts exactly the limit
      await textButton(page, 'Preview').click();
      await expect(page.getByText('Check the mix before rendering')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole('dialog')).toContainText(/it is cut at 0:06 with the fade-out, \d s are left out/);
      await expect(page.getByRole('dialog')).toContainText('Clips cut: "v-1080x1920-12s #2"');
      await page.getByRole('button', { name: 'Preview anyway' }).click();
      const dialogTitle = page.getByText('Mix preview', { exact: true });
      await expect(dialogTitle).toBeVisible({ timeout: 110_000 });
      const out = fileURLToPath(await page.getByRole('dialog').locator('video').evaluate((v) => (v as HTMLVideoElement).src));
      const probe = ffprobe(out);
      expect(Number(probe.format.duration)).toBeCloseTo(6, 1);
      await screenshot(page, '14d-preview');
      expect(ctx.consoleErrors).toEqual([]);
    } finally {
      await ctx.close();
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

test.describe('VideoMix (preview conversion of unsupported sources)', () => {
  test('15. a saved project keeps the converted previews in its cache folder and reuses them (T42)', async () => {
    const ctx = await launchApp();
    const { page } = ctx;
    const workDir = mkdtempSync(join(tmpdir(), 'videomix-e2e-html5ify-'));
    try {
      // MPEG-4 Part 2, which Chromium can't play: loading it makes an ffmpeg-assisted preview ("fastest" dummy).
      // Two copies with the same name in different folders; copies, so nothing is written into test-media/.
      const fileName = 'mpeg4-640x360-5s.mkv';
      const [unsavedSource, savedSource] = ['a', 'b'].map((dir) => {
        mkdirSync(join(workDir, dir));
        const copy = join(workDir, dir, fileName);
        copyFileSync(media(fileName), copy);
        return copy;
      }) as [string, string];
      const convertedNextTo = (source: string) => readdirSync(join(source, '..')).filter((name) => name.startsWith('mpeg4-640x360-5s-html5ified-'));

      // Unsaved project: inherited behaviour, next to the source
      await mockOpenDialog(ctx.app, [unsavedSource]);
      await page.getByTestId('add-sources').click();
      await expect(page.getByTestId('source-row')).toHaveCount(1);
      await expect.poll(() => convertedNextTo(unsavedSource), { timeout: 30_000 }).toHaveLength(1);
      await waitIdle(page);
      const legacyPath = join(workDir, 'a', convertedNextTo(unsavedSource)[0]!);
      // the player shows the converted file
      await expect.poll(async () => playerSrc(page)).toBe(legacyPath);

      const projectPath = join(workDir, 'converted.vmx');
      await mockSaveDialog(ctx.app, projectPath);
      await pressShortcut(page, 'Control+s');
      await expect(page).toHaveTitle(/^converted - /);

      // Saved project: into .converted.vmx.cache/converted/<hash of the source path>/, not next to the source
      await mockOpenDialog(ctx.app, [savedSource]);
      await page.getByTestId('add-sources').click();
      await expect(page.getByTestId('source-row')).toHaveCount(2);
      const conversionDir = join(workDir, '.converted.vmx.cache', 'converted', createHash('sha256').update(savedSource).digest('hex').slice(0, 16));
      const convertedInCache = () => (existsSync(conversionDir) ? readdirSync(conversionDir) : []);
      await expect.poll(convertedInCache, { timeout: 30_000 }).toEqual(['mpeg4-640x360-5s-html5ified-dummy.mkv']);
      await waitIdle(page);
      expect(convertedNextTo(savedSource)).toEqual([]);
      const convertedPath = join(conversionDir, 'mpeg4-640x360-5s-html5ified-dummy.mkv');
      await expect.poll(async () => playerSrc(page)).toBe(convertedPath);
      // ctime changes with any write (the conversion also sets the mtime from the source)
      const convertedCtime = statSync(convertedPath).ctimeMs;
      const legacyCtime = statSync(legacyPath).ctimeMs;
      await screenshot(page, '15-converted-in-cache');

      // Reopen: the first source uses its old conversion (next to it), the second the cached one; nothing is converted
      await pressShortcut(page, 'Control+s');
      await expect(page).toHaveTitle(/^converted - /);
      await sendMenuAction(ctx.app, 'newProject');
      await expect(page.getByTestId('source-row')).toHaveCount(0);
      await mockOpenDialog(ctx.app, [projectPath]);
      await sendMenuAction(ctx.app, 'openProject');
      await expect(page.getByTestId('source-row')).toHaveCount(2);
      await expect.poll(async () => playerSrc(page)).toBe(legacyPath);
      await waitIdle(page);
      await page.getByTestId('source-row').nth(1).click();
      await expect.poll(async () => playerSrc(page)).toBe(convertedPath);
      await waitIdle(page);
      expect(convertedInCache()).toEqual(['mpeg4-640x360-5s-html5ified-dummy.mkv']);
      expect(statSync(convertedPath).ctimeMs).toBe(convertedCtime);
      expect(convertedNextTo(unsavedSource)).toHaveLength(1);
      expect(statSync(legacyPath).ctimeMs).toBe(legacyCtime);
      expect(convertedNextTo(savedSource)).toEqual([]);
      expect(ctx.consoleErrors).toEqual([]);
    } finally {
      await ctx.close();
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

test.describe('VideoMix (fit in fractions, magnet and "Fit to")', () => {
  test('16. the fit chips follow a drag, the magnet snaps an edge and "Fit to 1/2" fits 1/2 (F1, F2, T45)', async () => {
    const ctx = await launchApp();
    const { page } = ctx;
    try {
      await mockOpenDialog(ctx.app, [media(sourceFiles[0]!)]); // 1920x1080, as the default output
      await page.getByTestId('add-sources').click();
      await expect(page.getByTestId('source-row')).toHaveCount(1);
      await expect.poll(async () => page.locator('video').first().evaluate((v) => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
      await waitIdle(page);
      await pressShortcut(page, 'n');
      await expect(clipRows(page)).toHaveCount(1);
      const label = page.getByTestId('rect-label');
      await expect(label).toContainText('Max 1920×1080');

      // the whole frame fills the whole output; a rigid 16:9 is too wide for a half
      const chip = (fraction: string) => page.getByTestId(`fit-chip-${fraction}`);
      await expect(chip('full')).toHaveAttribute('data-status', 'fits');
      await expect(chip('1-2')).toHaveAttribute('data-status', 'no');
      await expect(chip('1-2')).toContainText('px over');
      // the clip list shows the same, compactly
      const rowFit = (fraction: string) => clipRows(page).first().getByTestId(`clip-fit-${fraction}`);
      await expect(rowFit('full')).toHaveAttribute('data-status', 'fits');
      await expect(rowFit('1-2')).toHaveCount(0);
      await screenshot(page, '16a-fit-chips');

      // screen x of a source x (the max is the whole frame)
      const eastBox = (await page.getByTestId('rect-handle-max-e').boundingBox())!;
      const westBox = (await page.getByTestId('rect-handle-max-w').boundingBox())!;
      const frameLeft = westBox.x + westBox.width / 2;
      const scale = (eastBox.x + eastBox.width / 2 - frameLeft) / 1920;
      const screenX = (sourceX: number) => frameLeft + sourceX * scale;
      const y = eastBox.y + eastBox.height / 2;
      /** Drags the right edge of the max from `from` to `to` (source px); `during` runs before releasing it. */
      const dragRightEdge = async (from: number, to: number, during?: () => Promise<void>) => {
        // the right edge of the frame is the edge of the player area: grab the half of the handle inside it
        await page.mouse.move(screenX(from) - (from === 1920 ? eastBox.width / 4 : 0), y);
        await page.mouse.down();
        await page.mouse.move(screenX((from + to) / 2), y, { steps: 5 });
        await page.mouse.move(screenX(to), y, { steps: 5 });
        await during?.();
        await page.mouse.up();
      };

      // magnet off (the default): the chips change during the drag, the edge stays where it's dropped
      const magnet = page.getByTestId('fit-magnet-toggle');
      await expect(magnet).toHaveAttribute('aria-pressed', 'false');
      // (the whole output only by showing more of the source than the max: E7 is on by default)
      await dragRightEdge(1920, 1100, async () => {
        await expect(chip('full')).toHaveAttribute('data-status', 'extends');
      });
      await expect(label).toContainText(/Max 1(0[89]\d|1[01]\d)×1080/);
      await expect(rowFit('full')).toHaveAttribute('data-status', 'extends');
      // without E7 it doesn't fit: the chip says by how much
      await clipRows(page).first().getByTestId('clip-extend-toggle').click();
      await expect(chip('full')).toHaveAttribute('data-status', 'no');
      await expect(chip('full')).toContainText('px short');
      await expect(rowFit('full')).toHaveCount(0);

      // magnet on: dropped 6 px (a few screen px) off a third, the edge snaps to exactly 640 px (1/3 of 1920×1080)
      await magnet.click();
      await expect(magnet).toHaveAttribute('aria-pressed', 'true');
      const maxWidth = async () => Number(/Max (\d+)×/.exec((await label.textContent()) ?? '')?.[1]);
      await dragRightEdge(await maxWidth(), 646, async () => {
        await expect(chip('1-3')).toHaveAttribute('data-status', 'fits');
      });
      await expect(label).toContainText('Max 640×1080');
      await expect(chip('1-3')).toHaveAttribute('data-status', 'fits');
      await expect(rowFit('1-3')).toHaveAttribute('data-status', 'fits');
      await screenshot(page, '16b-magnet');
      // …and holding Alt turns it off for that drag
      await dragRightEdge(640, 800);
      await page.keyboard.down('Alt');
      await dragRightEdge(await maxWidth(), 648);
      await page.keyboard.up('Alt');
      expect(await maxWidth()).not.toBe(640);
      expect(Math.abs(await maxWidth() - 648)).toBeLessThan(6);
      // the toggle is an app preference, saved at once
      expect(JSON.parse(readFileSync(join(ctx.configDir, 'config.json'), 'utf8'))).toMatchObject({ fitMagnet: true });

      // "Fit to 1/2": exactly half the output, one undo step
      const before = await maxWidth();
      await page.getByTestId('fit-to-1-2').click();
      await expect(label).toContainText('Max 960×1080');
      await expect(chip('1-2')).toHaveAttribute('data-status', 'fits');
      await expect(rowFit('1-2')).toHaveAttribute('data-status', 'fits');
      await screenshot(page, '16c-fit-to-half');
      await pressShortcut(page, 'Control+z');
      await expect(label).toContainText(`Max ${before}×1080`);
      expect(ctx.consoleErrors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('VideoMix (copy/paste framing)', () => {
  test('17. copy a clip\'s framing and paste it on two selected clips of another source, scaled, with a warning on another proportion (A5, T46)', async () => {
    const ctx = await launchApp();
    const { page } = ctx;
    try {
      // source 1 (1920×1080), source 2 (1280×720, same 16:9), source 3 (1080×1920, another proportion)
      await mockOpenDialog(ctx.app, sourceFiles.map((f) => media(f)));
      await page.getByTestId('add-sources').click();
      await expect(page.getByTestId('source-row')).toHaveCount(3);
      await expect.poll(async () => page.locator('video').first().evaluate((v) => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
      await waitIdle(page);

      // clip #1 on source 1, its max shrunk to about half width by dragging the right edge
      await pressShortcut(page, 'n');
      await expect(clipRows(page)).toHaveCount(1);
      const label = page.getByTestId('rect-label');
      await expect(label).toContainText('Max 1920×1080');
      const maxWidth = async () => Number(/Max (\d+)×/.exec((await label.textContent()) ?? '')?.[1]);
      const east = page.getByTestId('rect-handle-max-e');
      const west = page.getByTestId('rect-handle-max-w');
      const eastBox = (await east.boundingBox())!;
      const westBox = (await west.boundingBox())!;
      const frameWidth = eastBox.x - westBox.x;
      const grab = { x: eastBox.x + eastBox.width * 0.25, y: eastBox.y + eastBox.height / 2 };
      await page.mouse.move(grab.x, grab.y);
      await page.mouse.down();
      await page.mouse.move(grab.x - frameWidth / 4, grab.y, { steps: 5 });
      await page.mouse.up();
      const copiedWidth = await maxWidth();
      await expect(label).toContainText(`Max ${copiedWidth}×1080`);
      expect(copiedWidth).toBeLessThan(1920);

      // Copy framing (clip menu / Ctrl+Shift+C)
      await pressShortcut(page, 'Control+Shift+c');

      // source 2: 2 clips, both selected (Ctrl-click adds to the selection), pasted as one undo step
      await activateSource(page, 1, sourceFiles[1]!);
      await seekBy(page, 1);
      await pressShortcut(page, 'i');
      await seekBy(page, 1);
      await pressShortcut(page, 'o');
      await seekBy(page, 1);
      await pressShortcut(page, 'i');
      await seekBy(page, 1);
      await pressShortcut(page, 'o');
      await expect(clipRows(page)).toHaveCount(3);
      const clip2a = clipRows(page).nth(1);
      const clip2b = clipRows(page).nth(2);
      await clip2a.getByText('0:01 – 0:02').click();
      await expect(label).toContainText('Max 1280×720');
      await clip2b.getByText('0:03 – 0:04').click({ modifiers: ['Control'] });
      await pressShortcut(page, 'Control+Shift+v');

      // both scaled the same way (source 2 is 1280×720, 2/3 the width of source 1): no warning
      const swalToast = page.locator('.swal2-toast');
      await expect(swalToast).toHaveCount(0);
      await clip2a.getByText('0:01 – 0:02').click();
      await expect(label).toContainText(/Max \d+×720/);
      const pastedWidth = await maxWidth();
      expect(pastedWidth).toBeGreaterThan(copiedWidth * (1280 / 1920) - 20);
      expect(pastedWidth).toBeLessThan(copiedWidth * (1280 / 1920) + 20);
      await clip2b.getByText('0:03 – 0:04').click();
      await expect(label).toContainText(`Max ${pastedWidth}×720`);
      await screenshot(page, '17a-pasted-framing');

      // one undo step reverts both
      await pressShortcut(page, 'Control+z');
      await expect(label).toContainText('Max 1280×720');
      await clip2a.getByText('0:01 – 0:02').click();
      await expect(label).toContainText('Max 1280×720');

      // source 3 (another proportion): pasting fits the framing into the frame and warns
      await activateSource(page, 2, sourceFiles[2]!);
      await pressShortcut(page, 'n');
      await expect(clipRows(page)).toHaveCount(4);
      // clicked explicitly (not just relying on it being auto-selected): clears any leftover multi-selection from
      // source 2, so the paste below targets only this clip
      await clipRows(page).nth(3).getByText('0:00 – 0:05').click();
      await expect(label).toContainText('Max 1080×1920');
      await pressShortcut(page, 'Control+Shift+v');
      await expect(swalToast).toBeVisible();
      await expect(swalToast).toContainText('another proportion');
      const [, pastedOtherWidth, pastedOtherHeight] = /Max (\d+)×(\d+)/.exec((await label.textContent()) ?? '') ?? [];
      expect(Number(pastedOtherWidth)).toBeLessThanOrEqual(1080);
      expect(Number(pastedOtherHeight)).toBeLessThanOrEqual(1920);
      // keeps the copied framing's own proportion (not the frame's)
      expect(Number(pastedOtherWidth) / Number(pastedOtherHeight)).toBeCloseTo(copiedWidth / 1080, 1);
      await screenshot(page, '17b-pasted-framing-other-proportion');

      expect(ctx.consoleErrors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('VideoMix (black bars)', () => {
  test('18. a source with black bars gets a bar-free new clip once detected, and the button removes them from an existing one (A7, T47)', async () => {
    const ctx = await launchApp();
    const { page } = ctx;
    try {
      // 1280×960, content 1280×720 letterboxed (top/bottom bars of 120 px, generateTestMedia.ts)
      await mockOpenDialog(ctx.app, [media('h-bars-1280x960-6s.mp4')]);
      await page.getByTestId('add-sources').click();
      await expect(page.getByTestId('source-row')).toHaveCount(1);
      await expect.poll(async () => page.locator('video').first().evaluate((v) => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
      await waitIdle(page);

      const label = page.getByTestId('rect-label');

      // autoCropBlackBars (on by default): the per-source detection runs in the background (T47 point 2); until it's
      // done, a new clip is born as before (the whole frame) — so retry "n" (undoing a premature one) until it isn't.
      await expect.poll(async () => {
        await pressShortcut(page, 'n');
        const text = (await label.textContent()) ?? '';
        if (text.includes('Max 1280×720')) return true;
        await pressShortcut(page, 'Control+z');
        return false;
      }, { timeout: 20_000, intervals: [400] }).toBe(true);
      await expect(clipRows(page)).toHaveCount(1);
      await screenshot(page, '18a-clip-without-bars');

      // turn autoCropBlackBars off: a new clip is now born with the bars
      await textButton(page, 'Settings').click();
      const dialog = page.getByTestId('mix-settings');
      await expect(dialog).toBeVisible();
      await page.getByTestId('auto-crop-black-bars').click();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      await pressShortcut(page, 'n');
      await expect(clipRows(page)).toHaveCount(2);
      await expect(label).toContainText('Max 1280×960');

      // "Remove black bars" (A7 point 1): analyzes this clip's own range and cuts the max to the picture found
      await page.getByTestId('remove-black-bars').click();
      await waitIdle(page);
      await expect(label).toContainText('Max 1280×720');
      await screenshot(page, '18b-remove-black-bars-button');

      // nothing left to remove: a warning toast, the max unchanged
      await page.getByTestId('remove-black-bars').click();
      await waitIdle(page);
      await expect(page.locator('.swal2-toast')).toContainText('No black bars found in this clip');
      await expect(label).toContainText('Max 1280×720');

      expect(ctx.consoleErrors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('VideoMix (framing keyframes)', () => {
  test('19. "Animate" and auto-key pan the max between two instants: marks, interpolation, prev/next and the live preview (A9, T49)', async () => {
    const ctx = await launchApp();
    const { page } = ctx;
    try {
      // 1280×720 SMPTE colour bars: still, so the live preview only changes with the framing
      await mockOpenDialog(ctx.app, [media(sourceFiles[1]!)]);
      await page.getByTestId('add-sources').click();
      await expect(page.getByTestId('source-row')).toHaveCount(1);
      await expect.poll(async () => page.locator('video').first().evaluate((v) => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
      await waitIdle(page);
      await pressShortcut(page, 'n');
      await expect(clipRows(page)).toHaveCount(1);
      const label = page.getByTestId('rect-label');
      await expect(label).toContainText('Max 1280×720');

      // T49 item 6: the toolbar is in a strip above the picture, clear of the max's top handles and its label
      const toolbarBox = (await page.getByTestId('rect-toolbar-slot').boundingBox())!;
      expect(toolbarBox.height).toBeGreaterThan(10);
      for (const handle of ['nw', 'n', 'ne']) {
        expect((await page.getByTestId(`rect-handle-max-${handle}`).boundingBox())!.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height - 6);
      }
      expect((await label.boundingBox())!.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height);

      // screen x of the frame's edges (the max is the whole frame)
      const handleCenter = async (handle: string) => {
        const box = (await page.getByTestId(`rect-handle-max-${handle}`).boundingBox())!;
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      };
      const frameLeft = (await handleCenter('w')).x;
      const scale = ((await handleCenter('e')).x - frameLeft) / 1280;
      /** The max's left edge, in source px. */
      const maxLeft = async () => ((await handleCenter('w')).x - frameLeft) / scale;
      /** Drags the max (by its middle) `dx` screen px. */
      const dragMax = async (dx: number) => {
        const n = await handleCenter('n');
        const s = await handleCenter('s');
        const from = { x: n.x, y: (n.y + s.y) / 2 };
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + dx / 2, from.y, { steps: 5 });
        await page.mouse.move(from.x + dx, from.y, { steps: 5 });
        await page.mouse.up();
      };

      // half the output (640×720 in the middle), then "Animate" at 1 s: the first keyframe, with that framing
      await page.getByTestId('fit-to-1-2').click();
      await expect(label).toContainText('Max 640×720');
      await seekBy(page, 1);
      const animate = page.getByTestId('animate-toggle');
      await expect(animate).toHaveAttribute('aria-pressed', 'false');
      await animate.click();
      await expect(animate).toHaveAttribute('aria-pressed', 'true');
      const marks = page.getByTestId('clip-keyframe-mark');
      await expect(marks).toHaveCount(1);
      await expect(page.getByTestId('keyframe-interpolation')).toHaveValue('smooth');

      // at 1 s the max goes to the left edge (updates that keyframe), at 3 s to the right edge (a new one)
      await dragMax(-1000);
      await expect.poll(maxLeft).toBeCloseTo(0, -1);
      await expect(marks).toHaveCount(1);
      await seekBy(page, 2);
      // after the last keyframe it holds
      await expect.poll(maxLeft).toBeCloseTo(0, -1);
      await expect(page.getByTestId('keyframe-add')).toBeVisible();
      await dragMax(1000);
      await expect.poll(maxLeft).toBeCloseTo(640, -1);
      await expect(marks).toHaveCount(2);
      // the proportion and the size don't change
      await expect(label).toContainText('Max 640×720');
      await screenshot(page, '19a-keyframes');

      // one undo step per gesture
      await pressShortcut(page, 'Control+z');
      await expect(marks).toHaveCount(1);
      await pressShortcut(page, 'Control+Shift+z');
      await expect(marks).toHaveCount(2);

      // the editor shows the interpolated framing at the cursor: half way at 2 s (smooth)…
      await seekBy(page, -1);
      await expect.poll(maxLeft).toBeCloseTo(320, -1);
      // …or still at the first keyframe's with "hold" (going there with "previous keyframe" to change it)
      await page.getByTestId('keyframe-prev').click();
      await expect.poll(async () => playerTime(page)).toBeCloseTo(1, 1);
      await page.getByTestId('keyframe-interpolation').selectOption('hold');
      await seekBy(page, 1);
      await expect.poll(maxLeft).toBeCloseTo(0, -1);
      await page.getByTestId('keyframe-next').click();
      await expect.poll(async () => playerTime(page)).toBeCloseTo(3, 1);
      await expect.poll(maxLeft).toBeCloseTo(640, -1);

      // the live preview uses the animated crop: the left bars (grey, yellow, cyan, green) at 2 s, the right ones
      // (green, magenta, red, blue) at 3.5 s. Without E7 (on by default), which would show the whole frame here.
      await clipRows(page).first().getByTestId('clip-extend-toggle').click();
      await page.getByRole('button', { name: 'Mix', exact: true }).click();
      const preview = page.getByTestId('mix-live-preview');
      await expect(preview).toBeVisible();
      const slider = preview.getByRole('slider');
      await expect.poll(async () => Number(await slider.getAttribute('aria-valuemax'))).toBeGreaterThan(4);
      const duration = Number(await slider.getAttribute('aria-valuemax'));
      const sliderBox = (await slider.boundingBox())!;
      /** The share of green in the canvas, once its frame is drawn (bright, and the same a moment later). */
      const settledGreenShare = async () => {
        const measure = async () => preview.locator('canvas').evaluate((el) => {
          const canvas = el as HTMLCanvasElement;
          const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
          const sum = [0, 0, 0];
          for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c += 1) sum[c]! += data[i + c]!;
          const total = sum[0]! + sum[1]! + sum[2]!;
          return { green: sum[1]! / Math.max(1, total), brightness: total / (3 * (data.length / 4)) };
        });
        let share = 0;
        await expect.poll(async () => {
          const a = await measure();
          await page.waitForTimeout(300);
          const b = await measure();
          share = b.green;
          return b.brightness > 50 && Math.abs(a.green - b.green) < 0.005;
        }).toBe(true);
        return share;
      };
      const seekPreview = async (time: number) => {
        await page.mouse.click(sliderBox.x + (sliderBox.width * time) / duration, sliderBox.y + sliderBox.height / 2);
        await expect.poll(async () => Number(await slider.getAttribute('aria-valuenow'))).toBeCloseTo(time, 0);
      };
      await seekPreview(2);
      const left = await settledGreenShare();
      await screenshot(page, '19b-live-preview-left');
      await seekPreview(3.5);
      const right = await settledGreenShare();
      await screenshot(page, '19c-live-preview-right');
      console.log('Live preview green share (left, right):', left, right);
      expect(left - right).toBeGreaterThan(0.1);

      // back to the source: turning "Animate" off asks, removes the keyframes and keeps the framing at the cursor
      await page.getByRole('button', { name: 'Source', exact: true }).click();
      await expect(marks).toHaveCount(2);
      await animate.click();
      await page.getByRole('button', { name: 'Remove keyframes' }).click();
      await expect(animate).toHaveAttribute('aria-pressed', 'false');
      await expect(marks).toHaveCount(0);
      await expect(label).toContainText('Max 640×720');
      expect(ctx.consoleErrors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('VideoMix (Mix view rows and zoom)', () => {
  test('22. columns that don\'t coincide share a row, and the Mix view zooms and scrolls, following the cursor (G3, A3, T53)', async () => {
    const ctx = await launchApp();
    const { page } = ctx;
    const workDir = mkdtempSync(join(tmpdir(), 'videomix-e2e-lanes-'));
    try {
      // a clip of each shape (square, vertical, horizontal), saved and multiplied in the file below
      const files = ['sq-1080-6s.mp4', sourceFiles[2]!, sourceFiles[0]!];
      await mockOpenDialog(ctx.app, files.map((f) => media(f)));
      await page.getByTestId('add-sources').click();
      await expect(page.getByTestId('source-row')).toHaveCount(3);
      await waitIdle(page);
      for (const [i, file] of files.entries()) {
        // eslint-disable-next-line no-await-in-loop
        await activateSource(page, i, file);
        // eslint-disable-next-line no-await-in-loop
        await pressShortcut(page, 'n');
        // eslint-disable-next-line no-await-in-loop
        await expect(clipRows(page)).toHaveCount(i + 1);
      }
      const projectPath = join(workDir, 'lanes.vmx');
      await mockSaveDialog(ctx.app, projectPath);
      await pressShortcut(page, 'Control+s');
      await expect(page).toHaveTitle(/^lanes - /);

      // 12 clips whose plan re-lays out the columns several times: the planner opens a new column id each time (square,
      // vertical and horizontal clips of 2–6 s; not linked, so each one is a clip of its own)
      const saved = JSON5.parse(readFileSync(projectPath, 'utf8')) as { clips: (SavedProject['clips'][number] & { link?: string })[] };
      const templates = { S: saved.clips[0]!, V: saved.clips[1]!, H: saved.clips[2]! };
      const spec = ['V4', 'S2', 'V4', 'H4', 'V5', 'V3', 'V4', 'H6', 'V6', 'V3', 'V5', 'V5'];
      saved.clips = spec.map((s, i) => ({ ...templates[s[0] as 'S' | 'V' | 'H'], id: `lane-clip-${i}`, name: `${s} #${i + 1}`, start: 0, end: Number(s.slice(1)), link: 'break' }));
      writeFileSync(projectPath, JSON5.stringify(saved, null, 2));
      await sendMenuAction(ctx.app, 'newProject');
      await expect(page.getByTestId('source-row')).toHaveCount(0);
      await mockOpenDialog(ctx.app, [projectPath]);
      await sendMenuAction(ctx.app, 'openProject');
      await expect.poll(async () => clipNames(page)).toHaveLength(12);
      await waitIdle(page);

      await page.getByRole('button', { name: 'Mix', exact: true }).click();
      const blocks = page.getByTestId('mix-block');
      await expect(blocks).toHaveCount(12);
      const lanes = page.getByTestId('mix-lane');
      const laneColumns = (await lanes.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset['columns']!.split(',')))) as string[][];
      const columnIds = laneColumns.flat();
      console.log('Mix view lanes (column ids):', JSON.stringify(laneColumns));
      // before T53, a row per column id; now no more rows than the 3 columns shown at once
      expect(new Set(columnIds).size).toBe(columnIds.length);
      expect(columnIds.length).toBeGreaterThanOrEqual(5);
      expect(laneColumns.length).toBeLessThanOrEqual(3);
      // no two blocks of a row overlap (beyond a crossfade)
      for (const lane of await lanes.all()) {
        // eslint-disable-next-line no-await-in-loop
        const spans = (await lane.getByTestId('mix-block').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [r.left, r.right]; }))).sort((a, b) => a[0]! - b[0]!);
        spans.slice(1).forEach(([left], i) => expect(left!).toBeGreaterThan(spans[i]![0]!));
      }
      // clicking a block of a shared row selects its clip
      const sharedLane = lanes.nth(laneColumns.findIndex((c) => c.length > 1));
      const lastBlock = sharedLane.getByTestId('mix-block').last();
      const clipId = await lastBlock.getAttribute('data-clip-id');
      await lastBlock.click();
      await expect(blocks.and(page.locator(`[data-clip-id="${clipId}"]`))).toHaveAttribute('data-selected', 'true');
      await screenshot(page, '22a-mix-view-compact-rows');

      const scroller = page.getByTestId('mix-lanes-scroller');
      const lanesArea = page.getByTestId('mix-lanes');
      const zoomOf = async () => Number(await scroller.getAttribute('data-zoom'));
      const widthRatio = async () => (await lanesArea.evaluate((el) => el.getBoundingClientRect().width)) / (await scroller.evaluate((el) => el.clientWidth));
      const scrollLeft = async () => scroller.evaluate((el) => el.scrollLeft);
      await expect(page.getByTestId('mix-zoom-fit')).toBeDisabled();
      await expect(page.getByTestId('mix-zoom-out')).toBeDisabled();
      expect(await widthRatio()).toBeCloseTo(1, 2);

      // + twice: 1.5 × 1.5, around the middle of the view
      await page.getByTestId('mix-zoom-in').click();
      await page.getByTestId('mix-zoom-in').click();
      await expect.poll(zoomOf).toBeCloseTo(2.25, 2);
      expect(await widthRatio()).toBeCloseTo(2.25, 1);
      const middleFraction = await scroller.evaluate((el) => (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth);
      expect(middleFraction).toBeCloseTo(0.5, 2);
      await screenshot(page, '22b-mix-view-zoomed');

      // the wheel scrolls sideways
      const box = (await scroller.boundingBox())!;
      const mouse = { x: box.x + box.width * 0.3, y: box.y + 30 };
      await page.mouse.move(mouse.x, mouse.y);
      const before = await scrollLeft();
      await page.mouse.wheel(0, 200);
      await expect.poll(scrollLeft).toBeCloseTo(before + 200, 0);

      // Ctrl + wheel zooms, keeping the time under the mouse
      const fractionAtMouse = async () => lanesArea.evaluate((el, x) => { const r = el.getBoundingClientRect(); return (x - r.left) / r.width; }, mouse.x);
      const fraction = await fractionAtMouse();
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -300);
      await page.keyboard.up('Control');
      await expect.poll(zoomOf).toBeGreaterThan(3.5);
      expect(await fractionAtMouse()).toBeCloseTo(fraction, 2);
      // and back out
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, 300);
      await page.keyboard.up('Control');
      await expect.poll(zoomOf).toBeCloseTo(2.25, 1);

      // the time axis and the lanes scroll together
      const axisLeft = async () => page.getByTestId('mix-time-axis').evaluate((el) => el.getBoundingClientRect().left);
      expect(await axisLeft()).toBeCloseTo(await lanesArea.evaluate((el) => el.getBoundingClientRect().left), 0);

      // playing with zoom, the view follows the cursor: from the start, zoomed in to a few seconds
      for (let i = 0; i < 4; i += 1) await page.getByTestId('mix-zoom-in').click(); // eslint-disable-line no-await-in-loop
      await scroller.evaluate((el) => el.scrollTo({ left: 0 }));
      const axis = page.getByTestId('mix-time-axis');
      const axisBox = (await axis.boundingBox())!;
      await page.mouse.click(axisBox.x + 2, axisBox.y + axisBox.height / 2);
      await expect.poll(scrollLeft).toBe(0);
      const preview = page.getByTestId('mix-live-preview');
      await preview.getByTitle('Play').click();
      await expect.poll(scrollLeft, { timeout: 20_000 }).toBeGreaterThan(0);
      const cursorInView = async () => page.getByTestId('mix-cursor').evaluate((el) => {
        const r = el.getBoundingClientRect();
        const s = document.querySelector('[data-testid="mix-lanes-scroller"]')!.getBoundingClientRect();
        return r.left >= s.left && r.left <= s.right;
      });
      expect(await cursorInView()).toBe(true);
      await preview.getByTitle('Pause').click();
      await screenshot(page, '22c-mix-view-following');

      // Fit: the whole mix again
      await page.getByTestId('mix-zoom-fit').click();
      await expect.poll(zoomOf).toBe(1);
      expect(await widthRatio()).toBeCloseTo(1, 2);
      expect(await scrollLeft()).toBe(0);
      expect(ctx.consoleErrors).toEqual([]);
    } finally {
      await ctx.close();
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

test.describe('VideoMix (shortcuts with the focus on a button)', () => {
  test('21. Ctrl+Z / Ctrl+Shift+Z undo and redo right after clicking buttons: rect editor bar, keyframes, clip list and Mix view (G4, T51)', async () => {
    const ctx = await launchApp();
    const { page } = ctx;
    try {
      await mockOpenDialog(ctx.app, [media(sourceFiles[0]!)]); // 1920×1080
      await page.getByTestId('add-sources').click();
      await expect(page.getByTestId('source-row')).toHaveCount(1);
      await expect.poll(async () => page.locator('video').first().evaluate((v) => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
      await waitIdle(page);
      await pressShortcut(page, 'n');
      await expect(clipRows(page)).toHaveCount(1);
      const label = page.getByTestId('rect-label');
      await expect(label).toContainText('Max 1920×1080');

      // the editor bar: the clicked button keeps the focus (the bug: the shortcuts only worked on the body)
      const fitHalf = page.getByTestId('fit-to-1-2');
      await fitHalf.click();
      await expect(label).toContainText('Max 960×1080');
      await expect(fitHalf).toBeFocused();
      await pressShortcut(page, 'Control+z');
      await expect(label).toContainText('Max 1920×1080');
      await pressShortcut(page, 'Control+Shift+z');
      await expect(label).toContainText('Max 960×1080');
      // Space on a focused button is the button's (here "Fit to 1/2" again, a no-op), not "play"
      await expect(fitHalf).toBeFocused();
      await page.keyboard.press('Space');
      await page.waitForTimeout(300);
      expect(await page.locator('video').first().evaluate((v) => (v as HTMLVideoElement).paused)).toBe(true);
      // arrow key nudges of the focused rect overlay: one undo step
      const handleX = async (handle: string) => {
        const handleBox = (await page.getByTestId(`rect-handle-max-${handle}`).boundingBox())!;
        return handleBox.x + handleBox.width / 2;
      };
      const westX = await handleX('w');
      const northBox = (await page.getByTestId('rect-handle-max-n').boundingBox())!;
      await page.mouse.click(northBox.x + northBox.width / 2, northBox.y + 60);
      await expect(page.getByTestId('rect-overlay')).toBeFocused();
      for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowLeft');
      await expect.poll(async () => handleX('w')).toBeLessThan(westX - 1);
      await pressShortcut(page, 'Control+z');
      await expect.poll(async () => handleX('w')).toBeCloseTo(westX, 0);
      await pressShortcut(page, 'Control+z');
      await expect(label).toContainText('Max 1920×1080');

      await page.getByTestId('rotate-clip-cw').click();
      await expect(page.getByTestId('clip-rotation')).toHaveText('90°');
      await pressShortcut(page, 'Control+z');
      await expect(page.getByTestId('clip-rotation')).toHaveCount(0);

      // keyframes: "Animate", add and remove one, each undone with the focus on its button
      const animate = page.getByTestId('animate-toggle');
      const marks = page.getByTestId('clip-keyframe-mark');
      await animate.click();
      await expect(animate).toHaveAttribute('aria-pressed', 'true');
      await expect(marks).toHaveCount(1);
      await pressShortcut(page, 'Control+z');
      await expect(animate).toHaveAttribute('aria-pressed', 'false');
      await expect(marks).toHaveCount(0);
      await pressShortcut(page, 'Control+Shift+z');
      await expect(marks).toHaveCount(1);
      await seekBy(page, 1);
      await page.getByTestId('keyframe-add').click();
      await expect(marks).toHaveCount(2);
      await pressShortcut(page, 'Control+z');
      await expect(marks).toHaveCount(1);
      await pressShortcut(page, 'Control+Shift+z');
      await expect(marks).toHaveCount(2);
      await page.getByTestId('keyframe-remove').click();
      await expect(marks).toHaveCount(1);
      await pressShortcut(page, 'Control+z');
      await expect(marks).toHaveCount(2);

      // the clip list: mute (the focus stays on the clip's row)
      const row = clipRows(page).first();
      await row.getByRole('button', { name: 'Mute clip', exact: true }).click();
      await expect(row.getByRole('button', { name: 'Unmute clip', exact: true })).toBeVisible();
      await pressShortcut(page, 'Control+z');
      await expect(row.getByRole('button', { name: 'Mute clip', exact: true })).toBeVisible();

      // the Mix view: dragging a block pins its clip (the focus is on its lane)
      await page.getByRole('button', { name: 'Mix', exact: true }).click();
      const block = page.getByTestId('mix-block').first();
      await expect(block).toBeVisible();
      await expect(block).not.toHaveAttribute('title', /Pinned/);
      const box = (await block.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 });
      await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
      await expect(block).toHaveAttribute('title', /Pinned/);
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
      await pressShortcut(page, 'Control+z');
      await expect(block).not.toHaveAttribute('title', /Pinned/);
      await pressShortcut(page, 'Control+Shift+z');
      await expect(block).toHaveAttribute('title', /Pinned/);

      // …and adding an overlay with its button
      const planView = page.getByTestId('mix-plan-view');
      await planView.getByRole('button', { name: 'Add countdown' }).click();
      await expect(planView.getByTestId('overlay-block')).toHaveCount(1);
      await pressShortcut(page, 'Control+z');
      await expect(planView.getByTestId('overlay-block')).toHaveCount(0);

      // a slider drag in the settings is one undo step (React's onChange fired, and committed, on every move)
      await textButton(page, 'Settings').click();
      const dialog = page.getByTestId('mix-settings');
      const crfLabel = dialog.locator('label', { hasText: 'Quality (CRF)' });
      const crfText = (await crfLabel.textContent())!;
      const sliderBox = (await crfLabel.locator('input[type="range"]').boundingBox())!;
      const sliderY = sliderBox.y + sliderBox.height / 2;
      await page.mouse.move(sliderBox.x + sliderBox.width * 0.5, sliderY);
      await page.mouse.down();
      await page.mouse.move(sliderBox.x + sliderBox.width * 0.3, sliderY, { steps: 5 });
      await page.mouse.move(sliderBox.x + sliderBox.width * 0.1, sliderY, { steps: 5 });
      await page.mouse.up();
      await expect(crfLabel).not.toHaveText(crfText);
      await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
      await expect(dialog).toBeHidden();
      await pressShortcut(page, 'Control+z');
      await textButton(page, 'Settings').click();
      await expect(crfLabel).toHaveText(crfText);
      await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
      expect(ctx.consoleErrors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('VideoMix (Spanish UI)', () => {
  test('10. the UI is in Spanish', async () => {
    const ctx = await launchApp({ language: 'es' });
    const { page } = ctx;
    try {
      await expect(page).toHaveTitle(/^Proyecto sin título - VideoMix/);
      await expect(page.getByTestId('source-list')).toContainText('Fuentes');
      await expect(page.getByRole('button', { name: 'Fuente', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Montaje', exact: true })).toBeVisible();
      await expect(textButton(page, 'Ajustes')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Vista previa', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Renderizar', exact: true })).toBeVisible();

      await mockOpenDialog(ctx.app, [media(sourceFiles[0]!)]);
      await page.getByTestId('add-sources').click();
      await expect(page.getByTestId('source-row')).toHaveCount(1);
      await expect(page.getByTestId('source-row')).toContainText('0 clips');
      await expect.poll(async () => page.locator('video').first().evaluate((v) => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
      await pressShortcut(page, 'n');
      await expect(page.getByTestId('clip-row')).toHaveCount(1);
      await expect(page.getByTestId('clip-list')).toContainText('Clips (1)');
      await expect(page.getByTestId('rect-label')).toContainText('Máx. 1920×1080');

      await textButton(page, 'Ajustes').click();
      const dialog = page.getByTestId('mix-settings');
      await expect(dialog).toContainText('Ajustes de montaje');
      await expect(dialog).toContainText('Salida');
      await expect(dialog).toContainText('Composición');
      await expect(dialog).toContainText('Transición');
      await expect(dialog).toContainText('Música');
      await screenshot(page, '10-es-settings');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      await page.getByRole('button', { name: 'Montaje', exact: true }).click();
      const planView = page.getByTestId('mix-plan-view');
      await expect(planView.getByRole('button', { name: 'Añadir cuenta atrás' })).toBeVisible();
      await expect(planView.getByRole('button', { name: 'Añadir texto' })).toBeVisible();
      await expect(page.getByTestId('mix-live-preview')).toContainText('Previsualización en vivo aproximada');
      await screenshot(page, '10-es-mix');

      // No English leftovers in the main panels
      for (const text of ['Sources', 'Add countdown', 'Approximate live preview']) await expect(page.getByText(text, { exact: false })).toHaveCount(0);
      expect(ctx.consoleErrors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});
