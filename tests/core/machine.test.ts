import { describe, it, expect } from 'vitest'
import { Z80TestMachine } from '../../src/core/machine.js'
import type { MemoryMap, Hardware, SymbolProvider, PcHook } from '../../src/core/types.js'

const CODE_BASE = 0x100

/** LD A, imm ; RET */
function ldaRet(imm: number): Uint8Array {
  return new Uint8Array([0x3E, imm, 0xC9])
}

/** LD (HL), A ; RET */
function ldHlARet(): Uint8Array {
  return new Uint8Array([0x77, 0xC9])
}

/** LD A, (HL) ; RET */
function ldaHlRet(): Uint8Array {
  return new Uint8Array([0x7E, 0xC9])
}

/** ADD A, B ; RET */
function addAbRet(): Uint8Array {
  return new Uint8Array([0x80, 0xC9])
}

/** INC A ; INC A ; INC A ; RET */
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

/** HALT */
function halt(): Uint8Array {
  return new Uint8Array([0x76])
}

function createMachine(code: Uint8Array, addr = CODE_BASE) {
  return new Z80TestMachine({
    regions: [[addr, code]],
  })
}

describe('Z80TestMachine bare-metal (no ports)', () => {
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
    const loop = new Uint8Array([0x18, 0xFE]) // JR -2
    const m = createMachine(loop)
    expect(() => m.runFrom(CODE_BASE, 500)).toThrow(/Cycle limit exceeded/)
  })

  it('defaults to stack pointer 0xF380', () => {
    const m = createMachine(halt())
    expect(m.regs.sp).toBe(0xF380)
  })

  it('respects custom stack pointer', () => {
    const m = new Z80TestMachine({ stackPointer: 0xE000 })
    expect(m.regs.sp).toBe(0xE000)
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
    expect(m.readByte(0xC000)).toBe(0x34)
    expect(m.readByte(0xC001)).toBe(0x12)
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

  it('loads multiple memory regions', () => {
    const m = new Z80TestMachine({
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

  it('loads ROM data at romLoadAddress', () => {
    const rom = new Uint8Array([0x3E, 42, 0xC9]) // LD A, 42; RET
    const m = new Z80TestMachine({ rom, romLoadAddress: 0x100 })
    m.runFrom(0x100)
    expect(m.regs.a).toBe(42)
  })
})

describe('with MemoryMap port', () => {
  const readOnlyBelow0xC000: MemoryMap = {
    defaultRomLoadAddress: 0x4000,
    defaultStackPointer: 0xF000,
    isWritable: (addr) => addr >= 0xC000,
  }

  it('blocks writes to read-only regions', () => {
    const code = ldHlARet()
    const m = new Z80TestMachine({
      memoryMap: readOnlyBelow0xC000,
      regions: [[CODE_BASE, code]],
    })
    m.writeByte(0x2000, 0x00) // pre-fill
    m.regs.a = 0xFF
    m.regs.hl = 0x2000
    m.runFrom(CODE_BASE)
    expect(m.readByte(0x2000)).toBe(0x00) // write was blocked
  })

  it('allows writes to writable regions', () => {
    const code = ldHlARet()
    const m = new Z80TestMachine({
      memoryMap: readOnlyBelow0xC000,
      regions: [[CODE_BASE, code]],
    })
    m.regs.a = 0xFF
    m.regs.hl = 0xC000
    m.runFrom(CODE_BASE)
    expect(m.readByte(0xC000)).toBe(0xFF)
  })

  it('uses memoryMap default stack pointer', () => {
    const m = new Z80TestMachine({ memoryMap: readOnlyBelow0xC000 })
    expect(m.regs.sp).toBe(0xF000)
  })

  it('stackPointer config overrides memoryMap default', () => {
    const m = new Z80TestMachine({
      memoryMap: readOnlyBelow0xC000,
      stackPointer: 0xE000,
    })
    expect(m.regs.sp).toBe(0xE000)
  })

  it('loads ROM at memoryMap.defaultRomLoadAddress', () => {
    const rom = new Uint8Array([0x3E, 99, 0xC9]) // LD A, 99; RET
    const m = new Z80TestMachine({
      memoryMap: readOnlyBelow0xC000,
      rom,
    })
    // ROM should be at 0x4000 per memoryMap default
    expect(m.readByte(0x4000)).toBe(0x3E)
    m.runFrom(0x4000)
    expect(m.regs.a).toBe(99)
  })
})

describe('with Hardware port', () => {
  it('port writes go through Hardware.writePort', () => {
    const writes: Array<{ port: number; value: number }> = []
    const hw: Hardware = {
      readPort: () => 0xFF,
      writePort: (port, value) => writes.push({ port, value }),
      hooks: new Map(),
      stubs: [],
    }
    const m = new Z80TestMachine({
      hardware: hw,
      regions: [[CODE_BASE, outPortARet(0x42)]],
    })
    m.regs.a = 0xBB
    m.runFrom(CODE_BASE)
    expect(writes).toEqual([{ port: 0x42, value: 0xBB }])
  })

  it('port reads go through Hardware.readPort', () => {
    const hw: Hardware = {
      readPort: (port) => (port === 0x99 ? 0x55 : 0xFF),
      writePort: () => {},
      hooks: new Map(),
      stubs: [],
    }
    const m = new Z80TestMachine({
      hardware: hw,
      regions: [[CODE_BASE, inAPortRet(0x99)]],
    })
    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(0x55)
  })

  it('defaults to 0xFF when no hardware port handler', () => {
    const m = createMachine(inAPortRet(0x50))
    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(0xFF)
  })

  it('hardware hooks fire when PC reaches target', () => {
    let hookFired = false
    const hw: Hardware = {
      readPort: () => 0xFF,
      writePort: () => {},
      hooks: new Map([[CODE_BASE + 1, () => { hookFired = true }]]),
      stubs: [],
    }
    // NOP ; NOP ; NOP ; RET
    const code = new Uint8Array([0x00, 0x00, 0x00, 0xC9])
    const m = new Z80TestMachine({ hardware: hw, regions: [[CODE_BASE, code]] })
    m.runFrom(CODE_BASE)
    expect(hookFired).toBe(true)
  })

  it('hardware stubs place RET at addresses', () => {
    const hw: Hardware = {
      readPort: () => 0xFF,
      writePort: () => {},
      hooks: new Map(),
      stubs: [0x0041, 0x0047],
    }
    const m = new Z80TestMachine({ hardware: hw })
    expect(m.readByte(0x0041)).toBe(0xC9)
    expect(m.readByte(0x0047)).toBe(0xC9)
  })

  it('CALL to stub returns immediately', () => {
    const hw: Hardware = {
      readPort: () => 0xFF,
      writePort: () => {},
      hooks: new Map(),
      stubs: [0x0041],
    }
    // CALL 0x0041 ; LD A, 5 ; RET
    const code = new Uint8Array([0xCD, 0x41, 0x00, 0x3E, 0x05, 0xC9])
    const m = new Z80TestMachine({ hardware: hw, regions: [[CODE_BASE, code]] })
    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(5)
  })
})

describe('user hooks merge with hardware hooks', () => {
  it('both hardware and user hooks fire', () => {
    const fired: string[] = []
    const hw: Hardware = {
      readPort: () => 0xFF,
      writePort: () => {},
      hooks: new Map([[CODE_BASE, () => { fired.push('hw') }]]),
      stubs: [],
    }
    const userHooks = new Map<number, PcHook>([
      [CODE_BASE + 1, () => { fired.push('user') }],
    ])
    // NOP ; NOP ; RET
    const code = new Uint8Array([0x00, 0x00, 0xC9])
    const m = new Z80TestMachine({
      hardware: hw,
      hooks: userHooks,
      regions: [[CODE_BASE, code]],
    })
    m.runFrom(CODE_BASE)
    expect(fired).toEqual(['hw', 'user'])
  })

  it('user stubs merge with hardware stubs', () => {
    const hw: Hardware = {
      readPort: () => 0xFF,
      writePort: () => {},
      hooks: new Map(),
      stubs: [0x0041],
    }
    const m = new Z80TestMachine({
      hardware: hw,
      stubs: [0x0050],
    })
    expect(m.readByte(0x0041)).toBe(0xC9)
    expect(m.readByte(0x0050)).toBe(0xC9)
  })
})

describe('with SymbolProvider port', () => {
  it('sym() resolves via SymbolProvider', () => {
    const symbols: SymbolProvider = {
      resolve: (name) => name === 'my_func' ? 0x4030 : undefined,
      has: (name) => name === 'my_func',
    }
    const m = new Z80TestMachine({ symbols })
    expect(m.sym('my_func')).toBe(0x4030)
  })

  it('sym() throws for unknown symbol', () => {
    const symbols: SymbolProvider = {
      resolve: () => undefined,
      has: () => false,
    }
    const m = new Z80TestMachine({ symbols })
    expect(() => m.sym('nope')).toThrow(/Unknown symbol/)
  })

  it('hasSym() delegates to SymbolProvider', () => {
    const symbols: SymbolProvider = {
      resolve: (name) => name === 'exists' ? 0x100 : undefined,
      has: (name) => name === 'exists',
    }
    const m = new Z80TestMachine({ symbols })
    expect(m.hasSym('exists')).toBe(true)
    expect(m.hasSym('nope')).toBe(false)
  })

  it('hasSym returns false when no symbol provider', () => {
    const m = createMachine(halt())
    expect(m.hasSym('anything')).toBe(false)
  })

  it('runFunction resolves symbol and executes', () => {
    const code = ldaRet(77)
    const symbols: SymbolProvider = {
      resolve: (name) => name === 'load77' ? CODE_BASE : undefined,
      has: (name) => name === 'load77',
    }
    const m = new Z80TestMachine({
      symbols,
      regions: [[CODE_BASE, code]],
    })
    m.runFunction('load77')
    expect(m.regs.a).toBe(77)
  })
})

describe('hook can modify registers', () => {
  it('hook sets register A', () => {
    // NOP ; RET — hook on NOP sets A=99
    const code = new Uint8Array([0x00, 0xC9])
    const hooks = new Map<number, PcHook>([[CODE_BASE, (m) => { m.regs.a = 99 }]])
    const m = new Z80TestMachine({ regions: [[CODE_BASE, code]], hooks })
    m.runFrom(CODE_BASE)
    expect(m.regs.a).toBe(99)
  })
})
