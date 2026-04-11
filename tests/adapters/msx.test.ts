import { describe, it, expect } from 'vitest'
import { createMsxTestbed, MSX_BIOS } from '../../src/adapters/msx/index.js'
import { TMS9918_LAYOUT } from '../../src/devices/tms9918.js'

const CODE_BASE = 0x4000

function createTestbed(code: Uint8Array) {
  return createMsxTestbed({
    regions: [[CODE_BASE, code]],
  })
}

describe('createMsxTestbed', () => {
  it('returns machine, vdp, and keyboard', () => {
    const testbed = createTestbed(new Uint8Array([0xC9]))
    expect(testbed.machine).toBeDefined()
    expect(testbed.vdp).toBeDefined()
    expect(testbed.keyboard).toBeDefined()
  })
})

describe('MSX BIOS stubs', () => {
  it('all BIOS entry points have RET', () => {
    const { machine: m } = createTestbed(new Uint8Array([0xC9]))
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
    const { machine: m } = createTestbed(code)
    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(0x42)
  })
})

describe('MSX keyboard', () => {
  it('keyboard rows default to 0xFF (all released)', () => {
    const { keyboard } = createTestbed(new Uint8Array([0xC9]))
    for (let i = 0; i < 16; i++) {
      expect(keyboard[i]).toBe(0xFF)
    }
  })

  it('SNSMAT hook returns keyboard row value', () => {
    // LD A, 8 ; CALL SNSMAT ; RET
    const code = new Uint8Array([
      0x3E, 0x08,
      0xCD, MSX_BIOS.SNSMAT & 0xFF, (MSX_BIOS.SNSMAT >> 8) & 0xFF,
      0xC9,
    ])
    const { machine: m, keyboard } = createTestbed(code)
    keyboard[8] = 0xFF & ~(1 << 7) // simulate Right arrow

    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(0xFF & ~(1 << 7))
  })
})

describe('MSX VDP', () => {
  it('exposes VDP capture instance', () => {
    const { vdp } = createTestbed(new Uint8Array([0xC9]))
    expect(vdp).toBeDefined()
    expect(vdp.readVram(0)).toBe(0)
  })

  it('port 0x98 write goes through VDP data port', () => {
    // LD A, 0xAB ; OUT (0x98), A ; RET
    const code = new Uint8Array([0x3E, 0xAB, 0xD3, 0x98, 0xC9])
    const { machine: m, vdp } = createTestbed(code)
    m.runFrom(CODE_BASE)

    const writes = vdp.getVramWrites()
    expect(writes).toEqual([{ value: 0xAB }])
  })

  it('port 0x99 writes go through VDP control port', () => {
    // Write register 1 = 0xE2: OUT 0x99 with 0xE2 then 0x81
    const code = new Uint8Array([
      0x3E, 0xE2, 0xD3, 0x99,
      0x3E, 0x81, 0xD3, 0x99,
      0xC9,
    ])
    const { machine: m, vdp } = createTestbed(code)
    m.runFrom(CODE_BASE)

    const regWrites = vdp.getRegisterWrites()
    expect(regWrites).toEqual([{ register: 1, value: 0xE2 }])
  })

  it('WRTVRM hook writes to VRAM buffer', () => {
    // LD HL, 0x1800 ; LD A, 0x42 ; CALL WRTVRM ; RET
    const code = new Uint8Array([
      0x21, 0x00, 0x18,
      0x3E, 0x42,
      0xCD, MSX_BIOS.WRTVRM & 0xFF, (MSX_BIOS.WRTVRM >> 8) & 0xFF,
      0xC9,
    ])
    const { machine: m, vdp } = createTestbed(code)
    m.runFrom(CODE_BASE)
    expect(vdp.readVram(0x1800)).toBe(0x42)
  })

  it('FILVRM hook fills VRAM region', () => {
    // LD HL, 0x1800 ; LD A, 0xFF ; LD BC, 4 ; CALL FILVRM ; RET
    const code = new Uint8Array([
      0x21, 0x00, 0x18,
      0x3E, 0xFF,
      0x01, 0x04, 0x00,
      0xCD, MSX_BIOS.FILVRM & 0xFF, (MSX_BIOS.FILVRM >> 8) & 0xFF,
      0xC9,
    ])
    const { machine: m, vdp } = createTestbed(code)
    m.runFrom(CODE_BASE)
    for (let i = 0; i < 4; i++) {
      expect(vdp.readVram(0x1800 + i)).toBe(0xFF)
    }
    expect(vdp.readVram(0x1804)).toBe(0x00)
  })

  it('LDIRVM hook copies RAM to VRAM', () => {
    // LD HL, 0xC000 ; LD DE, 0x1B00 ; LD BC, 3 ; CALL LDIRVM ; RET
    const code = new Uint8Array([
      0x21, 0x00, 0xC0,
      0x11, 0x00, 0x1B,
      0x01, 0x03, 0x00,
      0xCD, MSX_BIOS.LDIRVM & 0xFF, (MSX_BIOS.LDIRVM >> 8) & 0xFF,
      0xC9,
    ])
    const { machine: m, vdp } = createTestbed(code)
    m.writeByte(0xC000, 0xAA)
    m.writeByte(0xC001, 0xBB)
    m.writeByte(0xC002, 0xCC)

    m.runFrom(CODE_BASE)

    expect(vdp.readVram(0x1B00)).toBe(0xAA)
    expect(vdp.readVram(0x1B01)).toBe(0xBB)
    expect(vdp.readVram(0x1B02)).toBe(0xCC)
  })
})

describe('MSX memory map', () => {
  it('ROM area (0x4000-0xBFFF) is read-only', () => {
    const code = new Uint8Array([
      0x3E, 0xFF,
      0x21, 0x00, 0x40,
      0x77,
      0xC9,
    ])
    const { machine: m } = createTestbed(code)
    const original = m.readByte(0x4000)
    m.runFrom(CODE_BASE)
    expect(m.readByte(0x4000)).toBe(original)
  })

  it('RAM area (0xC000+) is writable', () => {
    const code = new Uint8Array([
      0x3E, 0xAB,
      0x21, 0x00, 0xC0,
      0x77,
      0xC9,
    ])
    const { machine: m } = createTestbed(code)
    m.runFrom(CODE_BASE)
    expect(m.readByte(0xC000)).toBe(0xAB)
  })
})

describe('MSX port reads', () => {
  it('port 0xA8 returns 0x00 (PPI slot select)', () => {
    const code = new Uint8Array([0xDB, 0xA8, 0xC9])
    const { machine: m } = createTestbed(code)
    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(0x00)
  })

  it('port 0xA9 returns 0xFF (keyboard all released)', () => {
    const code = new Uint8Array([0xDB, 0xA9, 0xC9])
    const { machine: m } = createTestbed(code)
    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(0xFF)
  })
})
