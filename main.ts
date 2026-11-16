// Leviathan's Lantern — make.fun ai-excited-01 entry, round 4.
//
// A colossal whale carries a lighthouse through a storm sky. This program
// is the whole entry: it reads the artwork bundled beside it, checks the
// file end to end, and writes the exact same bytes to the output folder.
//
// The artwork file is called entry.png but holds JPEG bytes — the bounty
// allows either format under that name, told apart by the first bytes.
// What the program checks before copying:
//   - the file opens with the JPEG start marker (FF D8) and ends with the
//     end marker (FF D9), so it is one whole image and nothing is cut off
//   - a frame header (SOF0/1/2) is present and its width and height are
//     each at most 1024 pixels
//   - the file is at most 1 MiB
//   - the SHA-256 of the bytes matches the artwork this program was built
//     with, so a damaged or swapped file can never slip through
// After writing, the program reads the output back and compares it byte
// for byte with the source. No timestamps, no randomness, no network —
// running it twice produces byte-identical output.
//
// Run it locally with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Without MAKEFUN_OUTPUT_DIR the output goes to /output/entry.png.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const EXPECTED_DIGEST =
  "05f2f8e3df2cc848cbb2be29a22d8c2bf8955a13e7b1b1c1588db980348b4259";
const LIMIT_BYTES = 1024 * 1024;
const LIMIT_SIDE = 1024;

// Markers that carry no length field and are skipped as a lone pair.
const LONE_MARKERS = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8]);

// Markers whose segment holds the frame size (baseline, extended,
// progressive). The size lives 5 bytes past the marker byte: one byte of
// precision, then height (2 bytes), then width (2 bytes).
const FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2]);

function digestOf(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function die(reason: string): never {
  throw new Error(`entry rejected: ${reason}`);
}

// Walk the JPEG markers and pull the width and height out of the frame
// header. Returns the size, and throws on anything malformed.
function frameSize(data: Buffer): { width: number; height: number } {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    die("not a JPEG (missing SOI marker)");
  }

  let pos = 2;
  while (pos + 1 < data.length) {
    if (data[pos] !== 0xff) {
      die(`expected a marker at offset ${pos}`);
    }
    // Padding 0xFF bytes carry no meaning; step over them, stopping
    // cleanly if the file ends in padding instead of a marker.
    while (pos < data.length && data[pos] === 0xff) pos++;
    if (pos >= data.length) {
      die("file ends in marker padding");
    }
    const marker = data[pos];
    pos++;

    if (marker === 0xd9) {
      die("reached EOI before any frame header");
    }
    if (LONE_MARKERS.has(marker)) {
      continue;
    }
    if (pos + 2 > data.length) {
      die("segment length runs past the end of the file");
    }
    const segmentLength = data.readUInt16BE(pos);
    if (segmentLength < 2 || pos + segmentLength > data.length) {
      die(`segment 0x${marker.toString(16)} is truncated`);
    }
    if (FRAME_MARKERS.has(marker)) {
      const height = data.readUInt16BE(pos + 3);
      const width = data.readUInt16BE(pos + 5);
      if (width === 0 || height === 0) {
        die("frame header has a zero side");
      }
      return { width, height };
    }
    // 0xDA (start of scan) ends the header area; the frame header must
    // have appeared before it. Past the scan header, the compressed data
    // runs until the first FFD9 pair, which must be the file's last two
    // bytes — anything after it would be trailing garbage, and anything
    // before it without an EOI would be a cut-off image.
    if (marker === 0xda) {
      const scanStart = pos + segmentLength;
      let eoi = -1;
      for (let i = scanStart; i + 1 < data.length; i++) {
        if (data[i] === 0xff && data[i + 1] === 0xd9) {
          eoi = i;
          break;
        }
      }
      if (eoi === -1) {
        die("scan data never reaches an EOI marker");
      }
      if (eoi !== data.length - 2) {
        die("trailing data after the EOI marker");
      }
      die("reached the scan data before any frame header");
    }
    pos += segmentLength;
  }
  die("no frame header found");
}

function checkImage(data: Buffer): { width: number; height: number } {
  if (data.length > LIMIT_BYTES) {
    die(`file is ${data.length} bytes, over the 1 MiB limit`);
  }
  const { width, height } = frameSize(data);
  if (width > LIMIT_SIDE || height > LIMIT_SIDE) {
    die(`dimensions ${width}x${height} exceed 1024x1024`);
  }
  if (data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) {
    die("file does not end with the JPEG EOI marker");
  }
  const digest = digestOf(data);
  if (digest !== EXPECTED_DIGEST) {
    die(`SHA-256 mismatch: got ${digest}`);
  }
  return { width, height };
}

function main(): void {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const sourcePath = path.join(here, "entry.png");
  const outputDir = path.resolve(process.env.MAKEFUN_OUTPUT_DIR ?? "/output");
  const outputPath = path.join(outputDir, "entry.png");

  const bytes = fs.readFileSync(sourcePath);
  const { width, height } = checkImage(bytes);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, bytes);

  // Read the output back: it must be the same bytes, not just the same hash.
  const written = fs.readFileSync(outputPath);
  if (!written.equals(bytes)) {
    die("written file differs from the source bytes");
  }
  if (digestOf(written) !== EXPECTED_DIGEST) {
    die("written file SHA-256 mismatch");
  }

  console.log(`entry.png (${width}x${height}, ${bytes.length} bytes)`);
  console.log(`sha256: ${EXPECTED_DIGEST}`);
  console.log(`written to ${outputPath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
