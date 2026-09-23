import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';


const renderPng = (from: string, width: number, height: number) => sharp(from)
  .png()
  .resize(width, height, {
    fit: sharp.fit.contain,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .toBuffer();

const svg2png = async (from: string, to: string, width: number, height: number) => (
  writeFile(to, await renderPng(from, width, height))
);

const renderSquarePngs = (from: string, sizes: number[]) => Promise.all(sizes.map(async (size) => ({ size, data: await renderPng(from, size, size) })));

// https://en.wikipedia.org/wiki/ICO_(file_format)
// PNG-compressed entries require Windows Vista or newer
function makeIco(pngs: { size: number, data: Buffer }[]) {
  const fileHeaderSize = 6;
  const dirEntrySize = 16;

  const fileHeader = Buffer.alloc(fileHeaderSize);
  fileHeader.writeUInt16LE(0, 0); // reserved
  fileHeader.writeUInt16LE(1, 2); // image type (1 = icon)
  fileHeader.writeUInt16LE(pngs.length, 4);

  let imageOffset = fileHeaderSize + dirEntrySize * pngs.length;
  const dirEntries = pngs.map(({ size, data }) => {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256 or more)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // number of palette colors
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(imageOffset, 12);
    imageOffset += data.length;
    return entry;
  });

  return Buffer.concat([fileHeader, ...dirEntries, ...pngs.map(({ data }) => data)]);
}

const srcIcon = 'src/renderer/src/icon.svg';

// VideoMix only targets Linux and Windows (T18): no macOS .icns, no Windows Store assets.

// Linux:
await svg2png(srcIcon, 'icon-build/app-512.png', 512, 512);

// Windows ICO:
// https://github.com/mifi/lossless-cut/issues/778
// https://stackoverflow.com/questions/3236115/which-icon-sizes-should-my-windows-applications-icon-include
await writeFile('icon-build/app.ico', makeIco(await renderSquarePngs(srcIcon, [16, 24, 32, 40, 48, 64, 96, 128, 256, 512])));
