import type { MachineInterface } from '../core/types.js'
import type { CallingConvention, ArgValue, RetType } from './types.js'
import { resolveArg } from './types.js'
import { pushStackArg } from '../utils.js'

/**
 * SDCC __sdcccall(0) calling convention.
 *
 * All arguments are passed on the stack in reverse order (right-to-left).
 * No register assignment.
 *
 * Return values:
 *  - u8  → L
 *  - u16 → HL
 */
export function sdcccall0(): CallingConvention {
  return { placeArgs, readReturn }
}

function placeArgs(m: MachineInterface, args: ArgValue[]): void {
  // Push all args in reverse order (last arg at highest address)
  for (let i = args.length - 1; i >= 0; i--) {
    const { type, value } = resolveArg(args[i])
    if (type === 'u16') {
      pushStackArg(m, (value >> 8) & 0xFF)
      pushStackArg(m, value & 0xFF)
    } else {
      pushStackArg(m, value & 0xFF)
    }
  }
}

function readReturn(m: MachineInterface, ret: RetType): number {
  switch (ret) {
    case 'u8': return m.regs.l
    case 'u16': return m.regs.hl
    case 'void': return 0
  }
}
