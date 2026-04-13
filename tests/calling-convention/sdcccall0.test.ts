import { describe, it, expect } from 'vitest'
import { Z80TestMachine } from '../../src/core/machine.js'
import { callC } from '../../src/callc.js'
import { sdcccall0 } from '../../src/calling-convention/sdcccall0.js'
import type { SymbolProvider } from '../../src/core/types.js'

const CODE_BASE = 0x100
const cc = sdcccall0()

function createMachineWithFunctions(
  funcs: Record<string, Uint8Array>,
): Z80TestMachine {
  const addresses: Record<string, number> = {}
  const regions: Array<[number, Uint8Array]> = []
  let addr = CODE_BASE

  for (const [name, code] of Object.entries(funcs)) {
    addresses[name] = addr
    regions.push([addr, code])
    addr += code.length + 4
  }

  const symbols: SymbolProvider = {
    resolve: (name) => addresses[name],
    has: (name) => name in addresses,
  }

  return new Z80TestMachine({ symbols, regions })
}

describe('sdcccall0', () => {
  describe('return values', () => {
    it('reads u8 return from L register', () => {
      // LD L, 99 ; RET
      const m = createMachineWithFunctions({
        get99: new Uint8Array([0x2E, 99, 0xC9]),
      })
      const result = callC(m, 'get99', { ret: 'u8', cc })
      expect(result.value).toBe(99)
    })

    it('reads u16 return from HL register', () => {
      // LD HL, 0x1234 ; RET
      const m = createMachineWithFunctions({
        get_addr: new Uint8Array([0x21, 0x34, 0x12, 0xC9]),
      })
      const result = callC(m, 'get_addr', { ret: 'u16', cc })
      expect(result.value).toBe(0x1234)
    })

    it('returns 0 for void', () => {
      // NOP ; RET
      const m = createMachineWithFunctions({
        nop: new Uint8Array([0x00, 0xC9]),
      })
      const result = callC(m, 'nop', { cc })
      expect(result.value).toBe(0)
    })
  })

  describe('all arguments go to stack', () => {
    it('single u8 arg on stack (not in A)', () => {
      // Read stack arg at SP+2 (after return addr):
      // LD HL, 2 ; ADD HL, SP ; LD L, (HL) ; RET
      const m = createMachineWithFunctions({
        read_arg: new Uint8Array([
          0x21, 0x02, 0x00, // LD HL, 2
          0x39,             // ADD HL, SP
          0x6E,             // LD L, (HL)
          0xC9,             // RET
        ]),
      })
      m.regs.a = 0xFF // should NOT be used as the arg
      const result = callC(m, 'read_arg', { args: [42], ret: 'u8', cc })
      expect(result.value).toBe(42)
    })

    it('single u16 arg on stack (not in DE)', () => {
      // Read 16-bit stack arg at SP+2:
      // LD HL, 2 ; ADD HL, SP ; LD A, (HL) ; INC HL ; LD H, (HL) ; LD L, A ; RET
      const m = createMachineWithFunctions({
        read_u16: new Uint8Array([
          0x21, 0x02, 0x00, // LD HL, 2
          0x39,             // ADD HL, SP
          0x7E,             // LD A, (HL)   — low byte
          0x23,             // INC HL
          0x66,             // LD H, (HL)   — high byte
          0x6F,             // LD L, A      — low byte into L
          0xC9,             // RET
        ]),
      })
      const result = callC(m, 'read_u16', {
        args: [{ type: 'u16', value: 0xABCD }],
        ret: 'u16',
        cc,
      })
      expect(result.value).toBe(0xABCD)
    })

    it('two u8 args both on stack', () => {
      // Read two 1-byte stack args at SP+2 and SP+3, add them:
      // LD HL, 2 ; ADD HL, SP ; LD A, (HL) ; INC HL ; LD C, (HL) ; ADD A, C ; LD L, A ; RET
      const m = createMachineWithFunctions({
        add: new Uint8Array([
          0x21, 0x02, 0x00, // LD HL, 2
          0x39,             // ADD HL, SP
          0x7E,             // LD A, (HL)   — 1st arg
          0x23,             // INC HL
          0x4E,             // LD C, (HL)   — 2nd arg
          0x81,             // ADD A, C
          0x6F,             // LD L, A
          0xC9,             // RET
        ]),
      })
      const result = callC(m, 'add', { args: [10, 20], ret: 'u8', cc })
      expect(result.value).toBe(30)
    })

    it('mixed u8 and u16 args all on stack', () => {
      // Stack layout (from low to high): u8(1 byte) then u16(2 bytes)
      // Read u8 at SP+2, u16 at SP+3:
      // LD HL, 2 ; ADD HL, SP ; LD C, (HL) ; INC HL ; LD A, (HL) ; INC HL ; LD H, (HL) ; LD L, A
      // ; LD A, L ; ADD A, C ; LD L, A ; RET
      // This adds the u8 arg to the low byte of the u16 arg
      const m = createMachineWithFunctions({
        mix: new Uint8Array([
          0x21, 0x02, 0x00, // LD HL, 2
          0x39,             // ADD HL, SP
          0x4E,             // LD C, (HL)   — u8 arg
          0x23,             // INC HL
          0x7E,             // LD A, (HL)   — u16 low byte
          0x81,             // ADD A, C     — add u8 to u16 low byte
          0x6F,             // LD L, A      — result in L
          0xC9,             // RET
        ]),
      })
      const result = callC(m, 'mix', {
        args: [5, { type: 'u16', value: 0x0010 }],
        ret: 'u8',
        cc,
      })
      expect(result.value).toBe(21) // 5 + 0x10
    })
  })

  describe('works with defC', () => {
    it('binds with custom cc option', async () => {
      const { defC } = await import('../../src/callc.js')
      // LD L, 77 ; RET
      const m = createMachineWithFunctions({
        get77: new Uint8Array([0x2E, 77, 0xC9]),
      })
      const get77 = defC('get77', [], 'u8', { cc })(m)
      expect(get77()).toBe(77)
    })
  })
})
