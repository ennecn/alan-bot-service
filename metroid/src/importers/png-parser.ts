import { readFileSync } from 'fs';

/**
 * Extract tEXt chunk data from a PNG file.
 * PNG format: 8-byte signature, then chunks (4B length + 4B type + data + 4B CRC).
 * tEXt chunks: null-terminated keyword + text data.
 */
export function extractPngText(filePath: string): Map<string, string> {
  const buf = readFileSync(filePath);
  const result = new Map<string, string>();

  // Verify PNG signature
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.subarray(0, 8).compare(PNG_SIG) !== 0) {
    throw new Error('Not a valid PNG file');
  }

  let offset = 8;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buf.subarray(offset + 8, offset + 8 + length);

    if (type === 'tEXt') {
      const nullIdx = data.indexOf(0);
      if (nullIdx !== -1) {
        const keyword = data.subarray(0, nullIdx).toString('ascii');
        const text = data.subarray(nullIdx + 1).toString('ascii');
        result.set(keyword, text);
      }
    }

    // Move to next chunk: length(4) + type(4) + data(length) + crc(4)
    offset += 12 + length;

    // Stop at IEND
    if (type === 'IEND') break;
  }

  return result;
}
