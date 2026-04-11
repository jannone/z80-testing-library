/** A region to load into memory: [startAddress, data] */
export type MemoryRegion = [number, Uint8Array]

/** Port read handler: (port) => value */
export type PortReadHandler = (port: number) => number

/** Port write handler: (port, value) => void */
export type PortWriteHandler = (port: number, value: number) => void

/**
 * Hook called when PC reaches a specific address, before the instruction
 * at that address executes. Receives the machine instance for register/memory access.
 */
export type PcHook = (machine: MachineInterface) => void

/** Minimal machine surface exposed to hooks and utilities */
export interface MachineInterface {
  readonly regs: {
    a: number; b: number; c: number; d: number; e: number; h: number; l: number
    af: number; bc: number; de: number; hl: number
    ix: number; iy: number; sp: number; pc: number
    halted: number
  }
  readByte(addr: number): number
  writeByte(addr: number, val: number): void
  readWord(addr: number): number
  writeWord(addr: number, val: number): void
  writeBlock(addr: number, data: Uint8Array | number[]): void
}

/** Memory layout port — defines address space characteristics */
export interface MemoryMap {
  readonly defaultRomLoadAddress: number
  readonly defaultStackPointer: number
  isWritable(addr: number): boolean
}

/** Hardware peripherals port — I/O ports and BIOS/OS interception */
export interface Hardware {
  readPort(port: number): number
  writePort(port: number, value: number): void
  readonly hooks: Map<number, PcHook>
  readonly stubs: number[]
}

/** Symbol resolution port — maps names to addresses */
export interface SymbolProvider {
  resolve(name: string): number | undefined
  has(name: string): boolean
}
