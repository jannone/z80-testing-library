import { describe, it, expect } from 'vitest'
import { extractCodeFromTap } from '../../src/adapters/spectrum/index.js'

/**
 * Synthesize a minimal .tap containing:
 *   1. a type-3 CODE header advertising `loadAddress` for `code`
 *   2. the matching data block
 *
 * Layout per block: [len_lo, len_hi, flag, ...payload, checksum].
 * The checksum is a trailing byte required by the format; the parser
 * ignores its value so we just pad with 0x00.
 */
function buildTap(name: string, loadAddress: number, code: number[] | Uint8Array): Uint8Array {
  // --- Header block (19 bytes total) ---
  const nameBytes = name.padEnd(10, ' ').slice(0, 10)
  const header = new Uint8Array(19)
  header[0] = 0x00                  // flag: header
  header[1] = 0x03                  // type: Code
  for (let i = 0; i < 10; i++) header[2 + i] = nameBytes.charCodeAt(i)
  header[12] = code.length & 0xFF   // datalen lo
  header[13] = (code.length >> 8) & 0xFF
  header[14] = loadAddress & 0xFF   // param1 lo (load addr)
  header[15] = (loadAddress >> 8) & 0xFF
  header[16] = 0x00                 // param2
  header[17] = 0x00
  header[18] = 0x00                 // checksum (ignored by parser)

  // --- Data block (1 flag + code + 1 checksum) ---
  const data = new Uint8Array(code.length + 2)
  data[0] = 0xFF
  data.set(code, 1)
  data[data.length - 1] = 0x00

  // Prefix each block with its little-endian length
  const out = new Uint8Array(2 + header.length + 2 + data.length)
  let o = 0
  out[o++] = header.length & 0xFF
  out[o++] = (header.length >> 8) & 0xFF
  out.set(header, o); o += header.length
  out[o++] = data.length & 0xFF
  out[o++] = (data.length >> 8) & 0xFF
  out.set(data, o)
  return out
}

describe('extractCodeFromTap', () => {
  it('extracts code bytes and load address', () => {
    const tap = buildTap('test', 0x8000, [0x3E, 0x42, 0xC9])
    const { code, loadAddress } = extractCodeFromTap(tap)

    expect(loadAddress).toBe(0x8000)
    expect(Array.from(code)).toEqual([0x3E, 0x42, 0xC9])
  })

  it('reads the advertised load address verbatim', () => {
    const tap = buildTap('loader', 0x6000, [0xC9])
    expect(extractCodeFromTap(tap).loadAddress).toBe(0x6000)
  })

  it('throws if no CODE header is present', () => {
    // BASIC-only tape: a type-0 (Program) header + its data block.
    const header = new Uint8Array(19)
    header[0] = 0x00; header[1] = 0x00 // type 0 = Program
    const data = new Uint8Array([0xFF, 0x00, 0x00])
    const tap = new Uint8Array(2 + header.length + 2 + data.length)
    let o = 0
    tap[o++] = header.length; tap[o++] = 0
    tap.set(header, o); o += header.length
    tap[o++] = data.length; tap[o++] = 0
    tap.set(data, o)

    expect(() => extractCodeFromTap(tap)).toThrow(/No CODE block/)
  })

  it('skips preceding BASIC blocks and returns the first code block', () => {
    // BASIC header + data, then our code header + data.
    const basicHeader = new Uint8Array(19)
    basicHeader[0] = 0x00; basicHeader[1] = 0x00
    const basicData = new Uint8Array([0xFF, 0x01, 0x02, 0x00])
    const prefix = new Uint8Array(2 + 19 + 2 + basicData.length)
    let o = 0
    prefix[o++] = 19; prefix[o++] = 0
    prefix.set(basicHeader, o); o += 19
    prefix[o++] = basicData.length; prefix[o++] = 0
    prefix.set(basicData, o)

    const codeTap = buildTap('code', 0x8000, [0xAA, 0xBB])
    const combined = new Uint8Array(prefix.length + codeTap.length)
    combined.set(prefix, 0)
    combined.set(codeTap, prefix.length)

    const { code, loadAddress } = extractCodeFromTap(combined)
    expect(loadAddress).toBe(0x8000)
    expect(Array.from(code)).toEqual([0xAA, 0xBB])
  })
})
