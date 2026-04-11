import { describe, it, expect } from 'vitest'
import { Z80Machine } from '../src/machine.js'

/**
 * Assemble small Z80 byte sequences inline for testing.
 * No ROM file or symbol file needed.
 */
const CODE_BASE = 0x100

/** LD A, imm ; RET */
function ldaRet(imm: number): Uint8Array {
  return new Uint8Array([0x3E, imm, 0xC9])
}

/** LD A, (HL) ; RET */
function ldaHlRet(): Uint8Array {
  return new Uint8Array([0x7E, 0xC9])
}

/** LD (HL), A ; RET */
function ldHlARet(): Uint8Array {
  return new Uint8Array([0x77, 0xC9])
}

/** ADD A, B ; RET */
function addAbRet(): Uint8Array {
  return new Uint8Array([0x80, 0xC9])
}

/** INC A ; INC A ; INC A ; RET  (3 increments) */
function incAx3Ret(): Uint8Array {
  return new Uint8Array([0x3C, 0x3C, 0x3C, 0xC9])
}

/** OUT (port), A ; RET */
function outPortARet(port: number): Uint8Array {
  return new Uint8Array([0xD3, port, 0xC9])
}

/** IN A, (port) ; RET */
function inAPortRet(port: number): Uint8Array {
  return new Uint8Array([0xDB, port, 0xC9])
}

/** HALT (infinite loop sentinel) */
function halt(): Uint8Array {
  return new Uint8Array([0x76])
}

function createMachine(code: Uint8Array, addr = CODE_BASE) {
  return new Z80Machine({
    regions: [[addr, code]],
  })
}

describe('Z80Machine basics', () => {
  it('runs a trivial LD A, imm and returns', () => {
    const m = createMachine(ldaRet(42))
    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(42)
  })

  it('returns elapsed T-states', () => {
    const m = createMachine(ldaRet(0))
    const tStates = m.runFrom(CODE_BASE)
    expect(tStates).toBeGreaterThan(0)
    expect(m.elapsedTStates).toBe(tStates)
  })

  it('executes multiple instructions', () => {
    const m = createMachine(incAx3Ret())
    m.regs.a = 10
    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(13)
  })

  it('ADD A, B computes correct result', () => {
    const m = createMachine(addAbRet())
    m.regs.a = 100
    m.regs.b = 55
    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(155)
  })

  it('throws on cycle limit exceeded', () => {
    // Tight loop: JR -2 (jumps back to itself)
    const loop = new Uint8Array([0x18, 0xFE])
    const m = createMachine(loop)
    expect(() => m.runFrom(CODE_BASE, 500)).toThrow(/Cycle limit exceeded/)
  })
})

describe('memory operations', () => {
  it('readByte / writeByte round-trips', () => {
    const m = createMachine(halt())
    m.writeByte(0xC000, 0xAB)
    expect(m.readByte(0xC000)).toBe(0xAB)
  })

  it('readWord / writeWord are little-endian', () => {
    const m = createMachine(halt())
    m.writeWord(0xC000, 0x1234)
    expect(m.readByte(0xC000)).toBe(0x34) // low byte
    expect(m.readByte(0xC001)).toBe(0x12) // high byte
    expect(m.readWord(0xC000)).toBe(0x1234)
  })

  it('writeBlock writes contiguous bytes', () => {
    const m = createMachine(halt())
    m.writeBlock(0xC000, [0x10, 0x20, 0x30])
    expect(m.readByte(0xC000)).toBe(0x10)
    expect(m.readByte(0xC001)).toBe(0x20)
    expect(m.readByte(0xC002)).toBe(0x30)
  })

  it('CPU can read written memory', () => {
    const m = createMachine(ldaHlRet())
    m.writeByte(0xD000, 0x77)
    m.regs.hl = 0xD000
    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(0x77)
  })

  it('CPU can write to memory', () => {
    const m = createMachine(ldHlARet())
    m.regs.a = 0xBE
    m.regs.hl = 0xD000
    m.runFrom(CODE_BASE)
    expect(m.readByte(0xD000)).toBe(0xBE)
  })
})

