# z80-testing-library

Headless unit testing library for Z80 programs. Loads your ROM and symbols into a Z80 emulator, runs individual functions, and lets you assert on registers, memory, and peripheral state.

Built with a **ports & adapters** architecture — the core is platform-agnostic, and platform-specific behavior (MSX, ColecoVision, ZX Spectrum, etc.) is provided through pluggable adapters.

## Install

```bash
npm install z80-testing-library
```

## Quick Start (MSX)

Build your MSX project with SDCC (producing a `.rom` and `.noi` file), then write tests with any test runner (vitest, jest, mocha, etc.):

```typescript
import { createMsxTestbed, loadRom } from 'z80-testing-library'

const { machine: m, vdp, keyboard } = createMsxTestbed({
  rom: loadRom('path/to/game.rom'),
  symbolsPath: 'path/to/game.noi',
})

// Call a function by symbol name
m.regs.a = 42                          // set up argument (sdcccall convention)
m.runFunction('my_function')            // run until RET
expect(m.regs.a).toBe(expectedResult)   // check return value
```

## Quick Start (Bare Z80)

For platform-independent Z80 testing (no MSX assumptions):

```typescript
import { Z80TestMachine } from 'z80-testing-library'

const m = new Z80TestMachine({
  regions: [[0x100, myCode]],   // load code at address 0x100
})
m.runFrom(0x100)
expect(m.regs.a).toBe(42)
```

## Architecture

```
src/
  core/
    types.ts              Port interfaces: MemoryMap, Hardware, SymbolProvider
    machine.ts            Z80TestMachine — platform-agnostic Z80 execution core
  devices/
    tms9918.ts            TMS9918 VDP capture (MSX, ColecoVision, SG-1000)
  symbols/
    sdcc.ts               SDCC .noi/.lst symbol parsing + SdccSymbolProvider
  adapters/
    msx/                  MSX adapter: memory map, BIOS hooks, factory
  utils.ts                Helpers: pushStackArg, signed8, loadRom
```

### How It Works

```
User Tests (driving adapter)
        │
  ┌─────▼──────────────────────────────┐
  │     Z80TestMachine  (core)         │
  │  execution · memory · registers    │
  ├────────────────────────────────────┤
  │     Secondary Ports (interfaces)   │
  │  MemoryMap · Hardware · Symbols    │
  └──┬──────────┬──────────┬───────────┘
     │          │          │
  ┌──▼───┐  ┌──▼───┐  ┌───▼────────┐
  │ MSX  │  │ Bare │  │ future ... │
  └──────┘  └──────┘  └────────────┘
```

1. **Z80TestMachine** is the core — it runs Z80 code, manages memory and registers, and delegates hardware I/O to injected ports.
2. **Adapters** (like `createMsxTestbed()`) compose the core with platform-specific `MemoryMap`, `Hardware`, and `SymbolProvider` implementations.
3. **Devices** (like `Tms9918`) are reusable peripheral emulations shared across adapters.
4. A `HALT` instruction at address `0x0000` acts as a sentinel — `runFunction()` pushes `0x0000` as the return address, so when the function executes `RET`, the CPU halts.
5. A configurable cycle limit (default 100,000 T-states) prevents infinite loops.

## API Reference

### createMsxTestbed()

Factory function that creates an MSX testing environment with VDP capture, keyboard simulation, and BIOS hooks.

```typescript
import { createMsxTestbed, loadRom } from 'z80-testing-library'

const { machine, vdp, keyboard } = createMsxTestbed({
  rom: loadRom('game.rom'),      // ROM data as Uint8Array
  symbolsPath: 'game.noi',      // SDCC .noi symbol file
  romLoadAddress: 0x4000,        // default: 0x4000 (slot 1)
  stackPointer: 0xF380,          // default: 0xF380
  extraStubs: [0x1234],          // additional addresses to stub with RET
  lstDir: './build',             // directory with .lst files (for static symbols)
})
```

Returns `{ machine, vdp, keyboard }`:
- **machine** — `Z80TestMachine` instance with MSX memory map and hardware
- **vdp** — `Tms9918` instance for VDP/VRAM inspection
- **keyboard** — `Uint8Array(16)` for keyboard matrix simulation

### Z80TestMachine

The platform-agnostic core. Used directly for bare Z80 testing, or via an adapter for platform-specific testing.

