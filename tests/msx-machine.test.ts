import { describe, it, expect, beforeEach } from 'vitest'
import { MsxMachine, MSX_BIOS } from '../src/msx.js'
import { VDP_LAYOUT } from '../src/vdp-capture.js'

/**
 * Minimal synthetic ROM for testing MsxMachine.
 * Just enough to exercise BIOS stubs, VDP, and keyboard hooks.
 */

const CODE_BASE = 0x4000

/** Build a minimal ROM image starting at 0x4000 */
function makeRom(...code: number[]): Uint8Array {
  return new Uint8Array(code)
}

/** CALL addr ; RET */
function callRet(addr: number): number[] {
  return [0xCD, addr & 0xFF, (addr >> 8) & 0xFF, 0xC9]
}

/** LD A, imm ; RET */
function ldaRet(imm: number): number[] {
  return [0x3E, imm, 0xC9]
}

/** RET */
function ret(): number[] {
  return [0xC9]
}

function createMachine(code: number[]) {
  // Write code into a buffer at romLoadAddress
  const rom = Buffer.from(new Uint8Array(code))
  // Use regions instead of romPath to avoid needing a file
  const m = new MsxMachine({
    romPath: '', // will be overridden by regions
    regions: [[CODE_BASE, new Uint8Array(code)]],
  } as any)
  return m
}

/**
 * Create an MsxMachine using regions directly (no file).
 * We construct it by hand to avoid the romPath requirement.
 */
function createTestMachine(code: Uint8Array) {
  // MsxMachine expects romPath, but we'll use a workaround:
  // Load code via regions at 0x4000 (standard MSX cartridge slot)
  return new (class extends MsxMachine {
    constructor() {
      super({
        romPath: undefined as any,
        regions: [[CODE_BASE, code]],
      })
    }
  })()
}

describe('MsxMachine BIOS stubs', () => {
  it('all BIOS entry points have RET', () => {
    const m = createTestMachine(new Uint8Array(ret()))
    for (const [name, addr] of Object.entries(MSX_BIOS)) {
      expect(m.readByte(addr), `${name} at 0x${addr.toString(16)}`).toBe(0xC9)
    }
  })

  it('CALL to BIOS stub returns without crashing', () => {
    // CALL DISSCR ; LD A, 0x42 ; RET
    const code = new Uint8Array([
      0xCD, MSX_BIOS.DISSCR & 0xFF, (MSX_BIOS.DISSCR >> 8) & 0xFF,
      0x3E, 0x42,
      0xC9,
    ])
    const m = createTestMachine(code)
    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(0x42) // execution continued past the CALL
  })
})

describe('MsxMachine keyboard', () => {
  it('keyboardRows default to 0xFF (all released)', () => {
    const m = createTestMachine(new Uint8Array(ret()))
    for (let i = 0; i < 16; i++) {
      expect(m.keyboardRows[i]).toBe(0xFF)
    }
  })

  it('SNSMAT hook returns keyboard row value', () => {
    // LD A, 8 ; CALL SNSMAT ; RET
    // The SNSMAT hook reads keyboardRows[A & 0x0F] into A
    const code = new Uint8Array([
      0x3E, 0x08, // LD A, 8
      0xCD, MSX_BIOS.SNSMAT & 0xFF, (MSX_BIOS.SNSMAT >> 8) & 0xFF,
      0xC9,       // RET
    ])
    const m = createTestMachine(code)
    m.keyboardRows[8] = 0xFF & ~(1 << 7) // simulate Right arrow

    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(0xFF & ~(1 << 7))
  })
})

