import type { Hardware, PcHook, MachineInterface } from '../../core/types.js'
import type { Tms9918 } from '../../devices/tms9918.js'
import { MSX_BIOS } from './constants.js'

const ALL_MSX_BIOS_STUBS = Object.values(MSX_BIOS)

export function createMsxHardware(
  vdp: Tms9918,
  keyboard: Uint8Array,
): Hardware {
  const hooks = new Map<number, PcHook>()

  // SNSMAT: return keyboard row value from register A
  hooks.set(MSX_BIOS.SNSMAT, (m: MachineInterface) => {
    const row = m.regs.a & 0x0F
    m.regs.a = keyboard[row]
  })

  // WRTVRM: HL=vram_addr, A=data
  hooks.set(MSX_BIOS.WRTVRM, (m: MachineInterface) => {
    vdp.writeVram(m.regs.hl, m.regs.a)
  })

  // LDIRVM: DE=vram_addr, HL=ram_addr, BC=len
  hooks.set(MSX_BIOS.LDIRVM, (m: MachineInterface) => {
    const vramAddr = m.regs.de
    const ramAddr = m.regs.hl
    const len = m.regs.bc
    if (len === 0) return
    for (let i = 0; i < len; i++) {
      vdp.writeVram(vramAddr + i, m.readByte(ramAddr + i))
    }
  })

  // FILVRM: HL=vram_addr, A=fill_byte, BC=len
  hooks.set(MSX_BIOS.FILVRM, (m: MachineInterface) => {
    const vramAddr = m.regs.hl
    const value = m.regs.a
    const len = m.regs.bc
    if (len === 0) return
    vdp.fillVram(vramAddr, value, len)
  })

  return {
    readPort(port: number): number {
      switch (port) {
        case 0x98: return vdp.readData()
        case 0x99: return vdp.readStatus()
        case 0xA8: return 0x00 // PPI slot select
        case 0xA9: return 0xFF // Keyboard column — all released
        case 0xAA: return 0x00 // PPI port C
        default: return 0xFF
      }
    },

    writePort(port: number, value: number): void {
      switch (port) {
        case 0x98: vdp.writeData(value); break
        case 0x99: vdp.writeControl(value); break
      }
    },

    hooks,
    stubs: ALL_MSX_BIOS_STUBS,
  }
}
