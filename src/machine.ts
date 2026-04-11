import { Z80, type Hal } from 'z80-emulator'
import { readFileSync } from 'fs'
import { parseNoi, type SymbolMap } from './symbols.js'

const SENTINEL_ADDR = 0x0000
const HALT_OPCODE = 0x76
const RET_OPCODE = 0xC9
const DEFAULT_CYCLE_LIMIT = 100_000

/** Port read handler: (port) => value */
export type PortReadHandler = (port: number) => number

/** Port write handler: (port, value) => void */
export type PortWriteHandler = (port: number, value: number) => void

/**
 * Hook called when PC reaches a specific address, before the instruction
 * at that address executes. Receives the machine instance for register/memory access.
 */
export type PcHook = (machine: Z80Machine) => void

/** A region to load into memory: [startAddress, data] */
export type MemoryRegion = [number, Uint8Array]

export interface MachineConfig {
  /** Binary images to load into memory: [address, data] pairs */
  regions?: MemoryRegion[]

  /** Path to a ROM file to load */
  romPath?: string

  /** Address at which to load the ROM file (default: 0x0000) */
  romLoadAddress?: number

  /** Path to an SDCC .noi symbol file */
  symbolsPath?: string

  /** Initial stack pointer value (default: 0xF380) */
  stackPointer?: number

  /** Addresses to fill with RET (0xC9) for stubbing calls */
  stubs?: number[]

  /**
   * Memory write filter: returns true if the address is writable.
   * If not provided, all addresses are writable.
   */
  isWritable?: (addr: number) => boolean

  /** Custom I/O port read handler */
  onPortRead?: PortReadHandler

  /** Custom I/O port write handler */
  onPortWrite?: PortWriteHandler

  /**
   * PC-triggered hooks. Each entry maps an address to a callback
   * that fires when PC reaches that address (before instruction execution).
   */
  hooks?: Map<number, PcHook>
}

export class Z80Machine {
  private memory: Uint8Array
  private cpu: Z80
  private symbols: SymbolMap | null
  private config: MachineConfig
  private tStates = 0

  constructor(config: MachineConfig = {}) {
    this.config = config
    this.memory = new Uint8Array(65536)
    this.symbols = config.symbolsPath ? parseNoi(config.symbolsPath) : null

    // Load ROM file if specified
    if (config.romPath) {
      const rom = readFileSync(config.romPath)
      const addr = config.romLoadAddress ?? 0x0000
      this.memory.set(
        new Uint8Array(rom.buffer, rom.byteOffset, rom.byteLength),
        addr,
      )
    }

    // Load arbitrary memory regions
    if (config.regions) {
      for (const [addr, data] of config.regions) {
        this.memory.set(data, addr)
      }
    }

    // Place RET at stub addresses
    if (config.stubs) {
      for (const addr of config.stubs) {
        this.memory[addr] = RET_OPCODE
      }
    }

    // Place HALT at sentinel address for return detection
    this.memory[SENTINEL_ADDR] = HALT_OPCODE

    const isWritable = config.isWritable
    const hal: Hal = {
      tStateCount: 0,
      readMemory: (addr: number) => this.memory[addr & 0xFFFF],
      writeMemory: (addr: number, val: number) => {
        const a = addr & 0xFFFF
        if (!isWritable || isWritable(a)) {
          this.memory[a] = val
        }
      },
      contendMemory: () => {},
      readPort: (addr: number) =>
        config.onPortRead ? config.onPortRead(addr & 0xFF) : 0xFF,
      writePort: (addr: number, val: number) =>
        config.onPortWrite?.(addr & 0xFF, val),
      contendPort: () => {},
    }

    this.cpu = new Z80(hal)
    this.cpu.regs.sp = config.stackPointer ?? 0xF380
  }

  // ---- Symbol access ----

  /** Look up a symbol address by clean name (no leading underscore) */
  sym(name: string): number {
    if (!this.symbols) {
      throw new Error('No symbol file loaded')
    }
    const addr = this.symbols.clean.get(name)
    if (addr === undefined) {
      throw new Error(`Unknown symbol: ${name}`)
    }
    return addr
  }

  /** Check if a symbol exists */
  hasSym(name: string): boolean {
    return this.symbols?.clean.has(name) ?? false
  }

  /** Get the raw SymbolMap (for static symbol resolution) */
  getSymbolMap(): SymbolMap | null {
    return this.symbols
  }

  // ---- Register access ----

  get regs() {
    return this.cpu.regs
  }

  // ---- Memory helpers ----

  readByte(addr: number): number {
    return this.memory[addr & 0xFFFF]
  }

  writeByte(addr: number, val: number): void {
    this.memory[addr & 0xFFFF] = val
  }

  readWord(addr: number): number {
    const a = addr & 0xFFFF
    return this.memory[a] | (this.memory[(a + 1) & 0xFFFF] << 8)
  }

  writeWord(addr: number, val: number): void {
    const a = addr & 0xFFFF
    this.memory[a] = val & 0xFF
    this.memory[(a + 1) & 0xFFFF] = (val >> 8) & 0xFF
  }

  writeBlock(addr: number, data: Uint8Array | number[]): void {
    for (let i = 0; i < data.length; i++) {
      this.memory[(addr + i) & 0xFFFF] = data[i]
    }
  }

  // ---- Execution ----

  /**
   * Run a function by symbol name.
   * Pushes sentinel return address, sets PC, runs until HALT or cycle limit.
   */
  runFunction(name: string, cycleLimit = DEFAULT_CYCLE_LIMIT): number {
    return this.runFrom(this.sym(name), cycleLimit)
  }

  /**
   * Run from a specific address.
   * Pushes sentinel return address onto stack, runs until HALT or cycle limit.
   * Returns the number of T-states consumed.
   */
  runFrom(addr: number, cycleLimit = DEFAULT_CYCLE_LIMIT): number {
    // Ensure HALT at sentinel
    this.memory[SENTINEL_ADDR] = HALT_OPCODE

    // Push sentinel return address onto stack
    this.regs.sp = (this.regs.sp - 2) & 0xFFFF
    this.writeWord(this.regs.sp, SENTINEL_ADDR)

    this.regs.pc = addr
    this.regs.halted = 0
    this.tStates = 0

    const hooks = this.config.hooks
    const startTStates = this.cpu.hal.tStateCount

    while (!this.regs.halted) {
      const elapsed = this.cpu.hal.tStateCount - startTStates
      if (elapsed >= cycleLimit) {
        throw new Error(
          `Cycle limit exceeded (${cycleLimit} T-states) at PC=0x${this.regs.pc.toString(16).padStart(4, '0')}`
        )
      }

      hooks?.get(this.regs.pc)?.(this)

      this.cpu.step()
    }

    this.tStates = this.cpu.hal.tStateCount - startTStates
    return this.tStates
  }

  /** Get the number of T-states from the last run */
  get elapsedTStates(): number {
    return this.tStates
  }
}
