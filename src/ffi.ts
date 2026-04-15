import type { MachineInterface } from './core/types.js'
import type { CallingConvention, ArgValue, ArgType, RetType } from './calling-convention/types.js'
import { sdcccall1 } from './calling-convention/sdcccall1.js'
import { signed8 } from './utils.js'

export interface CallOptions {
  /** Arguments to pass (bare numbers are u8, use { type: 'u16', value } for 16-bit) */
  args?: ArgValue[]

  /** Return type — determines which register to read (default: 'void') */
  ret?: RetType

  /** Calling convention (default: sdcccall1) */
  cc?: CallingConvention

  /** Maximum T-states before aborting */
  cycleLimit?: number
}

export interface CallResult {
  /** Return value (0 for void) */
  value: number

  /** Number of T-states consumed */
  tStates: number
}

const defaultCC = sdcccall1()

/**
 * Call a foreign function by address.
 *
 * Arguments are placed according to the calling convention (default: SDCC __sdcccall(1)),
 * the function is executed, and the return value is extracted from the appropriate register.
 */
function call(m: MachineInterface, addr: number, opts: CallOptions = {}): CallResult {
  const { args = [], ret = 'void', cc = defaultCC, cycleLimit } = opts

  cc.placeArgs(m, args)
  const tStates = m.runFrom(addr, cycleLimit)
  const value = cc.readReturn(m, ret)

  return { value, tStates }
}

// ---- def: declarative function binding with curried machine ----

/** Maps ArgType strings to TypeScript types */
type ArgTypeTs = { u8: number; u16: number }

/** Maps a tuple of ArgType strings to a tuple of TS value types */
type MapArgs<T extends readonly ArgType[]> = {
  -readonly [K in keyof T]: T[K] extends ArgType ? ArgTypeTs[T[K]] : never
}

/** Maps a RetType string to the corresponding TS return type */
type MapRet<R extends RetType> = R extends 'void' ? void : number

/** A bound function — callable with argument values */
export interface BoundFunction<A extends readonly ArgType[], R extends RetType> {
  (...args: MapArgs<A>): MapRet<R>
  /** Call and return full result with tStates */
  detailed(...args: MapArgs<A>): CallResult
}

/** An unbound function schema — call with a machine to bind */
export interface FnSchema<A extends readonly ArgType[], R extends RetType> {
  (m: MachineInterface): BoundFunction<A, R>
}

export interface DefOptions {
  /** Calling convention (default: sdcccall1) */
  cc?: CallingConvention

  /** Maximum T-states before aborting */
  cycleLimit?: number
}

/**
 * Define a foreign function binding. Declares the signature once, then bind to a machine
 * to get a typed callable.
 *
 * @example
 * const paddleHeightSchema = ffi.def(symbols.get('paddle_height'), ['u8'], 'u8')
 * const paddleHeight = paddleHeightSchema(m)
 * expect(paddleHeight(0)).toBe(16)
 *
 * @example
 * // Inline binding
 * const paddleHeight = ffi.def(symbols.get('paddle_height'), ['u8'], 'u8')(m)
 * expect(paddleHeight(0)).toBe(16)
 */
function def<const A extends readonly ArgType[], R extends RetType>(
  addr: number,
  args: A,
  ret: R,
  opts: DefOptions = {},
): FnSchema<A, R> {
  const { cc = defaultCC, cycleLimit } = opts

  return ((m: MachineInterface): BoundFunction<A, R> => {
    function exec(values: number[]): CallResult {
      const argValues: ArgValue[] = values.map((v, i) => {
        const type = args[i]
        return type === 'u16' ? { type: 'u16' as const, value: v } : v
      })
      return call(m, addr, { args: argValues, ret, cc, cycleLimit })
    }

    const fn = (...values: MapArgs<A>): MapRet<R> => {
      const result = exec(values as number[])
      return (ret === 'void' ? undefined : result.value) as MapRet<R>
    }

    fn.detailed = (...values: MapArgs<A>): CallResult => {
      return exec(values as number[])
    }

    return fn as BoundFunction<A, R>
  }) as FnSchema<A, R>
}

// ---- var: typed global variable binding ----

/** Variable type discriminator */
export type VarType = 'u8' | 'i8' | 'u16' | 'i16'

/** Maps VarType to the TypeScript type returned by get() */
type MapVarType<T extends VarType> = number

/** A bound variable — read/write a typed value at a fixed address */
export interface BoundVariable<T extends VarType> {
  /** Read the current value */
  get(): MapVarType<T>
  /** Write a new value */
  set(value: MapVarType<T>): void
  /** The memory address of this variable */
  readonly addr: number
}

/** An unbound variable schema — call with a machine to bind */
export interface VarSchema<T extends VarType> {
  (m: MachineInterface): BoundVariable<T>
}

const varReaders: Record<VarType, (m: MachineInterface, addr: number) => number> = {
  u8: (m, addr) => m.readByte(addr),
  i8: (m, addr) => signed8(m.readByte(addr)),
  u16: (m, addr) => m.readWord(addr),
  i16: (m, addr) => { const v = m.readWord(addr); return v > 32767 ? v - 65536 : v },
}

const varWriters: Record<VarType, (m: MachineInterface, addr: number, val: number) => void> = {
  u8: (m, addr, val) => m.writeByte(addr, val),
  i8: (m, addr, val) => m.writeByte(addr, val & 0xFF),
  u16: (m, addr, val) => m.writeWord(addr, val),
  i16: (m, addr, val) => m.writeWord(addr, val & 0xFFFF),
}

/**
 * Define a typed global variable binding. Declares the type once, then bind to a machine
 * to get a typed accessor.
 *
 * @example
 * const score = ffi.var(symbols.get('score'), 'u8')(m)
 * score.set(42)
 * expect(score.get()).toBe(42)
 *
 * @example
 * const velocity = ffi.var(symbols.get('velocity'), 'i8')(m)
 * velocity.set(-5)
 * expect(velocity.get()).toBe(-5)
 */
function varDef<T extends VarType>(addr: number, type: T): VarSchema<T> {
  const read = varReaders[type]
  const write = varWriters[type]

  return (m: MachineInterface): BoundVariable<T> => ({
    get: () => read(m, addr),
    set: (value: number) => write(m, addr, value),
    addr,
  })
}

export const ffi = { def, call, var: varDef } as const