```typescript
import { Z80TestMachine } from 'z80-testing-library'

const m = new Z80TestMachine({
  memoryMap: myMemoryMap,        // MemoryMap port (write protection, defaults)
  hardware: myHardware,          // Hardware port (I/O, hooks, stubs)
  symbols: mySymbolProvider,     // SymbolProvider port (name → address)
  rom: myRomData,                // ROM as Uint8Array
  romLoadAddress: 0x4000,        // where to load ROM
  regions: [[0x100, myCode]],    // additional memory regions
  stackPointer: 0xF000,          // initial stack pointer
  hooks: new Map([[0x100, (m) => { ... }]]),  // user PC-triggered hooks
  stubs: [0x0050],               // additional stub addresses
})
```

All config fields are optional — with no arguments you get a flat 64KB all-writable Z80.

#### Symbol Access

| Method | Description |
|---|---|
| `sym(name)` | Look up a symbol address by name. Throws if not found. |
| `hasSym(name)` | Check if a symbol exists. Returns boolean. |

#### Execution

| Method | Description |
|---|---|
| `runFunction(name, cycleLimit?)` | Run a function by symbol name. Returns T-states consumed. |
| `runFrom(addr, cycleLimit?)` | Run from a raw address. Returns T-states consumed. |
| `elapsedTStates` | T-states from the last `runFunction`/`runFrom` call. |

#### Registers

Access the Z80 register set via `m.regs`:

```typescript
m.regs.a    // 8-bit registers: a, b, c, d, e, h, l, f
m.regs.bc   // 16-bit pairs: af, bc, de, hl
m.regs.sp   // stack pointer
m.regs.pc   // program counter
m.regs.ix   // index registers: ix, iy
```

#### Memory

| Method | Description |
|---|---|
| `readByte(addr)` | Read a byte from memory. |
| `writeByte(addr, val)` | Write a byte to memory. |
| `readWord(addr)` | Read a little-endian 16-bit word. |
| `writeWord(addr, val)` | Write a little-endian 16-bit word. |
| `writeBlock(addr, data)` | Write a `Uint8Array` or `number[]` to memory. |

### Port Interfaces

Implement these to add support for a new Z80 platform:

```typescript
import type { MemoryMap, Hardware, SymbolProvider } from 'z80-testing-library'

// Memory layout — defines address space characteristics
const myMemoryMap: MemoryMap = {
  defaultRomLoadAddress: 0x4000,
  defaultStackPointer: 0xF380,
  isWritable: (addr) => addr >= 0xC000,
}

// Hardware — I/O ports and OS/BIOS interception
const myHardware: Hardware = {
  readPort: (port) => 0xFF,
  writePort: (port, value) => {},
  hooks: new Map(),    // PC-triggered hooks for BIOS/OS calls
  stubs: [0x0041],     // addresses to patch with RET
}

// Symbols — name-to-address resolution
const mySymbols: SymbolProvider = {
  resolve: (name) => symbolTable.get(name),
  has: (name) => symbolTable.has(name),
}
```

### Tms9918 (VDP)

TMS9918 video display processor capture. Used by MSX, ColecoVision, SG-1000, and other systems with this VDP.

```typescript
import { Tms9918, TMS9918_LAYOUT } from 'z80-testing-library'

const vdp = new Tms9918()

vdp.readVram(addr)                 // read from 16KB VRAM buffer
vdp.writeVram(addr, value)         // write to VRAM buffer
vdp.fillVram(addr, value, len)     // fill VRAM region
vdp.readSatEntry(index)            // read sprite attribute: { y, x, pattern, color }
vdp.readPntTile(col, row)          // read Pattern Name Table tile
vdp.getRegisterWrites()            // recorded VDP register writes
vdp.getVramWrites()                // recorded data port writes
vdp.clear()                        // clear recorded writes (keep VRAM)
vdp.clearAll()                     // clear everything including VRAM
```

### SdccSymbolProvider

Symbol resolution for programs compiled with SDCC. Parses `.noi` files for exported symbols and optionally `.lst` files for static (non-exported) symbols.

```typescript
import { SdccSymbolProvider } from 'z80-testing-library'

const symbols = new SdccSymbolProvider('game.noi', './build')
symbols.resolve('my_function')    // → 0x4030
symbols.resolve('static_helper')  // → 0x4120 (from .lst files)
symbols.has('my_function')        // → true
```

You can also use the lower-level parsing functions directly:

```typescript
import { parseNoi, parseStaticSymbols } from 'z80-testing-library'

const symbols = parseNoi('game.noi')
symbols.clean.get('my_function')   // → 0x4030
symbols.raw.get('_my_function')    // → 0x4030

const statics = parseStaticSymbols('./build', symbols)
statics.get('local_helper')        // → 0x4120
```

