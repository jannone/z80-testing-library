import { Z80TestMachine } from '../../core/machine.js'
import type { PcHook, MemoryRegion } from '../../core/types.js'
import { spectrumMemoryMap } from './memory-map.js'
import { spectrumHardware } from './hardware.js'

export { spectrumMemoryMap } from './memory-map.js'
export { spectrumHardware } from './hardware.js'
export { extractCodeFromTap, type TapCode } from './tap.js'

export interface SpectrumTestbedConfig {
  /** ROM / code data to load (default address 0x8000) */
  rom?: Uint8Array

  /** ROM load address (default: 0x8000 — z88dk `+zx` default ORG) */
  romLoadAddress?: number

  /** Initial stack pointer (default: 0xFF58) */
  stackPointer?: number

  /** Additional memory regions to load */
  regions?: MemoryRegion[]

  /** PC-triggered hooks (e.g. to mimic ROM routines) */
  hooks?: Map<number, PcHook>

  /** Additional addresses to stub with RET */
  extraStubs?: number[]
}

export interface SpectrumTestbed {
  machine: Z80TestMachine
}

export function createSpectrumTestbed(
  config: SpectrumTestbedConfig = {},
): SpectrumTestbed {
  const machine = new Z80TestMachine({
    memoryMap: spectrumMemoryMap,
    hardware: spectrumHardware,
    rom: config.rom,
    romLoadAddress: config.romLoadAddress,
    regions: config.regions,
    stackPointer: config.stackPointer,
    hooks: config.hooks,
    stubs: config.extraStubs,
  })

  return { machine }
}
