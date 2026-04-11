import type { MachineInterface } from './core/types.js'

/**
 * Push a 1-byte value onto the Z80 stack.
 * Useful for SDCC calling conventions where arguments beyond the first
 * are passed on the stack (SP+2 after the return address pushed by CALL).
 *
 * Push arguments in reverse order (last arg first) to match C calling order.
 */
export function pushStackArg(m: MachineInterface, value: number): void {
  m.regs.sp = (m.regs.sp - 1) & 0xFFFF
  m.writeByte(m.regs.sp, value & 0xFF)
}

/**
 * Convert an unsigned byte (0-255) to a signed int8 (-128 to 127).
 * Needed when reading Z80 memory values that represent signed quantities
 * (e.g. signed offsets, velocities).
 */
export function signed8(val: number): number {
  return val > 127 ? val - 256 : val
}