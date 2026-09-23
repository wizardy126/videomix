import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSON5 from 'json5';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import type { LaunchedApp } from './app.ts';
import { ffprobe, launchApp, media, mockOpenDialog, mockSaveDialog, pressShortcut, screenshot, sendMenuAction } from './app.ts';

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
    for (let i = 0; i < Math.abs(remaining); i += 1) await pressShortcut(page, remaining > 0 ? 'ArrowRight' : 'ArrowLeft');
    await expect.poll(async () => playerTime(page), { timeout: 2000 }).toBeCloseTo(target, 1);
  }).toPass({ timeout: 15_000 });
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
    await pressShortcut(page, 'i');
    await seekBy(page, 2);
    await pressShortcut(page, 'o');
    await expect(clipRows(page)).toHaveCount(1);
    await expect(clipRows(page).nth(0)).toContainText('0:00 – 0:02');

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
    await screenshot(page, '08a-preview-dialog');
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialogTitle).toBeHidden();

    // the analysis is cached: the live preview plays normalized levels now, like the render (≈ −18 dBFS RMS here,
    // ≈ 0.12, instead of 0.02–0.04 before)
    await expect(preview).not.toContainText('Audio levels are not normalized');
    const slider = preview.getByRole('slider');
    const sliderBox = (await slider.boundingBox())!;
    const seekTo = async (fraction: number) => page.mouse.click(sliderBox.x + sliderBox.width * fraction, sliderBox.y + sliderBox.height / 2);
    // two clips at once (≈ 1.9–3.5 s)
    await seekTo(0.4);
    await preview.getByTitle('Play').click();
    const twoClips = (await measurePeakRms(page, 1000)).peak;
    await preview.getByTitle('Pause').click();
    // then (paused seek, play) where only the vertical clip plays, ≈ 7.5 s into its source: 7 s of decoding from the
    // previous keyframe. Before the fix of the seek lead (T33), its element kept seeking and never played there:
    // silence (and a frozen frame) until the end
    await seekTo(0.7);
    await preview.getByTitle('Play').click();
    const farFromKeyframe = (await measurePeakRms(page, 1500)).peak;
    await preview.getByTitle('Pause').click();
    console.log('Live preview audio, normalized:', JSON.stringify({ twoClips, farFromKeyframe }));
    expect(twoClips).toBeGreaterThan(0.05);
    expect(farFromKeyframe).toBeGreaterThan(0.02);
  });

  test('8b. render and check the file with ffprobe', async () => {
    const outPath = join(workDir, 'e2e-render.mp4');
    const expectedDuration = Number(await page.getByTestId('mix-live-preview').getByRole('slider').getAttribute('aria-valuemax'));

    await mockSaveDialog(ctx.app, outPath);
    await page.getByRole('button', { name: 'Render', exact: true }).click();

    // plan warnings (e.g. fill around the vertical clip), if any
    const renderAnyway = page.getByRole('button', { name: 'Render anyway' });
    const success = page.getByText('Success!');
    await expect(renderAnyway.or(success)).toBeVisible({ timeout: 30_000 });
    if (await renderAnyway.isVisible()) {
      await screenshot(page, '08-render-warnings');
      await renderAnyway.click();
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
