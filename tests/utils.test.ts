import { describe, it, expect } from 'vitest'
import { Z80TestMachine } from '../src/core/machine.js'
import { pushStackArg, signed8, loadRom } from '../src/utils.js'
import { writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { tmpdir } from 'os'

describe('pushStackArg', () => {
  it('decrements SP and writes value', () => {
    const m = new Z80TestMachine({ stackPointer: 0xF380 })
    pushStackArg(m, 0x42)
    expect(m.regs.sp).toBe(0xF37F)
    expect(m.readByte(0xF37F)).toBe(0x42)
  })

  it('masks value to 8 bits', () => {
    const m = new Z80TestMachine({ stackPointer: 0xF380 })
    pushStackArg(m, 0x1AB) // only low byte should be written
    expect(m.readByte(0xF37F)).toBe(0xAB)
  })

  it('multiple pushes stack in order', () => {
    const m = new Z80TestMachine({ stackPointer: 0xF380 })
    pushStackArg(m, 0xAA) // pushed first (higher address)
    pushStackArg(m, 0xBB) // pushed second (lower address)
    expect(m.readByte(0xF37F)).toBe(0xAA)
    expect(m.readByte(0xF37E)).toBe(0xBB)
    expect(m.regs.sp).toBe(0xF37E)
  })

  it('wraps SP at 16-bit boundary', () => {
    const m = new Z80TestMachine({ stackPointer: 0x0000 })
    pushStackArg(m, 0x01)
    expect(m.regs.sp).toBe(0xFFFF)
  })
})

describe('signed8', () => {
  it('positive values unchanged', () => {
    expect(signed8(0)).toBe(0)
    expect(signed8(1)).toBe(1)
    expect(signed8(127)).toBe(127)
  })

  it('converts values >= 128 to negative', () => {
    expect(signed8(128)).toBe(-128)
    expect(signed8(255)).toBe(-1)
    expect(signed8(200)).toBe(-56)
    expect(signed8(0xFE)).toBe(-2)
  })
})

describe('loadRom', () => {
  it('loads a binary file as Uint8Array', () => {
    const dir = resolve(tmpdir(), 'z80-test-lib-utils-test')
    mkdirSync(dir, { recursive: true })
    const path = resolve(dir, 'test.rom')
    writeFileSync(path, Buffer.from([0x3E, 0x42, 0xC9]))

    const rom = loadRom(path)
    expect(rom).toBeInstanceOf(Uint8Array)
    expect(rom.length).toBe(3)
    expect(rom[0]).toBe(0x3E)
    expect(rom[1]).toBe(0x42)
    expect(rom[2]).toBe(0xC9)

    unlinkSync(path)
  })
})