### Utility Functions

```typescript
import { pushStackArg, signed8, loadRom } from 'z80-testing-library'

// Load a ROM file as Uint8Array
const rom = loadRom('game.rom')

// Push a byte onto the stack (for SDCC multi-arg calling conventions)
pushStackArg(m, 0x42)

// Convert unsigned byte to signed int8
signed8(0xFE)  // → -2
signed8(127)   // → 127
```

### Constants

```typescript
import { MSX_BIOS, TMS9918_LAYOUT } from 'z80-testing-library'

MSX_BIOS.SNSMAT   // 0x0141
MSX_BIOS.WRTVDP   // 0x0047
// ... DISSCR, ENASCR, WRTVRM, RDVRM, FILVRM, LDIRVM, CHGCLR, INIGRP

TMS9918_LAYOUT.SAT     // 0x1B00 (Sprite Attribute Table)
TMS9918_LAYOUT.PNT     // 0x1800 (Pattern Name Table)
TMS9918_LAYOUT.PGT     // 0x0000 (Pattern Generator Table)
TMS9918_LAYOUT.CT      // 0x2000 (Color Table)
TMS9918_LAYOUT.SPT     // 0x3800 (Sprite Pattern Table)
```

## SDCC Calling Conventions

The MSX adapter is designed for ROMs compiled with SDCC. Understanding the calling conventions is essential for setting up function arguments and reading return values.

### `__sdcccall(1)` (default)

This is the default convention for SDCC 4.x targeting Z80:

| Argument | Placement |
|---|---|
| First `uint8_t` | Register **A** |
| First `uint16_t` / pointer | Register pair **DE** |
| Second `uint8_t` (if first was uint8) | Stack at SP+2 |
| Return `uint8_t` | Register **A** |
| Return `uint16_t` / pointer | Register pair **DE** |

```typescript
// uint8_t add_offset(uint8_t val)
m.regs.a = 10
m.runFunction('add_offset')
const result = m.regs.a

// void update_entity(Entity *e, uint8_t flags)
m.regs.de = entityAddr     // pointer in DE
// 2nd arg placement depends on types — check your .asm output
m.runFunction('update_entity')
```

> **Tip:** For functions with 2+ args where the first is a pointer, check the generated assembly to confirm where SDCC places the second argument. It may be in A or on the stack.

### `__sdcccall(0)` (BIOS wrappers)

All parameters on the stack. Used for BIOS wrapper functions. These are stubbed in the MSX adapter, so you rarely need to call them directly.

### Pushing Stack Arguments

For multi-argument functions where args go on the stack, push in reverse order:

```typescript
import { pushStackArg } from 'z80-testing-library'

// void set_rect(uint8_t col, uint8_t row, uint8_t w, uint8_t h)
// sdcccall(1): col in A, row in L, w and h on stack
m.regs.a = 5    // col
m.regs.l = 3    // row
pushStackArg(m, 4) // h (pushed first = higher on stack)
pushStackArg(m, 3) // w (pushed second = lower on stack, read first)
m.runFunction('set_rect')
```

## Testing Patterns

### Testing a Pure Function

```typescript
it('converts direction to index', () => {
  m.regs.a = 0x04 // DIR_DOWN
  m.runFunction('dir_to_index')
  expect(m.regs.a).toBe(0)
})
```

### Testing a Function That Reads/Writes Globals

```typescript
it('advances the RNG state', () => {
  m.writeByte(m.sym('rng'), 42)
  m.runFunction('next_rng')
  const expected = (42 * 109 + 31) & 0xFF
  expect(m.regs.a).toBe(expected)
  expect(m.readByte(m.sym('rng'))).toBe(expected)
})
```

### Testing with Struct Pointers

Define read/write helpers for your game's struct layouts:

```typescript
const OBJ_SIZE = 15

function writeObj(m: Z80TestMachine, index: number, fields: Partial<{
  active: number, x: number, y: number, dir: number, hp: number
}>) {
  const base = m.sym('objs') + index * OBJ_SIZE
  m.writeByte(base + 0, fields.active ?? 1)
  m.writeByte(base + 2, fields.x ?? 0x80)
  m.writeByte(base + 3, fields.y ?? 0x80)
  m.writeByte(base + 4, fields.dir ?? 0x04)
  m.writeByte(base + 11, fields.hp ?? 3)
}

it('processes knockback', () => {
  writeObj(m, 0, { active: 1, x: 0x80, y: 0x80 })
  m.regs.de = m.sym('objs')  // pointer arg in DE
  m.runFunction('process_knockback')
  expect(m.readByte(m.sym('objs') + 2)).not.toBe(0x80) // x changed
})
```

