import { describe, it, expect } from 'vitest'
import { createSpectrumTestbed, spectrumMemoryMap } from '../../src/adapters/spectrum/index.js'

describe('createSpectrumTestbed', () => {
  it('returns a testbed with a machine', () => {
    const testbed = createSpectrumTestbed()
    expect(testbed.machine).toBeDefined()
  })

  it('uses the Spectrum default stack pointer (below UDG)', () => {
    const { machine } = createSpectrumTestbed()
    expect(machine.regs.sp).toBe(0xFF58)
  })

  it('respects a custom stack pointer', () => {
    const { machine } = createSpectrumTestbed({ stackPointer: 0xF000 })
    expect(machine.regs.sp).toBe(0xF000)
  })

  it('exposes the Spectrum default ROM load address', () => {
    expect(spectrumMemoryMap.defaultRomLoadAddress).toBe(0x8000)
  })
})

describe('Spectrum ROM write protection', () => {
  it('drops CPU writes below 0x4000', () => {
    const { machine } = createSpectrumTestbed()
    // LD A,0x42 ; LD (0x0000),A ; RET
    const code = [0x3E, 0x42, 0x32, 0x00, 0x00, 0xC9]
    machine.writeBlock(0x9000, code)
    machine.runFrom(0x9000)
    // HALT sentinel (0x76) must still be at 0x0000 — ROM write was ignored.
    expect(machine.readByte(0x0000)).toBe(0x76)
  })

  it('accepts CPU writes in RAM', () => {
    const { machine } = createSpectrumTestbed()
    // LD A,0x42 ; LD (0xC000),A ; RET
    const code = [0x3E, 0x42, 0x32, 0x00, 0xC0, 0xC9]
    machine.writeBlock(0x9000, code)
    machine.runFrom(0x9000)
    expect(machine.readByte(0xC000)).toBe(0x42)
  })
})
