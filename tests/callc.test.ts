import { describe, it, expect } from 'vitest'
import { Z80TestMachine } from '../src/core/machine.js'
import { callC, defC } from '../src/callc.js'
import { sdcccall1 } from '../src/calling-convention/sdcccall1.js'
import type { SymbolProvider } from '../src/core/types.js'

const CODE_BASE = 0x100

/**
 * Helper: build a machine with named functions at known addresses.
 * Each entry maps a symbol name to Z80 machine code placed sequentially.
 */
function createMachineWithFunctions(
  funcs: Record<string, Uint8Array>,
): Z80TestMachine {
  const addresses: Record<string, number> = {}
  const regions: Array<[number, Uint8Array]> = []
  let addr = CODE_BASE

  for (const [name, code] of Object.entries(funcs)) {
    addresses[name] = addr
    regions.push([addr, code])
    addr += code.length + 4 // gap between functions
  }

  const symbols: SymbolProvider = {
    resolve: (name) => addresses[name],
    has: (name) => name in addresses,
  }

  return new Z80TestMachine({ symbols, regions })
}

describe('callC', () => {
  describe('no arguments', () => {
    it('calls a void function with no args', () => {
      // LD A, 42 ; RET
      const m = createMachineWithFunctions({
        no_args: new Uint8Array([0x3E, 42, 0xC9]),
      })
      const result = callC(m, 'no_args')
      expect(result.value).toBe(0)
      expect(result.tStates).toBeGreaterThan(0)
    })
  })

  describe('u8 return', () => {
    it('reads return value from A register', () => {
      // LD A, 99 ; RET
      const m = createMachineWithFunctions({
        get99: new Uint8Array([0x3E, 99, 0xC9]),
      })
      const result = callC(m, 'get99', { ret: 'u8' })
      expect(result.value).toBe(99)
    })
  })

  describe('u16 return', () => {
    it('reads return value from DE register', () => {
      // LD DE, 0x1234 ; RET
      const m = createMachineWithFunctions({
        get_addr: new Uint8Array([0x11, 0x34, 0x12, 0xC9]),
      })
      const result = callC(m, 'get_addr', { ret: 'u16' })
      expect(result.value).toBe(0x1234)
    })
  })

  describe('single u8 argument', () => {
    it('places first u8 in A register', () => {
      // INC A ; RET  (returns arg + 1)
      const m = createMachineWithFunctions({
        inc: new Uint8Array([0x3C, 0xC9]),
      })
      const result = callC(m, 'inc', { args: [10], ret: 'u8' })
      expect(result.value).toBe(11)
    })

    it('bare number is treated as u8', () => {
      // INC A ; RET
      const m = createMachineWithFunctions({
        inc: new Uint8Array([0x3C, 0xC9]),
      })
      const result = callC(m, 'inc', { args: [0xFF], ret: 'u8' })
      expect(result.value).toBe(0) // wraps around
    })
  })

  describe('single u16 argument', () => {
    it('places first u16 in DE register', () => {
      // LD A, D ; RET  (returns high byte of DE arg)
      const m = createMachineWithFunctions({
        high_byte: new Uint8Array([0x7A, 0xC9]),
      })
      const result = callC(m, 'high_byte', {
        args: [{ type: 'u16', value: 0xAB00 }],
        ret: 'u8',
      })
      expect(result.value).toBe(0xAB)
    })
  })

  describe('mixed register arguments', () => {
    it('places u8 in A and u16 in DE', () => {
      // ADD A, E ; RET  (A = first_u8 + low_byte(first_u16))
      const m = createMachineWithFunctions({
        add_ae: new Uint8Array([0x83, 0xC9]),
      })
      const result = callC(m, 'add_ae', {
        args: [10, { type: 'u16', value: 0x0005 }],
        ret: 'u8',
      })
      expect(result.value).toBe(15)
    })

    it('u16 first, u8 second — both go to registers', () => {
      // ADD A, E ; RET
      const m = createMachineWithFunctions({
        add_ae: new Uint8Array([0x83, 0xC9]),
      })
      const result = callC(m, 'add_ae', {
        args: [{ type: 'u16', value: 0x0003 }, 10],
        ret: 'u8',
      })
      // A=10 (first u8), E=3 (first u16 low byte) → 13
      expect(result.value).toBe(13)
    })
  })

  describe('stack arguments', () => {
    it('second u8 arg goes to stack', () => {
      // The function reads SP+2 (skip return addr pushed by runFunction)
      // POP HL ; POP BC ; PUSH HL ; LD A, C ; RET
      // (pop return addr into HL, pop arg into BC, restore return addr, return C in A)
      const m = createMachineWithFunctions({
        read_stack: new Uint8Array([0xE1, 0xC1, 0xE5, 0x79, 0xC9]),
      })
      const result = callC(m, 'read_stack', {
        args: [1, 42],  // A=1 (register), 42 (stack)
        ret: 'u8',
      })
      expect(result.value).toBe(42)
    })
  })

  describe('explicit ArgValue objects', () => {
    it('accepts { type: "u8", value } form', () => {
      // INC A ; RET
      const m = createMachineWithFunctions({
        inc: new Uint8Array([0x3C, 0xC9]),
      })
      const result = callC(m, 'inc', {
        args: [{ type: 'u8', value: 5 }],
        ret: 'u8',
      })
      expect(result.value).toBe(6)
    })
  })

  describe('custom calling convention', () => {
    it('accepts a cc override', () => {
      const cc = sdcccall1()
      // LD A, 77 ; RET
      const m = createMachineWithFunctions({
        f: new Uint8Array([0x3E, 77, 0xC9]),
      })
      const result = callC(m, 'f', { ret: 'u8', cc })
      expect(result.value).toBe(77)
    })
  })

  describe('tStates tracking', () => {
    it('returns T-state count', () => {
      // NOP ; NOP ; RET
      const m = createMachineWithFunctions({
        nops: new Uint8Array([0x00, 0x00, 0xC9]),
      })
      const result = callC(m, 'nops')
      expect(result.tStates).toBeGreaterThan(0)
    })
  })
})

