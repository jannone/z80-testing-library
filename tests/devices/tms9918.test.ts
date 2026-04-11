import { describe, it, expect, beforeEach } from 'vitest'
import { Tms9918, TMS9918_LAYOUT } from '../../src/devices/tms9918.js'

describe('Tms9918', () => {
  let vdp: Tms9918

  beforeEach(() => {
    vdp = new Tms9918()
  })

  describe('register writes via control port', () => {
    it('records a register write (two-byte sequence)', () => {
      // Write value 0x02 to register 1: send 0x02 then 0x81
      vdp.writeControl(0x02) // data byte
      vdp.writeControl(0x81) // register 1 | 0x80

      const writes = vdp.getRegisterWrites()
      expect(writes).toEqual([{ register: 1, value: 0x02 }])
    })

    it('records multiple register writes', () => {
      vdp.writeControl(0xE0) // data
      vdp.writeControl(0x87) // register 7
      vdp.writeControl(0x00) // data
      vdp.writeControl(0x80) // register 0

      const writes = vdp.getRegisterWrites()
      expect(writes).toHaveLength(2)
      expect(writes[0]).toEqual({ register: 7, value: 0xE0 })
      expect(writes[1]).toEqual({ register: 0, value: 0x00 })
    })

    it('ignores VRAM address setup (bit 7 clear on second byte)', () => {
      vdp.writeControl(0x00) // low byte of VRAM address
      vdp.writeControl(0x40) // high byte with bit 7=0 (VRAM write setup)

      expect(vdp.getRegisterWrites()).toHaveLength(0)
    })
  })

  describe('data port', () => {
    it('records data writes', () => {
      vdp.writeData(0xAA)
      vdp.writeData(0xBB)

      const writes = vdp.getVramWrites()
      expect(writes).toEqual([{ value: 0xAA }, { value: 0xBB }])
    })

    it('data write resets control flip-flop', () => {
      vdp.writeControl(0x05) // first byte of a pair
      vdp.writeData(0xFF)    // resets flip-flop
      vdp.writeControl(0x02) // now this is a fresh first byte
      vdp.writeControl(0x81) // register 1

      const writes = vdp.getRegisterWrites()
      expect(writes).toEqual([{ register: 1, value: 0x02 }])
    })

    it('readData resets flip-flop', () => {
      vdp.writeControl(0x05) // first byte
      vdp.readData()         // resets
      vdp.writeControl(0x0A) // fresh first byte
      vdp.writeControl(0x82) // register 2

      expect(vdp.getRegisterWrites()).toEqual([{ register: 2, value: 0x0A }])
    })

    it('readStatus resets flip-flop', () => {
      vdp.writeControl(0x05) // first byte
      vdp.readStatus()       // resets
      vdp.writeControl(0x0A) // fresh first byte
      vdp.writeControl(0x83) // register 3

      expect(vdp.getRegisterWrites()).toEqual([{ register: 3, value: 0x0A }])
    })
  })

  describe('VRAM buffer', () => {
    it('writeVram / readVram round-trips', () => {
      vdp.writeVram(0x1800, 0x42)
      expect(vdp.readVram(0x1800)).toBe(0x42)
    })

    it('writeVram masks to 14-bit address space', () => {
      vdp.writeVram(0x4000 + 0x100, 0xAB) // wraps to 0x0100
      expect(vdp.readVram(0x0100)).toBe(0xAB)
    })

    it('fillVram fills a range', () => {
      vdp.fillVram(0x1000, 0xFF, 4)
      expect(vdp.readVram(0x1000)).toBe(0xFF)
      expect(vdp.readVram(0x1001)).toBe(0xFF)
      expect(vdp.readVram(0x1002)).toBe(0xFF)
      expect(vdp.readVram(0x1003)).toBe(0xFF)
      expect(vdp.readVram(0x1004)).toBe(0x00) // untouched
    })

    it('writeVramBlock copies data', () => {
      vdp.writeVramBlock(0x2000, [0x10, 0x20, 0x30], 3)
      expect(vdp.readVram(0x2000)).toBe(0x10)
      expect(vdp.readVram(0x2001)).toBe(0x20)
      expect(vdp.readVram(0x2002)).toBe(0x30)
    })
  })

  describe('SAT entry reading', () => {
    it('reads a sprite attribute entry', () => {
      const base = TMS9918_LAYOUT.SAT
      vdp.writeVram(base + 0, 100)  // Y
      vdp.writeVram(base + 1, 50)   // X
      vdp.writeVram(base + 2, 8)    // pattern
      vdp.writeVram(base + 3, 0x0F) // color

      const entry = vdp.readSatEntry(0)
      expect(entry).toEqual({ y: 100, x: 50, pattern: 8, color: 0x0F })
    })

    it('reads different SAT indices', () => {
      const base = TMS9918_LAYOUT.SAT + 2 * 4 // entry 2
      vdp.writeVram(base + 0, 200)
      vdp.writeVram(base + 1, 150)
      vdp.writeVram(base + 2, 16)
      vdp.writeVram(base + 3, 0x0A)

      const entry = vdp.readSatEntry(2)
      expect(entry).toEqual({ y: 200, x: 150, pattern: 16, color: 0x0A })
    })
  })

  describe('PNT tile reading', () => {
    it('reads a tile from the Pattern Name Table', () => {
      const pntBase = TMS9918_LAYOUT.PNT
      vdp.writeVram(pntBase + 5 * 32 + 10, 0x42) // row 5, col 10

      expect(vdp.readPntTile(10, 5)).toBe(0x42)
    })
  })

  describe('clear', () => {
    it('clears recorded writes but keeps VRAM', () => {
      vdp.writeControl(0x02)
      vdp.writeControl(0x81)
      vdp.writeData(0xAA)
      vdp.writeVram(0x1000, 0xBB)

      vdp.clear()

      expect(vdp.getRegisterWrites()).toHaveLength(0)
      expect(vdp.getVramWrites()).toHaveLength(0)
      expect(vdp.readVram(0x1000)).toBe(0xBB) // VRAM preserved
    })

    it('clearAll also zeros VRAM', () => {
      vdp.writeVram(0x1000, 0xBB)
      vdp.clearAll()
      expect(vdp.readVram(0x1000)).toBe(0x00)
    })
  })
})