describe('MsxMachine VDP', () => {
  it('exposes VDP capture instance', () => {
    const m = createTestMachine(new Uint8Array(ret()))
    expect(m.vdp).toBeDefined()
    expect(m.vdp.readVram(0)).toBe(0)
  })

  it('port 0x98 write goes through VDP data port', () => {
    // OUT (0x98), A ; RET
    const code = new Uint8Array([0x3E, 0xAB, 0xD3, 0x98, 0xC9])
    const m = createTestMachine(code)
    m.runFrom(CODE_BASE)

    const writes = m.vdp.getVramWrites()
    expect(writes).toEqual([{ value: 0xAB }])
  })

  it('port 0x99 writes go through VDP control port', () => {
    // Write register 1 = 0xE2: OUT 0x99 with 0xE2 then 0x81
    const code = new Uint8Array([
      0x3E, 0xE2, 0xD3, 0x99, // LD A, 0xE2 ; OUT (0x99), A
      0x3E, 0x81, 0xD3, 0x99, // LD A, 0x81 ; OUT (0x99), A
      0xC9,                     // RET
    ])
    const m = createTestMachine(code)
    m.runFrom(CODE_BASE)

    const regWrites = m.vdp.getRegisterWrites()
    expect(regWrites).toEqual([{ register: 1, value: 0xE2 }])
  })

  it('WRTVRM hook writes to VRAM buffer', () => {
    // LD HL, 0x1800 ; LD A, 0x42 ; CALL WRTVRM ; RET
    const code = new Uint8Array([
      0x21, 0x00, 0x18,       // LD HL, 0x1800
      0x3E, 0x42,             // LD A, 0x42
      0xCD, MSX_BIOS.WRTVRM & 0xFF, (MSX_BIOS.WRTVRM >> 8) & 0xFF,
      0xC9,
    ])
    const m = createTestMachine(code)
    m.runFrom(CODE_BASE)
    expect(m.vdp.readVram(0x1800)).toBe(0x42)
  })

  it('FILVRM hook fills VRAM region', () => {
    // LD HL, 0x1800 ; LD A, 0xFF ; LD BC, 4 ; CALL FILVRM ; RET
    const code = new Uint8Array([
      0x21, 0x00, 0x18,       // LD HL, 0x1800
      0x3E, 0xFF,             // LD A, 0xFF
      0x01, 0x04, 0x00,       // LD BC, 4
      0xCD, MSX_BIOS.FILVRM & 0xFF, (MSX_BIOS.FILVRM >> 8) & 0xFF,
      0xC9,
    ])
    const m = createTestMachine(code)
    m.runFrom(CODE_BASE)
    for (let i = 0; i < 4; i++) {
      expect(m.vdp.readVram(0x1800 + i)).toBe(0xFF)
    }
    expect(m.vdp.readVram(0x1804)).toBe(0x00) // beyond fill
  })

  it('LDIRVM hook copies RAM to VRAM', () => {
    // Set up RAM data at 0xC000, then LDIRVM to copy to VRAM
    // LD HL, 0xC000 ; LD DE, 0x1B00 ; LD BC, 3 ; CALL LDIRVM ; RET
    const code = new Uint8Array([
      0x21, 0x00, 0xC0,       // LD HL, 0xC000 (RAM source)
      0x11, 0x00, 0x1B,       // LD DE, 0x1B00 (VRAM dest)
      0x01, 0x03, 0x00,       // LD BC, 3
      0xCD, MSX_BIOS.LDIRVM & 0xFF, (MSX_BIOS.LDIRVM >> 8) & 0xFF,
      0xC9,
    ])
    const m = createTestMachine(code)
    m.writeByte(0xC000, 0xAA)
    m.writeByte(0xC001, 0xBB)
    m.writeByte(0xC002, 0xCC)

    m.runFrom(CODE_BASE)

    expect(m.vdp.readVram(0x1B00)).toBe(0xAA)
    expect(m.vdp.readVram(0x1B01)).toBe(0xBB)
    expect(m.vdp.readVram(0x1B02)).toBe(0xCC)
  })
})

describe('MsxMachine memory map', () => {
  it('ROM area (0x4000-0xBFFF) is read-only', () => {
    const code = new Uint8Array([
      0x3E, 0xFF,             // LD A, 0xFF
      0x21, 0x00, 0x40,       // LD HL, 0x4000
      0x77,                   // LD (HL), A
      0xC9,                   // RET
    ])
    const m = createTestMachine(code)
    const original = m.readByte(0x4000)
    m.runFrom(CODE_BASE)
    expect(m.readByte(0x4000)).toBe(original) // unchanged
  })

  it('RAM area (0xC000+) is writable', () => {
    const code = new Uint8Array([
      0x3E, 0xAB,             // LD A, 0xAB
      0x21, 0x00, 0xC0,       // LD HL, 0xC000
      0x77,                   // LD (HL), A
      0xC9,                   // RET
    ])
    const m = createTestMachine(code)
    m.runFrom(CODE_BASE)
    expect(m.readByte(0xC000)).toBe(0xAB)
  })
})

describe('MsxMachine port reads', () => {
  it('port 0xA8 returns 0x00 (PPI slot select)', () => {
    // IN A, (0xA8) ; RET
    const code = new Uint8Array([0xDB, 0xA8, 0xC9])
    const m = createTestMachine(code)
    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(0x00)
  })

  it('port 0xA9 returns 0xFF (keyboard all released)', () => {
    const code = new Uint8Array([0xDB, 0xA9, 0xC9])
    const m = createTestMachine(code)
    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(0xFF)
  })
})
