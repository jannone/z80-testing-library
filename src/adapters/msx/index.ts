import { Z80TestMachine, type Z80TestMachineConfig } from '../../core/machine.js'
import type { PcHook, MemoryRegion } from '../../core/types.js'
import { Tms9918 } from '../../devices/tms9918.js'
import { SdccSymbolProvider } from '../../symbols/sdcc.js'
import { msxMemoryMap } from './memory-map.js'
import { createMsxHardware } from './hardware.js'

export { MSX_BIOS } from './constants.js'
export { msxMemoryMap } from './memory-map.js'

export interface MsxTestbedConfig {
  /** ROM data to load at 0x4000 */
  rom?: Uint8Array

  /** ROM load address (default: 0x4000 for MSX cartridge slot 1) */
  romLoadAddress?: number

  /** Path to SDCC .noi symbol file */
  symbolsPath?: string

  /** Directory containing SDCC .lst files for static symbol resolution */
  lstDir?: string

  /** Initial stack pointer (default: 0xF380) */
  stackPointer?: number

  /** Additional stub addresses beyond the standard MSX BIOS set */
  extraStubs?: number[]

  /** Additional memory regions to load */
  regions?: MemoryRegion[]

  /** Additional PC-triggered hooks */
  hooks?: Map<number, PcHook>
}

export interface MsxTestbed {
  machine: Z80TestMachine
  vdp: Tms9918
  keyboard: Uint8Array
}

export function createMsxTestbed(config: MsxTestbedConfig = {}): MsxTestbed {
  const vdp = new Tms9918()
  const keyboard = new Uint8Array(16).fill(0xFF)

  const hardware = createMsxHardware(vdp, keyboard)

  const symbols = config.symbolsPath
    ? new SdccSymbolProvider(config.symbolsPath, config.lstDir)
    : undefined

  const machine = new Z80TestMachine({
    memoryMap: msxMemoryMap,
    hardware,
    symbols,
    rom: config.rom,
    romLoadAddress: config.romLoadAddress,
    regions: config.regions,
    stackPointer: config.stackPointer,
    hooks: config.hooks,
    stubs: config.extraStubs,
  })

  return { machine, vdp, keyboard }
}