describe('isWritable filter', () => {
  it('blocks writes to read-only regions', () => {
    const code = ldHlARet()
    const m = new Z80Machine({
      regions: [[CODE_BASE, code]],
      isWritable: (addr) => addr >= 0xC000,
    })
    m.writeByte(0x2000, 0x00) // pre-fill (direct write also blocked)
    m.regs.a = 0xFF
    m.regs.hl = 0x2000
    m.runFrom(CODE_BASE)
    expect(m.readByte(0x2000)).toBe(0x00) // write was blocked
  })

  it('allows writes to writable regions', () => {
    const code = ldHlARet()
    const m = new Z80Machine({
      regions: [[CODE_BASE, code]],
      isWritable: (addr) => addr >= 0xC000,
    })
    m.regs.a = 0xFF
    m.regs.hl = 0xC000
    m.runFrom(CODE_BASE)
    expect(m.readByte(0xC000)).toBe(0xFF)
  })
})

describe('I/O ports', () => {
  it('onPortWrite receives port writes', () => {
    const writes: Array<{ port: number; value: number }> = []
    const m = new Z80Machine({
      regions: [[CODE_BASE, outPortARet(0x42)]],
      onPortWrite: (port, value) => writes.push({ port, value }),
    })
    m.regs.a = 0xBB
    m.runFrom(CODE_BASE)
    expect(writes).toEqual([{ port: 0x42, value: 0xBB }])
  })

  it('onPortRead provides values to IN instruction', () => {
    const m = new Z80Machine({
      regions: [[CODE_BASE, inAPortRet(0x99)]],
      onPortRead: (port) => (port === 0x99 ? 0x55 : 0xFF),
    })
    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(0x55)
  })

  it('defaults to 0xFF when no port handler', () => {
    const m = createMachine(inAPortRet(0x50))
    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(0xFF)
  })
})

describe('PC hooks', () => {
  it('fires hook when PC reaches target address', () => {
    // NOP ; NOP ; NOP ; RET — hook on the second NOP
    const code = new Uint8Array([0x00, 0x00, 0x00, 0xC9])
    let hookFired = false
    const hooks = new Map([[CODE_BASE + 1, () => { hookFired = true }]])
    const m = new Z80Machine({ regions: [[CODE_BASE, code]], hooks })
    m.runFrom(CODE_BASE)
    expect(hookFired).toBe(true)
  })

  it('hook can modify registers', () => {
    // NOP ; RET — hook on NOP sets A=99
    const code = new Uint8Array([0x00, 0xC9])
    const hooks = new Map([[CODE_BASE, (m: Z80Machine) => { m.regs.a = 99 }]])
    const m = new Z80Machine({ regions: [[CODE_BASE, code]], hooks })
    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(99)
  })
})

describe('stubs', () => {
  it('places RET at stub addresses', () => {
    const m = new Z80Machine({
      stubs: [0x0041, 0x0047],
    })
    expect(m.readByte(0x0041)).toBe(0xC9) // RET
    expect(m.readByte(0x0047)).toBe(0xC9)
  })

  it('CALL to stub returns immediately', () => {
    // CALL 0x0041 ; LD A, 5 ; RET
    const code = new Uint8Array([0xCD, 0x41, 0x00, 0x3E, 0x05, 0xC9])
    const m = new Z80Machine({
      regions: [[CODE_BASE, code]],
      stubs: [0x0041],
    })
    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(5) // execution continued past the CALL
  })
})

describe('symbols', () => {
  it('throws when no symbol file loaded', () => {
    const m = createMachine(halt())
    expect(() => m.sym('anything')).toThrow(/No symbol file loaded/)
  })

  it('hasSym returns false when no symbol file', () => {
    const m = createMachine(halt())
    expect(m.hasSym('anything')).toBe(false)
  })
})

describe('runFunction', () => {
  it('throws for unknown symbol', () => {
    // Need a machine with symbols to test this — use a mock .noi content
    // Since we can't easily mock the file, test via runFrom sentinel behavior
    const m = createMachine(halt())
    expect(() => m.runFunction('nonexistent')).toThrow()
  })
})

describe('multiple regions', () => {
  it('loads multiple memory regions', () => {
    const m = new Z80Machine({
      regions: [
        [0x1000, new Uint8Array([0xAA, 0xBB])],
        [0x2000, new Uint8Array([0xCC, 0xDD])],
      ],
    })
    expect(m.readByte(0x1000)).toBe(0xAA)
    expect(m.readByte(0x1001)).toBe(0xBB)
    expect(m.readByte(0x2000)).toBe(0xCC)
    expect(m.readByte(0x2001)).toBe(0xDD)
  })
})

describe('stack pointer', () => {
  it('defaults to 0xF380', () => {
    const m = createMachine(halt())
    expect(m.regs.sp).toBe(0xF380)
  })

  it('respects custom stack pointer', () => {
    const m = new Z80Machine({ stackPointer: 0xE000 })
    expect(m.regs.sp).toBe(0xE000)
  })
})
