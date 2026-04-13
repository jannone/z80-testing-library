import type { MachineInterface } from '../core/types.js'

/** Argument type discriminator */
export type ArgType = 'u8' | 'u16'

/** Return type discriminator */
export type RetType = 'void' | 'u8' | 'u16'

/**
 * A typed argument value.
 * Bare numbers are treated as u8. Use { type: 'u16', value } for 16-bit values.
 */
export type ArgValue =
  | number
  | { type: 'u8'; value: number }
  | { type: 'u16'; value: number }

/** Calling convention port — knows how to pass args and read return values */
export interface CallingConvention {
  /** Place arguments into registers and/or stack before the call */
  placeArgs(m: MachineInterface, args: ArgValue[]): void

  /** Read the return value from registers after the call */
  readReturn(m: MachineInterface, ret: RetType): number
}

/** Resolve an ArgValue to its type and numeric value */
export function resolveArg(arg: ArgValue): { type: ArgType; value: number } {
  if (typeof arg === 'number') {
    return { type: 'u8', value: arg }
  }
  return { type: arg.type, value: arg.value }
}
