// Core
export {
  Z80TestMachine,
  type Z80TestMachineConfig,
} from './core/machine.js'

export {
  type MemoryMap,
  type Hardware,
  type Symbols,
  type PcHook,
  type PortReadHandler,
  type PortWriteHandler,
  type MemoryRegion,
  type MachineInterface,
} from './core/types.js'

// Devices
export {
  Tms9918,
  TMS9918_LAYOUT,
  type VdpRegisterWrite,
  type VramWrite,
  type SatEntry,
} from './devices/tms9918.js'

// Symbols
export {
  SdccSymbols,
  type OrderedLstContents,
} from './symbols/sdcc.js'

// Adapters — MSX
export {
  createMsxTestbed,
  MSX_BIOS,
  msxMemoryMap,
  type MsxTestbedConfig,
  type MsxTestbed,
} from './adapters/msx/index.js'

// FFI — foreign function interface
export {
  ffi,
  type CallOptions,
  type CallResult,
  type DefOptions,
  type FnSchema,
  type BoundFunction,
  type VarType,
  type VarSchema,
  type BoundVariable,
} from './ffi.js'

export {
  sdcccall0,
  sdcccall1,
  resolveArg,
  type CallingConvention,
  type ArgValue,
  type ArgType,
  type RetType,
} from './calling-convention/index.js'

// Utilities
export {
  pushStackArg,
  signed8,
} from './utils.js'
