import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The application icon, drawn rather than commissioned, from the same palette as
 * the client (ADR-0022, appendix P8.12). It is a Gobblet in plan view: three nested
 * rings, the largest covering the smallest, on the board's own surface colour.
 * `pnpm --filter @gobblet/desktop run icons` runs this and then Tauri's `icon`
 * command, which derives every platform size from the square this writes.
 */

const SIZE = 1024;
const BACKGROUND = [27, 21, 18, 255];
const SURFACE = [36, 28, 23, 255];
const RINGS = [
  { radius: 0.42, fill: [107, 67, 38, 255], edge: [61, 38, 21, 255] },
  { radius: 0.29, fill: [200, 138, 63, 255], edge: [109, 74, 31, 255] },
  { radius: 0.16, fill: [228, 199, 154, 255], edge: [150, 122, 82, 255] },
];
const BOARD_INSET = 0.06;
const GRID_LINE = [61, 38, 21, 255];
const EDGE_WIDTH = 0.014;

function coverage(distance, radius, softness) {
  return Math.min(1, Math.max(0, (radius - distance) / softness + 0.5));
}

function blend(base, layer, alpha) {
  return [
    Math.round(base[0] + (layer[0] - base[0]) * alpha),
    Math.round(base[1] + (layer[1] - base[1]) * alpha),
    Math.round(base[2] + (layer[2] - base[2]) * alpha),
    255,
  ];
}

/** One pixel of the mark, in normalised coordinates centred on the square. */
function pixel(x, y) {
  const softness = 1.5 / SIZE;
  let colour = BACKGROUND;

  const inset = BOARD_INSET;
  const onBoard = x > inset && x < 1 - inset && y > inset && y < 1 - inset;
  if (onBoard) {
    colour = SURFACE;
    for (const line of [0.25, 0.5, 0.75]) {
      const distance = Math.min(Math.abs(x - line), Math.abs(y - line));
      colour = blend(colour, GRID_LINE, coverage(distance, 0.004, softness));
    }
  }

  const distance = Math.hypot(x - 0.5, y - 0.5);
  for (const ring of RINGS) {
    colour = blend(colour, ring.edge, coverage(distance, ring.radius, softness));
    colour = blend(colour, ring.fill, coverage(distance, ring.radius - EDGE_WIDTH, softness));
  }
  return colour;
}

function render() {
  // One filter byte per row, which is the PNG scanline format.
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  let offset = 0;
  for (let row = 0; row < SIZE; row += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let column = 0; column < SIZE; column += 1) {
      const [r, g, b, a] = pixel((column + 0.5) / SIZE, (row + 0.5) / SIZE);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
      offset += 4;
    }
  }
  return raw;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xff_ff_ff_ff;
  for (const byte of buffer) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xff_ff_ff_ff) >>> 0;
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const tagged = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(tagged));
  return Buffer.concat([length, tagged, checksum]);
}

function png(raw) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const target = join(dirname(fileURLToPath(import.meta.url)), "..", "icons", "source.png");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, png(render()));
console.log(`wrote ${target}`);
