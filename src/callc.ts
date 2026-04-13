import type { Z80TestMachine } from './core/machine.js'
import type { CallingConvention, ArgValue, RetType } from './calling-convention/types.js'
import { sdcccall1 } from './calling-convention/sdcccall1.js'

export interface CallCOptions {
  /** Arguments to pass (bare numbers are u8, use { type: 'u16', value } for 16-bit) */
  args?: ArgValue[]

  /** Return type — determines which register to read (default: 'void') */
  ret?: RetType

  /** Calling convention (default: sdcccall1) */
  cc?: CallingConvention

  /** Maximum T-states before aborting */
  cycleLimit?: number
}

export interface CallCResult {
  /** Return value (0 for void) */
  value: number

  /** Number of T-states consumed */
  tStates: number
}

const defaultCC = sdcccall1()

/**
 * Call a C function by name using a high-level interface.
 *
 * Arguments are placed according to the calling convention (default: SDCC __sdcccall(1)),
 * the function is executed, and the return value is extracted from the appropriate register.
 */
export function callC(m: Z80TestMachine, name: string, opts: CallCOptions = {}): CallCResult {
  const { args = [], ret = 'void', cc = defaultCC, cycleLimit } = opts

  cc.placeArgs(m, args)
  const tStates = m.runFunction(name, cycleLimit)
  const value = cc.readReturn(m, ret)

  return { value, tStates }
}
