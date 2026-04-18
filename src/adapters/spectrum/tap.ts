/**
 * Extract the first CODE block from a ZX Spectrum .tap file.
 *
 * Tape format:
 *   Each block is prefixed by a little-endian 2-byte length, then
 *   `[flag, payload..., checksum]`. Flag 0x00 = header, 0xFF = data.
 *   A type-3 header ("Code") carries the load address at payload
 *   offset 14-15 and is followed by the corresponding data block.
 *
 * Callers load the file themselves (the library avoids file I/O in
 * core code):
 *
 *   const { code, loadAddress } =
 *     extractCodeFromTap(new Uint8Array(readFileSync('hello.tap')))
 *   createSpectrumTestbed({ regions: [[loadAddress, code]] })
 */
export interface TapCode {
  code: Uint8Array
  loadAddress: number
}

export function extractCodeFromTap(data: Uint8Array): TapCode {
  let offset = 0
  let loadAddress = -1

  while (offset + 2 <= data.length) {
    const len = data[offset] | (data[offset + 1] << 8)
    const blockStart = offset + 2
    const blockEnd = blockStart + len
    const flag = data[blockStart]

    if (flag === 0x00 && data[blockStart + 1] === 0x03) {
      loadAddress = data[blockStart + 14] | (data[blockStart + 15] << 8)
    } else if (flag === 0xFF && loadAddress >= 0) {
      // Drop the leading flag byte and trailing checksum byte
      const code = data.slice(blockStart + 1, blockEnd - 1)
      return { code, loadAddress }
    }
    offset = blockEnd
  }
  throw new Error('No CODE block found in .tap')
}
