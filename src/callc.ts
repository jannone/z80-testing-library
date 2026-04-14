import type { MachineInterface } from './core/types.js'
import type { CallingConvention, ArgValue, ArgType, RetType } from './calling-convention/types.js'
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
 * Call a C function by address using a high-level interface.
 *
 * Arguments are placed according to the calling convention (default: SDCC __sdcccall(1)),
 * the function is executed, and the return value is extracted from the appropriate register.
 */
export function callC(m: MachineInterface, addr: number, opts: CallCOptions = {}): CallCResult {
  const { args = [], ret = 'void', cc = defaultCC, cycleLimit } = opts

  cc.placeArgs(m, args)
  const tStates = m.runFrom(addr, cycleLimit)
  const value = cc.readReturn(m, ret)

  return { value, tStates }
}

// ---- defC: declarative function binding with curried machine ----

/** Maps ArgType strings to TypeScript types */
type ArgTypeTs = { u8: number; u16: number }

/** Maps a tuple of ArgType strings to a tuple of TS value types */
type MapArgs<T extends readonly ArgType[]> = {
  -readonly [K in keyof T]: T[K] extends ArgType ? ArgTypeTs[T[K]] : never
}

/** Maps a RetType string to the corresponding TS return type */
type MapRet<R extends RetType> = R extends 'void' ? void : number

/** A bound C function — callable with argument values */
export interface BoundCFunction<A extends readonly ArgType[], R extends RetType> {
  (...args: MapArgs<A>): MapRet<R>
  /** Call and return full result with tStates */
  detailed(...args: MapArgs<A>): CallCResult
}

/** An unbound C function signature — call with a machine to bind */
export interface CSignature<A extends readonly ArgType[], R extends RetType> {
  (m: MachineInterface): BoundCFunction<A, R>
}

export interface DefCOptions {
  /** Calling convention (default: sdcccall1) */
  cc?: CallingConvention

  /** Maximum T-states before aborting */
  cycleLimit?: number
}

/**
 * Define a C function binding. Declares the signature once, then bind to a machine
 * to get a typed callable.
 *
 * @example
 * const paddleHeight = defC(symbols.get('paddle_height'), ['u8'], 'u8')
 * const ph = paddleHeight(m)
 * expect(ph(0)).toBe(16)
 *
 * @example
 * // Inline binding
 * const paddleHeight = defC(symbols.get('paddle_height'), ['u8'], 'u8')(m)
 * expect(paddleHeight(0)).toBe(16)
 */
export function defC<const A extends readonly ArgType[], R extends RetType>(
  addr: number,
  args: A,
  ret: R,
  opts: DefCOptions = {},
): CSignature<A, R> {
  const { cc = defaultCC, cycleLimit } = opts

  return ((m: MachineInterface): BoundCFunction<A, R> => {
    function exec(values: number[]): CallCResult {
      const argValues: ArgValue[] = values.map((v, i) => {
        const type = args[i]
        return type === 'u16' ? { type: 'u16' as const, value: v } : v
      })
      return callC(m, addr, { args: argValues, ret, cc, cycleLimit })
    }

    const fn = (...values: MapArgs<A>): MapRet<R> => {
      const result = exec(values as number[])
      return (ret === 'void' ? undefined : result.value) as MapRet<R>
    }

    fn.detailed = (...values: MapArgs<A>): CallCResult => {
      return exec(values as number[])
    }

    return fn as BoundCFunction<A, R>
  }) as CSignature<A, R>
}
