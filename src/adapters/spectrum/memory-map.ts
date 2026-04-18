import type { MemoryMap } from '../../core/types.js'

/**
 * ZX Spectrum 48K memory layout:
 *   0x0000-0x3FFF  16K ROM (read-only)
 *   0x4000-0x57FF  Screen + attributes
 *   0x5800-0xFFFF  RAM (program + stack)
 *
 * 128K paging is not modelled — assume a fixed 48K address space.
 * The default ORG (0x8000) matches z88dk's `+zx` target.
 */
export const spectrumMemoryMap: MemoryMap = {
  defaultRomLoadAddress: 0x8000,
  defaultStackPointer: 0xFF58,
  isWritable: (addr) => addr >= 0x4000,
}
