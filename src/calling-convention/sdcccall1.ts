import type { MachineInterface } from '../core/types.js'
import type { CallingConvention, ArgValue, RetType } from './types.js'
import { resolveArg } from './types.js'
import { pushStackArg } from '../utils.js'

/**
 * SDCC __sdcccall(1) calling convention (default for Z80 targets).
 *
 * Register assignment (left-to-right):
 *  - First u8 argument  → A
 *  - First u16 argument → DE
 * Remaining arguments are pushed onto the stack in reverse order (right-to-left).
 *
 * Return values:
 *  - u8  → A
 *  - u16 → DE
 */
export function sdcccall1(): CallingConvention {
  return { placeArgs, readReturn }
}

function placeArgs(m: MachineInterface, args: ArgValue[]): void {
  let aUsed = false
  let deUsed = false
  const stackArgs: Array<{ type: 'u8' | 'u16'; value: number }> = []

  for (const arg of args) {
    const resolved = resolveArg(arg)

    if (resolved.type === 'u8' && !aUsed) {
      m.regs.a = resolved.value & 0xFF
      aUsed = true
    } else if (resolved.type === 'u16' && !deUsed) {
      m.regs.de = resolved.value & 0xFFFF
      deUsed = true
    } else {
      stackArgs.push(resolved)
    }
  }

  // Push stack args in reverse order (last arg at highest address)
  for (let i = stackArgs.length - 1; i >= 0; i--) {
    const sa = stackArgs[i]
    if (sa.type === 'u16') {
      // Push high byte first, then low byte (little-endian on stack)
      pushStackArg(m, (sa.value >> 8) & 0xFF)
      pushStackArg(m, sa.value & 0xFF)
    } else {
      pushStackArg(m, sa.value & 0xFF)
    }
  }
}

function readReturn(m: MachineInterface, ret: RetType): number {
  switch (ret) {
    case 'u8': return m.regs.a
    case 'u16': return m.regs.de
    case 'void': return 0
  }
}