describe('sdcccall1 placeArgs edge cases', () => {
  it('no args leaves registers untouched', () => {
    const m = createMachineWithFunctions({
      nop: new Uint8Array([0x00, 0xC9]),
    })
    m.regs.a = 0xEE
    callC(m, 'nop')
    // A was not overwritten by placeArgs (no args to place)
  })

  it('three u8 args: first in A, rest on stack', () => {
    // Stack args are 1 byte each, at SP+2 and SP+3 (after 2-byte return addr).
    // LD HL, 2 ; ADD HL, SP ; LD A, (HL) ; INC HL ; LD C, (HL) ; ADD A, C ; RET
    const m = createMachineWithFunctions({
      add_stack: new Uint8Array([
        0x21, 0x02, 0x00, // LD HL, 2
        0x39,             // ADD HL, SP
        0x7E,             // LD A, (HL)   — 2nd arg
        0x23,             // INC HL
        0x4E,             // LD C, (HL)   — 3rd arg
        0x81,             // ADD A, C
        0xC9,             // RET
      ]),
    })
    const result = callC(m, 'add_stack', {
      args: [99, 10, 20],  // A=99 (register), stack: 10, 20
      ret: 'u8',
    })
    expect(result.value).toBe(30) // 10 + 20
  })
})

describe('defC', () => {
  describe('signature and binding', () => {
    it('defines a signature and binds to a machine', () => {
      // INC A ; RET
      const m = createMachineWithFunctions({
        inc: new Uint8Array([0x3C, 0xC9]),
      })
      const inc = defC('inc', ['u8'], 'u8')
      const bound = inc(m)
      expect(bound(10)).toBe(11)
    })

    it('supports inline binding', () => {
      // INC A ; RET
      const m = createMachineWithFunctions({
        inc: new Uint8Array([0x3C, 0xC9]),
      })
      const inc = defC('inc', ['u8'], 'u8')(m)
      expect(inc(10)).toBe(11)
    })
  })

  describe('return types', () => {
    it('u8 returns the value directly', () => {
      // LD A, 99 ; RET
      const m = createMachineWithFunctions({
        get99: new Uint8Array([0x3E, 99, 0xC9]),
      })
      const get99 = defC('get99', [], 'u8')(m)
      expect(get99()).toBe(99)
    })

    it('u16 returns the value directly', () => {
      // LD DE, 0x1234 ; RET
      const m = createMachineWithFunctions({
        get_addr: new Uint8Array([0x11, 0x34, 0x12, 0xC9]),
      })
      const getAddr = defC('get_addr', [], 'u16')(m)
      expect(getAddr()).toBe(0x1234)
    })

    it('void returns undefined', () => {
      // NOP ; RET
      const m = createMachineWithFunctions({
        nop: new Uint8Array([0x00, 0xC9]),
      })
      const nop = defC('nop', [], 'void')(m)
      expect(nop()).toBeUndefined()
    })
  })

  describe('argument types', () => {
    it('passes u8 args correctly', () => {
      // INC A ; RET
      const m = createMachineWithFunctions({
        inc: new Uint8Array([0x3C, 0xC9]),
      })
      const inc = defC('inc', ['u8'], 'u8')(m)
      expect(inc(0xFF)).toBe(0) // wraps
    })

    it('passes u16 args into DE', () => {
      // LD A, D ; RET  (returns high byte of DE)
      const m = createMachineWithFunctions({
        high_byte: new Uint8Array([0x7A, 0xC9]),
      })
      const highByte = defC('high_byte', ['u16'], 'u8')(m)
      expect(highByte(0xAB00)).toBe(0xAB)
    })

    it('passes mixed u8 and u16 args', () => {
      // ADD A, E ; RET
      const m = createMachineWithFunctions({
        add_ae: new Uint8Array([0x83, 0xC9]),
      })
      const addAE = defC('add_ae', ['u8', 'u16'], 'u8')(m)
      // A=10 (first u8), DE=0x0005 (first u16), result = 10+5
      expect(addAE(10, 0x0005)).toBe(15)
    })

    it('passes multiple u8 args (register + stack)', () => {
      // POP HL ; POP BC ; PUSH HL ; LD A, C ; RET
      const m = createMachineWithFunctions({
        read_stack: new Uint8Array([0xE1, 0xC1, 0xE5, 0x79, 0xC9]),
      })
      const readStack = defC('read_stack', ['u8', 'u8'], 'u8')(m)
      expect(readStack(1, 42)).toBe(42)
    })
  })

  describe('detailed()', () => {
    it('returns value and tStates', () => {
      // LD A, 99 ; RET
      const m = createMachineWithFunctions({
        get99: new Uint8Array([0x3E, 99, 0xC9]),
      })
      const get99 = defC('get99', [], 'u8')(m)
      const result = get99.detailed()
      expect(result.value).toBe(99)
      expect(result.tStates).toBeGreaterThan(0)
    })

    it('returns tStates for void functions', () => {
      // NOP ; NOP ; RET
      const m = createMachineWithFunctions({
        nops: new Uint8Array([0x00, 0x00, 0xC9]),
      })
      const nops = defC('nops', [], 'void')(m)
      const result = nops.detailed()
      expect(result.value).toBe(0)
      expect(result.tStates).toBeGreaterThan(0)
    })
  })

  describe('reusable signatures', () => {
    it('same signature can bind to different machines', () => {
      const inc = defC('inc', ['u8'], 'u8')

      // INC A ; RET
      const m1 = createMachineWithFunctions({
        inc: new Uint8Array([0x3C, 0xC9]),
      })
      // INC A ; INC A ; RET  (adds 2 instead of 1)
      const m2 = createMachineWithFunctions({
        inc: new Uint8Array([0x3C, 0x3C, 0xC9]),
      })

      expect(inc(m1)(10)).toBe(11)
      expect(inc(m2)(10)).toBe(12)
    })
  })

  describe('custom calling convention', () => {
    it('accepts cc in options', () => {
      // LD A, 77 ; RET
      const m = createMachineWithFunctions({
        f: new Uint8Array([0x3E, 77, 0xC9]),
      })
      const f = defC('f', [], 'u8', { cc: sdcccall1() })(m)
      expect(f()).toBe(77)
    })
  })

  describe('no arguments', () => {
    it('works with empty arg list', () => {
      // LD A, 42 ; RET
      const m = createMachineWithFunctions({
        get42: new Uint8Array([0x3E, 42, 0xC9]),
      })
      const get42 = defC('get42', [], 'u8')(m)
      expect(get42()).toBe(42)
    })
  })
})
