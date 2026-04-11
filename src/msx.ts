import { Z80Machine, type MachineConfig, type PcHook } from './machine.js'
import { VdpCapture } from './vdp-capture.js'
import { parseStaticSymbols } from './static-symbols.js'

/** Standard MSX BIOS entry points */
export const MSX_BIOS = {
  DISSCR: 0x0041,
  ENASCR: 0x0044,
  WRTVDP: 0x0047,
  WRTVRM: 0x004D,
  RDVRM:  0x0053,
  FILVRM: 0x0056,
  LDIRVM: 0x005C,
  CHGCLR: 0x0062,
  INIGRP: 0x0072,
  SNSMAT: 0x0141,
} as const

const ALL_MSX_BIOS_STUBS = Object.values(MSX_BIOS)

/** MSX machine with VDP capture and keyboard simulation */
export class MsxMachine extends Z80Machine {
  public vdp: VdpCapture

  /** Configurable keyboard row values for SNSMAT testing (0xFF = all released) */
  public keyboardRows: Uint8Array = new Uint8Array(16).fill(0xFF)

  /** Static (non-exported) symbols resolved from .lst files */
  private staticSymbols: Map<string, number> | null = null

  constructor(config: MsxMachineConfig) {
    const vdp = new VdpCapture()
    const keyboardRows = new Uint8Array(16).fill(0xFF)

    // Build PC hooks: SNSMAT + BIOS VDP hooks + any user-supplied hooks
    const hooks = new Map<number, PcHook>(config.hooks)

    // SNSMAT hook: return keyboard row value
    hooks.set(MSX_BIOS.SNSMAT, (m) => {
      const row = m.regs.a & 0x0F
      m.regs.a = (m as MsxMachine).keyboardRows[row]
    })

    // WRTVRM hook: HL=vram_addr, A=data (set by bios.c wrapper before CALL)
    hooks.set(MSX_BIOS.WRTVRM, (m) => {
      const addr = m.regs.hl
      const value = m.regs.a;
      (m as MsxMachine).vdp.writeVram(addr, value)
    })

    // LDIRVM hook: DE=vram_addr, HL=ram_addr, BC=len (set by bios.c wrapper)
    hooks.set(MSX_BIOS.LDIRVM, (m) => {
      const vramAddr = m.regs.de
      const ramAddr = m.regs.hl
      const len = m.regs.bc
      if (len === 0) return // guard against LDIR with BC=0
      for (let i = 0; i < len; i++) {
        (m as MsxMachine).vdp.writeVram(vramAddr + i, m.readByte(ramAddr + i))
      }
    })

    // FILVRM hook: HL=vram_addr, A=fill_byte, BC=len (set by bios.c wrapper)
    hooks.set(MSX_BIOS.FILVRM, (m) => {
      const vramAddr = m.regs.hl
      const value = m.regs.a
      const len = m.regs.bc
      if (len === 0) return
      (m as MsxMachine).vdp.fillVram(vramAddr, value, len)
    })

    super({
      romPath: config.romPath,
      romLoadAddress: config.romLoadAddress ?? 0x4000,
      symbolsPath: config.symbolsPath,
      stackPointer: config.stackPointer ?? 0xF380,
      stubs: [...ALL_MSX_BIOS_STUBS, ...(config.extraStubs ?? [])],
      regions: config.regions,
      hooks,
      isWritable: (addr) =>
        // RAM (0xC000+) and BIOS/system area (0x0000-0x3FFF) are writable.
        // ROM area (0x4000-0xBFFF) is read-only.
        addr >= 0xC000 || addr < 0x4000,
      onPortRead: (port) => {
        switch (port) {
          case 0x98: return vdp.readData()
          case 0x99: return vdp.readStatus()
          case 0xA8: return 0x00 // PPI slot select
          case 0xA9: return 0xFF // Keyboard column — all released
          case 0xAA: return 0x00 // PPI port C
          default: return 0xFF
        }
      },
      onPortWrite: (port, value) => {
        switch (port) {
          case 0x98: vdp.writeData(value); break
          case 0x99: vdp.writeControl(value); break
        }
      },
    })

    this.vdp = vdp
    this.keyboardRows = keyboardRows

    // Parse static symbols from .lst files if lstDir is provided
    if (config.lstDir && config.symbolsPath) {
      const noiSymbols = this.getSymbolMap()
      if (noiSymbols) {
        this.staticSymbols = parseStaticSymbols(config.lstDir, noiSymbols)
      }
    }
  }

  /** Look up a static (non-exported) symbol address */
  staticSym(name: string): number {
    if (!this.staticSymbols) {
      throw new Error('No static symbols loaded — provide lstDir in config')
    }
    const addr = this.staticSymbols.get(name)
    if (addr === undefined) {
      throw new Error(`Unknown static symbol: ${name}`)
    }
    return addr
  }

  /** Check if a static symbol exists */
  hasStaticSym(name: string): boolean {
    return this.staticSymbols?.has(name) ?? false
  }
}

export interface MsxMachineConfig {
  /** Path to the ROM file */
  romPath: string

  /** ROM load address (default: 0x4000 for MSX cartridge slot 1) */
  romLoadAddress?: number

  /** Path to SDCC .noi symbol file */
  symbolsPath?: string

  /** Initial stack pointer (default: 0xF380) */
  stackPointer?: number

  /** Additional addresses to stub with RET beyond the standard MSX BIOS set */
  extraStubs?: number[]

  /** Additional memory regions to load */
  regions?: [number, Uint8Array][]

  /** Additional PC-triggered hooks (SNSMAT is handled automatically) */
  hooks?: Map<number, PcHook>

  /** Directory containing SDCC .lst files for static symbol resolution */
  lstDir?: string
}
