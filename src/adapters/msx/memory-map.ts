import type { MemoryMap } from '../../core/types.js'

/** MSX memory layout: BIOS 0x0000-0x3FFF, ROM 0x4000-0xBFFF, RAM 0xC000-0xFFFF */
export const msxMemoryMap: MemoryMap = {
  defaultRomLoadAddress: 0x4000,
  defaultStackPointer: 0xF380,
  isWritable: (addr) =>
    // RAM (0xC000+) and BIOS/system area (0x0000-0x3FFF) are writable.
    // ROM area (0x4000-0xBFFF) is read-only.
    addr >= 0xC000 || addr < 0x4000,
}
