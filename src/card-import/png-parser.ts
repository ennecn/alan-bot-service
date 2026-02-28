/**
 * PNG tEXt chunk parser — extracts base64-encoded "chara" data from PNG files.
 * Also handles raw JSON input.
 */

import fs from 'node:fs';
import type { STCardV2, STCardV2Wrapper } from './types.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Parse an ST Card V2 from a PNG file or raw JSON file.
 * PNG: scans for tEXt chunk with keyword "chara", base64-decodes the value.
 * JSON: parses directly, unwraps V2 wrapper if present.
 */
export function parseCardFile(filePath: string): STCardV2 {
  const buf = fs.readFileSync(filePath);

  // Check PNG signature
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return parseCardFromPng(buf);
  }

  // Try raw JSON
  const text = buf.toString('utf-8');
  return parseCardFromJson(text);
}

function parseCardFromPng(buf: Buffer): STCardV2 {
  let offset = 8; // skip PNG signature

  while (offset + 8 <= buf.length) {
    const chunkLength = buf.readUInt32BE(offset);
    const chunkType = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;

    if (dataEnd > buf.length) {
      throw new Error(`Malformed PNG: chunk extends beyond file`);
    }

    if (chunkType === 'tEXt') {
      // tEXt chunk: keyword (null-terminated) + text
      const data = buf.subarray(dataStart, dataEnd);
      const nullIdx = data.indexOf(0);
      if (nullIdx !== -1) {
        const keyword = data.subarray(0, nullIdx).toString('ascii');
        if (keyword === 'chara') {
          const b64 = data.subarray(nullIdx + 1).toString('ascii');
          const json = Buffer.from(b64, 'base64').toString('utf-8');
          return parseCardFromJson(json);
        }
      }
    }

    // next chunk: length(4) + type(4) + data(chunkLength) + crc(4)
    offset = dataEnd + 4;
  }

  throw new Error('No "chara" tEXt chunk found in PNG');
}

function parseCardFromJson(text: string): STCardV2 {
  const parsed = JSON.parse(text) as STCardV2Wrapper | STCardV2;

  // Unwrap V2 wrapper
  if ('spec' in parsed && parsed.spec === 'chara_card_v2' && 'data' in parsed) {
    return (parsed as STCardV2Wrapper).data;
  }

  // Bare card object
  if ('name' in parsed && 'description' in parsed) {
    return parsed as STCardV2;
  }

  throw new Error('Unrecognized card format: missing name/description fields');
}