### Testing Keyboard Input (MSX)

```typescript
// MSX keyboard row 8 contains arrow keys (active-low):
// bit 7=Right, 6=Down, 5=Up, 4=Left, 0=Space

it('reads right arrow press', () => {
  keyboard[8] = 0xFF & ~(1 << 7) // Right pressed
  m.runFunction('read_input')
  expect(m.readByte(m.sym('inputDir'))).toBe(0x01) // DIR_RIGHT
})
```

### Testing VDP/Sprite Output (MSX)

```typescript
it('updates sprite position in SAT', () => {
  writeObj(m, 0, { x: 0x80, y: 0x60 })
  m.runFunction('update_sprites')

  const sprite = vdp.readSatEntry(0)
  expect(sprite.x).toBe(0x80)
  expect(sprite.y).toBe(0x60 - 1) // VDP Y is off by 1
})
```

### Testing Tile Map Operations (MSX)

```typescript
it('places wall tiles', () => {
  const addr = m.sym('tileMap')
  for (let i = 0; i < 22 * 32; i++) m.writeByte(addr + i, 0x26)

  m.regs.a = 0  // room_id
  m.runFunction('build_room_tilemap')

  expect(m.readByte(addr + 0 * 32 + 15)).toBe(0x90) // TILE_WALL
})
```

## MSX Memory Map

The MSX adapter enforces the standard MSX memory layout:

| Range | Contents | Writable |
|---|---|---|
| `0x0000-0x3FFF` | BIOS / system area (stubs) | Yes |
| `0x4000-0xBFFF` | ROM (your cartridge) | No |
| `0xC000-0xFFFF` | RAM (variables, stack) | Yes |

## TMS9918 VRAM Layout (Graphics II / SCREEN 2)

| Region | Address | Size | Description |
|---|---|---|---|
| PGT | `0x0000` | 6144 | Pattern Generator Table |
| PNT | `0x1800` | 768 | Pattern Name Table |
| SAT | `0x1B00` | 128 | Sprite Attribute Table (32 sprites x 4 bytes) |
| CT | `0x2000` | 6144 | Color Table |
| SPT | `0x3800` | 2048 | Sprite Pattern Table |

## Adding a New Platform

To support a new Z80 computer, implement the three port interfaces and write a factory function:

```typescript
// adapters/spectrum/index.ts
import { Z80TestMachine } from 'z80-testing-library'
import type { MemoryMap, Hardware } from 'z80-testing-library'

const spectrumMemoryMap: MemoryMap = {
  defaultRomLoadAddress: 0x8000,
  defaultStackPointer: 0xFF00,
  isWritable: (addr) => addr >= 0x4000,  // 16K ROM at 0x0000-0x3FFF
}

const spectrumHardware: Hardware = {
  readPort: (port) => { /* ULA, etc. */ return 0xFF },
  writePort: (port, value) => { /* ULA, etc. */ },
  hooks: new Map(),
  stubs: [],
}

export function createSpectrumTestbed(config) {
  return new Z80TestMachine({
    memoryMap: spectrumMemoryMap,
    hardware: spectrumHardware,
    ...config,
  })
}
```

## Tips and Gotchas

1. **RAM is uninitialized.** The machine starts with zeros in RAM. Always initialize the globals your function depends on.

2. **BIOS calls are partially emulated (MSX).** SNSMAT, WRTVRM, LDIRVM, and FILVRM have functional hooks. Other BIOS calls are stubbed with `RET` (no-op). The function's logic still executes — only the actual hardware I/O is skipped.

3. **Signed bytes.** When reading Z80 memory values that represent `int8_t`, use `signed8()`:
   ```typescript
   import { signed8 } from 'z80-testing-library'
   const offset = signed8(m.readByte(addr))  // -128..127
   ```

4. **ROM is read-only (MSX).** Writes to `0x4000-0xBFFF` are silently dropped.

5. **Stack location (MSX).** SP starts at `0xF380`. Keep object data away from the stack region (`0xF000-0xF380`) to avoid corruption in deeply nested calls.

6. **Cycle limits.** Default is 100,000 T-states. Pass a higher limit for complex functions:
   ```typescript
   m.runFunction('build_room_tilemap', 500_000)
   ```

7. **No file I/O in the core.** The `Z80TestMachine` accepts `Uint8Array` for ROM data, not file paths. Use `loadRom()` to read from disk, or provide data directly for browser-compatible usage.

## License

MIT
