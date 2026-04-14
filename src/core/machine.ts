import { Z80, type Hal } from 'z80-emulator'
import type {
  MemoryMap,
  Hardware,
  PcHook,
  MemoryRegion,
  MachineInterface,
} from './types.js'

const SENTINEL_ADDR = 0x0000
const HALT_OPCODE = 0x76
const RET_OPCODE = 0xC9
const DEFAULT_CYCLE_LIMIT = 100_000

export interface Z80TestMachineConfig {
  /** Memory layout — write protection, default addresses */
  memoryMap?: MemoryMap

  /** Hardware peripherals — I/O ports, hooks, stubs */
  hardware?: Hardware

  /** ROM data to load into memory */
  rom?: Uint8Array

  /** Address at which to load ROM (overrides memoryMap.defaultRomLoadAddress, default: 0x0000) */
  romLoadAddress?: number

  /** Binary images to load into memory: [address, data] pairs */
  regions?: MemoryRegion[]

  /** Initial stack pointer (overrides memoryMap.defaultStackPointer) */
  stackPointer?: number

  /** Additional PC-triggered hooks (merged with hardware.hooks) */
  hooks?: Map<number, PcHook>

  /** Additional stub addresses (merged with hardware.stubs) */
  stubs?: number[]
}

export class Z80TestMachine implements MachineInterface {
  private memory: Uint8Array
  private cpu: Z80
  private tStates = 0
  private mergedHooks: Map<number, PcHook>

  constructor(config: Z80TestMachineConfig = {}) {
    this.memory = new Uint8Array(65536)

    const memoryMap = config.memoryMap
    const hardware = config.hardware

    // Load ROM data
    if (config.rom) {
      const addr = config.romLoadAddress ?? memoryMap?.defaultRomLoadAddress ?? 0x0000
      this.memory.set(config.rom, addr)
    }

    // Load arbitrary memory regions
    if (config.regions) {
      for (const [addr, data] of config.regions) {
        this.memory.set(data, addr)
      }
    }

    // Place RET at stub addresses (hardware + user)
    const allStubs = [
      ...(hardware?.stubs ?? []),
      ...(config.stubs ?? []),
    ]
    for (const addr of allStubs) {
      this.memory[addr] = RET_OPCODE
    }

    // Place HALT at sentinel address for return detection
    this.memory[SENTINEL_ADDR] = HALT_OPCODE

    // Merge hardware hooks with user hooks
    this.mergedHooks = new Map(hardware?.hooks)
    if (config.hooks) {
      for (const [addr, hook] of config.hooks) {
        this.mergedHooks.set(addr, hook)
      }
    }

    const isWritable = memoryMap?.isWritable
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
        hardware ? hardware.readPort(addr & 0xFF) : 0xFF,
      writePort: (addr: number, val: number) =>
        hardware?.writePort(addr & 0xFF, val),
      contendPort: () => {},
    }

    this.cpu = new Z80(hal)
    this.cpu.regs.sp = config.stackPointer
      ?? memoryMap?.defaultStackPointer
      ?? 0xF380
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

    const hooks = this.mergedHooks
    const startTStates = this.cpu.hal.tStateCount

    while (!this.regs.halted) {
      const elapsed = this.cpu.hal.tStateCount - startTStates
      if (elapsed >= cycleLimit) {
        throw new Error(
          `Cycle limit exceeded (${cycleLimit} T-states) at PC=0x${this.regs.pc.toString(16).padStart(4, '0')}`
        )
      }

      hooks.get(this.regs.pc)?.(this)

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
