import { describe, it, expect } from 'vitest'
import { Z80TestMachine } from '../src/core/machine.js'
import { ffi } from '../src/ffi.js'

const RAM_BASE = 0x8000

function createMachine(): Z80TestMachine {
  return new Z80TestMachine()
}

describe('ffi.var', () => {
  describe('u8', () => {
    it('reads a byte', () => {
      const m = createMachine()
      m.writeByte(RAM_BASE, 42)
      const v = ffi.var(RAM_BASE, 'u8').bind(m)
      expect(v.get()).toBe(42)
    })

    it('writes a byte', () => {
      const m = createMachine()
      const v = ffi.var(RAM_BASE, 'u8').bind(m)
      v.set(99)
      expect(m.readByte(RAM_BASE)).toBe(99)
    })

    it('reads 0xFF as 255 (unsigned)', () => {
      const m = createMachine()
      m.writeByte(RAM_BASE, 0xFF)
      const v = ffi.var(RAM_BASE, 'u8').bind(m)
      expect(v.get()).toBe(255)
    })
  })

  describe('i8', () => {
    it('reads positive values', () => {
      const m = createMachine()
      m.writeByte(RAM_BASE, 100)
      const v = ffi.var(RAM_BASE, 'i8').bind(m)
      expect(v.get()).toBe(100)
    })

    it('reads negative values', () => {
      const m = createMachine()
      m.writeByte(RAM_BASE, 0xFB) // -5 in two's complement
      const v = ffi.var(RAM_BASE, 'i8').bind(m)
      expect(v.get()).toBe(-5)
    })

    it('writes negative values', () => {
      const m = createMachine()
      const v = ffi.var(RAM_BASE, 'i8').bind(m)
      v.set(-1)
      expect(m.readByte(RAM_BASE)).toBe(0xFF)
    })

    it('reads 0x80 as -128', () => {
      const m = createMachine()
      m.writeByte(RAM_BASE, 0x80)
      const v = ffi.var(RAM_BASE, 'i8').bind(m)
      expect(v.get()).toBe(-128)
    })

    it('reads 0x7F as 127', () => {
      const m = createMachine()
      m.writeByte(RAM_BASE, 0x7F)
      const v = ffi.var(RAM_BASE, 'i8').bind(m)
      expect(v.get()).toBe(127)
    })
  })

  describe('u16', () => {
    it('reads a word (little-endian)', () => {
      const m = createMachine()
      m.writeWord(RAM_BASE, 0x1234)
      const v = ffi.var(RAM_BASE, 'u16').bind(m)
      expect(v.get()).toBe(0x1234)
    })

    it('writes a word (little-endian)', () => {
      const m = createMachine()
      const v = ffi.var(RAM_BASE, 'u16').bind(m)
      v.set(0xABCD)
      expect(m.readWord(RAM_BASE)).toBe(0xABCD)
    })

    it('reads 0xFFFF as 65535 (unsigned)', () => {
      const m = createMachine()
      m.writeWord(RAM_BASE, 0xFFFF)
      const v = ffi.var(RAM_BASE, 'u16').bind(m)
      expect(v.get()).toBe(65535)
    })
  })

  describe('i16', () => {
    it('reads positive values', () => {
      const m = createMachine()
      m.writeWord(RAM_BASE, 1000)
      const v = ffi.var(RAM_BASE, 'i16').bind(m)
      expect(v.get()).toBe(1000)
    })

    it('reads negative values', () => {
      const m = createMachine()
      m.writeWord(RAM_BASE, 0xFFFF) // -1 in two's complement
      const v = ffi.var(RAM_BASE, 'i16').bind(m)
      expect(v.get()).toBe(-1)
    })

    it('writes negative values', () => {
      const m = createMachine()
      const v = ffi.var(RAM_BASE, 'i16').bind(m)
      v.set(-100)
      expect(m.readWord(RAM_BASE)).toBe(0xFF9C) // -100 as u16
    })

    it('reads 0x8000 as -32768', () => {
      const m = createMachine()
      m.writeWord(RAM_BASE, 0x8000)
      const v = ffi.var(RAM_BASE, 'i16').bind(m)
      expect(v.get()).toBe(-32768)
    })

    it('reads 0x7FFF as 32767', () => {
      const m = createMachine()
      m.writeWord(RAM_BASE, 0x7FFF)
      const v = ffi.var(RAM_BASE, 'i16').bind(m)
      expect(v.get()).toBe(32767)
    })
  })

  describe('schema reuse', () => {
    it('same schema can bind to different machines', () => {
      const m1 = createMachine()
      const m2 = createMachine()
      m1.writeByte(RAM_BASE, 10)
      m2.writeByte(RAM_BASE, 20)

      const schema = ffi.var(RAM_BASE, 'u8')
      expect(schema.bind(m1).get()).toBe(10)
      expect(schema.bind(m2).get()).toBe(20)
    })
  })

  describe('addr property', () => {
    it('exposes the memory address on bound variable', () => {
      const m = createMachine()
      const v = ffi.var(0xC000, 'u8').bind(m)
      expect(v.addr).toBe(0xC000)
    })

    it('exposes the memory address on the schema (no machine needed)', () => {
      const schema = ffi.var(0xC000, 'u8')
      expect(schema.addr).toBe(0xC000)
    })
  })

  describe('one-shot forms', () => {
    it('get(m) reads directly against a machine', () => {
      const m = createMachine()
      m.writeByte(RAM_BASE, 77)
      const score = ffi.var(RAM_BASE, 'u8')
      expect(score.get(m)).toBe(77)
    })

    it('set(m, value) writes directly against a machine', () => {
      const m = createMachine()
      const score = ffi.var(RAM_BASE, 'u8')
      score.set(m, 123)
      expect(m.readByte(RAM_BASE)).toBe(123)
    })

    it('get/set handle signed types', () => {
      const m = createMachine()
      const velocity = ffi.var(RAM_BASE, 'i8')
      velocity.set(m, -5)
      expect(velocity.get(m)).toBe(-5)
    })
  })

  describe('live reads', () => {
    it('reflects memory changes between reads', () => {
      const m = createMachine()
      const v = ffi.var(RAM_BASE, 'u8').bind(m)

      m.writeByte(RAM_BASE, 1)
      expect(v.get()).toBe(1)

      m.writeByte(RAM_BASE, 2)
      expect(v.get()).toBe(2)
    })
  })
})
