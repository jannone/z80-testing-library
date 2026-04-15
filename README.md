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
import { readFileSync } from 'fs'
import { createMsxTestbed, SdccSymbols, ffi } from 'z80-testing-library'

const symbols = SdccSymbols.fromFiles('path/to/game.noi', 'path/to/build')
const { machine: m, vdp, keyboard } = createMsxTestbed({
  rom: new Uint8Array(readFileSync('path/to/game.rom')),
})

// Define a function binding — signature declared once, fully typed
const myFunctionSchema = ffi.def(symbols.get('my_function'), ['u8'], 'u8')
const myFunction = myFunctionSchema(m)
expect(myFunction(42)).toBe(expectedResult)

// Or use ffi.call for one-off calls without pre-declaring the signature
const result = ffi.call(m, symbols.get('my_function'), { args: [42], ret: 'u8' })
expect(result.value).toBe(expectedResult)

// Or use the low-level API for full register control
m.regs.a = 42
m.runFrom(symbols.get('my_function'))
expect(m.regs.a).toBe(expectedResult)
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
    types.ts              Port interfaces: MemoryMap, Hardware, Symbols
    machine.ts            Z80TestMachine — platform-agnostic Z80 execution core
  calling-convention/
    types.ts              CallingConvention interface and argument types
    sdcccall0.ts          SDCC __sdcccall(0) convention implementation
    sdcccall1.ts          SDCC __sdcccall(1) convention implementation
  devices/
    tms9918.ts            TMS9918 VDP capture (MSX, ColecoVision, SG-1000)
  symbols/
    sdcc.ts               SDCC .noi/.lst symbol parsing + SdccSymbols
  adapters/
    msx/                  MSX adapter: memory map, BIOS hooks, factory
  ffi.ts                  Foreign function interface (def + call + var)
  utils.ts                Helpers: pushStackArg, signed8
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
  │  MemoryMap · Hardware              │
  └──┬──────────┬──────────────────────┘
     │          │
  ┌──▼───┐  ┌──▼───┐  ┌────────────┐
  │ MSX  │  │ Bare │  │ future ... │
  └──────┘  └──────┘  └────────────┘

  Symbols (SdccSymbols, etc.) are managed independently
  and passed to ffi.def / ffi.call for name → address resolution.
```

1. **Z80TestMachine** is the core — it runs Z80 code, manages memory and registers, and delegates hardware I/O to injected ports.
2. **Adapters** (like `createMsxTestbed()`) compose the core with platform-specific `MemoryMap` and `Hardware` implementations. Symbols are managed separately.
3. **Devices** (like `Tms9918`) are reusable peripheral emulations shared across adapters.
4. A `HALT` instruction at address `0x0000` acts as a sentinel — `runFrom()` pushes `0x0000` as the return address, so when the function executes `RET`, the CPU halts.
5. A configurable cycle limit (default 100,000 T-states) prevents infinite loops.

## API Reference

### createMsxTestbed()

Factory function that creates an MSX testing environment with VDP capture, keyboard simulation, and BIOS hooks.

```typescript
import { readFileSync } from 'fs'
import { createMsxTestbed } from 'z80-testing-library'

const { machine, vdp, keyboard } = createMsxTestbed({
  rom: new Uint8Array(readFileSync('game.rom')),
  romLoadAddress: 0x4000,        // default: 0x4000 (slot 1)
  stackPointer: 0xF380,          // default: 0xF380
  extraStubs: [0x1234],          // additional addresses to stub with RET
})
```

Returns `{ machine, vdp, keyboard }`:
- **machine** — `Z80TestMachine` instance with MSX memory map and hardware
- **vdp** — `Tms9918` instance for VDP/VRAM inspection
- **keyboard** — `Uint8Array(16)` for keyboard matrix simulation

Symbols are managed separately — see [SdccSymbols](#sdccsymbols).

### Z80TestMachine

The platform-agnostic core. Used directly for bare Z80 testing, or via an adapter for platform-specific testing.

```typescript
import { Z80TestMachine } from 'z80-testing-library'

const m = new Z80TestMachine({
  memoryMap: myMemoryMap,        // MemoryMap port (write protection, defaults)
  hardware: myHardware,          // Hardware port (I/O, hooks, stubs)
  rom: myRomData,                // ROM as Uint8Array
  romLoadAddress: 0x4000,        // where to load ROM
  regions: [[0x100, myCode]],    // additional memory regions
  stackPointer: 0xF000,          // initial stack pointer
  hooks: new Map([[0x100, (m) => { ... }]]),  // user PC-triggered hooks
  stubs: [0x0050],               // additional stub addresses
})
```

All config fields are optional — with no arguments you get a flat 64KB all-writable Z80.

#### Execution

| Method | Description |
|---|---|
| `runFrom(addr, cycleLimit?)` | Run from a raw address. Returns T-states consumed. |
| `elapsedTStates` | T-states from the last `runFrom` call. |

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
import type { MemoryMap, Hardware } from 'z80-testing-library'

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
```

### Symbols Interface

The `Symbols` interface is independent of the machine — implement it for custom symbol sources:

```typescript
import type { Symbols } from 'z80-testing-library'

const mySymbols: Symbols = {
  query: (name) => symbolTable.get(name),
  get: (name) => {
    const addr = symbolTable.get(name)
    if (addr === undefined) throw new Error(`Unknown symbol: ${name}`)
    return addr
  },
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

### SdccSymbols

Symbol resolution for programs compiled with SDCC. Parses `.noi` content for exported symbols and `.lst` content for static (non-exported) symbols. See [Appendix: How SDCC Symbol Resolution Works](#appendix-how-sdcc-symbol-resolution-works) for details on why both file types are needed.

```typescript
import { SdccSymbols } from 'z80-testing-library'

// From file paths (convenience — reads .noi, .lk, and .lst files automatically)
const symbols = SdccSymbols.fromFiles('build/game.noi', './build')

// From content strings (no I/O — useful for testing or non-filesystem sources)
const ordered = SdccSymbols.parseLk(lkContent, {
  main: mainLstContent,
  physics: physicsLstContent,
  render: renderLstContent,
})
const symbols = new SdccSymbols(noiContent, ordered)

symbols.get('game_loop')           // → 0x400B (exported function, throws if missing)
symbols.query('game_loop')         // → 0x400B (returns undefined if missing)
symbols.query('clamp_position')    // → 0x4018 (static function, from .lst)
symbols.has('game_loop')           // → true
```

### ffi.def()

Declarative function binding. Define the signature once, bind to a machine, and get a fully typed callable. This is the recommended way to test compiled functions.

```typescript
import { ffi, SdccSymbols } from 'z80-testing-library'

const symbols = SdccSymbols.fromFiles('build/game.noi', './build')

// Define schemas — reusable, no machine dependency
const paddleHeightSchema = ffi.def(symbols.get('paddle_height'), ['u8'], 'u8')
const setRectSchema = ffi.def(symbols.get('set_rect'), ['u8', 'u8', 'u8', 'u8'], 'void')
const getEntitySchema = ffi.def(symbols.get('get_entity'), ['u16'], 'u16')

// Bind to a machine — typically in beforeEach or describe scope
const paddleHeight = paddleHeightSchema(m)
const setRect = setRectSchema(m)

// Call with values — TypeScript enforces correct argument count and types
expect(paddleHeight(0)).toBe(16)
expect(paddleHeight(1)).toBe(24)
setRect(5, 3, 3, 4)

// Inline binding when reuse isn't needed
const rng = ffi.def(symbols.get('next_rng'), [], 'u8')(m)
expect(rng()).toBeGreaterThan(0)
```

**Argument types:** Declared as an array of `'u8'` and `'u16'` strings. At the call site, all values are plain numbers — the signature tells the calling convention how to place each one.

**Return type:** `'void'` functions return `undefined`. `'u8'` and `'u16'` functions return `number`.

**`detailed()`:** When you need cycle counts, use `.detailed()` instead of calling directly:

```typescript
const result = paddleHeight.detailed(0)  // → { value: 16, tStates: 234 }
```

**Sharing schemas across test files:**

```typescript
// test/helpers/game-functions.ts
const symbols = SdccSymbols.fromFiles('build/game.noi', './build')
export const paddleHeightSchema = ffi.def(symbols.get('paddle_height'), ['u8'], 'u8')
export const setRectSchema = ffi.def(symbols.get('set_rect'), ['u8', 'u8', 'u8', 'u8'], 'void')

// test/paddle.test.ts
import { paddleHeightSchema } from './helpers/game-functions'
const paddleHeight = paddleHeightSchema(m)
expect(paddleHeight(0)).toBe(16)
```

#### Options

| Option | Default | Description |
|---|---|---|
| `cc` | `sdcccall1()` | Calling convention to use |
| `cycleLimit` | `100000` | Maximum T-states before aborting |

### ffi.call()

Imperative helper for one-off function calls. Useful when you don't need to pre-declare a signature.

```typescript
import { ffi } from 'z80-testing-library'

// uint8_t add_offset(uint8_t val)
const result = ffi.call(m, symbols.get('add_offset'), { args: [10], ret: 'u8' })
expect(result.value).toBe(15)

// void set_rect(uint8_t col, uint8_t row, uint8_t w, uint8_t h)
ffi.call(m, symbols.get('set_rect'), { args: [5, 3, 3, 4] })

// uint16_t get_address(uint16_t *ptr)
const r = ffi.call(m, symbols.get('get_address'), {
  args: [{ type: 'u16', value: 0xC100 }],
  ret: 'u16',
})
```

**Arguments:** Bare numbers are treated as `u8`. For 16-bit values, use `{ type: 'u16', value }`.

**Result object:** `{ value, tStates }` — the return value and the number of T-states consumed.

#### Options

| Option | Default | Description |
|---|---|---|
| `args` | `[]` | Function arguments |
| `ret` | `'void'` | Return type: `'void'`, `'u8'`, `'u16'` |
| `cc` | `sdcccall1()` | Calling convention to use |
| `cycleLimit` | `100000` | Maximum T-states before aborting |

#### Custom Calling Conventions

Both `ffi.def` and `ffi.call` accept a custom calling convention via the `cc` option. Implement the `CallingConvention` interface to support a different compiler:

```typescript
import type { CallingConvention } from 'z80-testing-library'

const myConvention: CallingConvention = {
  placeArgs(m, args) {
    // Place arguments into registers and/or stack
    // e.g. Hitech-C: all args on stack, right-to-left
  },
  readReturn(m, ret) {
    // Read return value from registers
    // e.g. Hitech-C: u8 from L, u16 from HL
    return ret === 'u8' ? m.regs.l : m.regs.hl
  },
}

// With ffi.def
const myFuncSchema = ffi.def(symbols.get('my_func'), ['u8', 'u8'], 'u8', { cc: myConvention })

// With ffi.call
ffi.call(m, symbols.get('my_func'), { args: [1, 2], ret: 'u8', cc: myConvention })
```

### ffi.var()

Typed global variable binding. Declares the type once, bind to a machine, and get a typed `get`/`set` accessor. Useful for reading and writing SDCC global and static variables without manually choosing `readByte`/`readWord`.

```typescript
import { ffi, SdccSymbols } from 'z80-testing-library'

const symbols = SdccSymbols.fromFiles('build/game.noi', './build')

// Define schemas — reusable, no machine dependency
const scoreSchema    = ffi.var(symbols.get('score'), 'u8')
const highScoreSchema = ffi.var(symbols.get('high_score'), 'u16')
const velocitySchema = ffi.var(symbols.get('velocity'), 'i8')

// Bind to a machine — typically in beforeEach or describe scope
const score     = scoreSchema(m)
const highScore = highScoreSchema(m)
const velocity  = velocitySchema(m)

// Read and write
score.set(42)
expect(score.get()).toBe(42)

velocity.set(-5)
expect(velocity.get()).toBe(-5)  // signed

// Inline binding when reuse isn't needed
const lives = ffi.var(symbols.get('lives'), 'u8')(m)
lives.set(3)
```

**Supported types:**

| Type | Size | Range | Description |
|---|---|---|---|
| `'u8'` | 1 byte | 0–255 | Unsigned byte |
| `'i8'` | 1 byte | -128–127 | Signed byte (two's complement) |
| `'u16'` | 2 bytes | 0–65535 | Unsigned word, little-endian |
| `'i16'` | 2 bytes | -32768–32767 | Signed word, little-endian |

**`addr` property:** Each bound variable exposes `.addr` for cases where you need the raw address.

**Sharing schemas across test files:**

```typescript
// test/helpers/game-vars.ts
const symbols = SdccSymbols.fromFiles('build/game.noi', './build')
export const scoreSchema    = ffi.var(symbols.get('score'), 'u8')
export const highScoreSchema = ffi.var(symbols.get('high_score'), 'u16')

// test/score.test.ts
import { scoreSchema } from './helpers/game-vars'
const score = scoreSchema(m)
score.set(0)
```

### Utility Functions

```typescript
import { pushStackArg, signed8 } from 'z80-testing-library'

// Push a byte onto the stack (for manual argument placement)
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

## Calling Conventions

The library ships with two SDCC calling conventions. `ffi.def` and `ffi.call` handle the details automatically — you just need to pick the right one.

### Built-in conventions

| Convention | Import | Args | Return u8 | Return u16 |
|---|---|---|---|---|
| `sdcccall1()` | default | 1st u8 → **A**, 1st u16 → **DE**, rest → stack (R→L) | **A** | **DE** |
| `sdcccall0()` | `{ sdcccall0 }` | All → stack (R→L) | **L** | **HL** |

### `sdcccall1()` — SDCC default

The default convention for SDCC 4.x targeting Z80. Used automatically by `ffi.def` and `ffi.call` unless overridden.

```typescript
import { ffi } from 'z80-testing-library'

// No cc option needed — sdcccall1 is the default
const addOffset = ffi.def(symbols.get('add_offset'), ['u8'], 'u8')(m)
const updateEntity = ffi.def(symbols.get('update_entity'), ['u16', 'u8'], 'void')(m)
const setRect = ffi.def(symbols.get('set_rect'), ['u8', 'u8', 'u8', 'u8'], 'void')(m)

addOffset(10)
updateEntity(entityAddr, 0x01)
setRect(5, 3, 3, 4)
```

Register assignment (left-to-right): first `uint8_t` → A, first `uint16_t`/pointer → DE. Remaining arguments go to the stack in reverse order.

> **Tip:** For functions with 2+ args where the first is a pointer, check the generated assembly to confirm where SDCC places the second argument. It may be in A or on the stack.

### `sdcccall0()` — BIOS wrappers

All parameters on the stack. Used by SDCC for BIOS wrapper functions and older code using `__sdcccall(0)`.

```typescript
import { ffi, sdcccall0 } from 'z80-testing-library'

const cc = sdcccall0()
const biosRead = ffi.def(symbols.get('bios_read_sector'), ['u8', 'u16'], 'u8', { cc })(m)
expect(biosRead(0x01, 0x1800)).toBe(expectedResult)
```

### Custom conventions

To support a different compiler (Hitech-C, z88dk, etc.), implement the `CallingConvention` interface:

```typescript
import type { CallingConvention } from 'z80-testing-library'

const hitechC: CallingConvention = {
  placeArgs(m, args) {
    // Hitech-C: all args on stack, right-to-left
  },
  readReturn(m, ret) {
    // Hitech-C: u8 from L, u16 from HL
    return ret === 'u8' ? m.regs.l : m.regs.hl
  },
}

const myFunc = ffi.def(symbols.get('my_func'), ['u8', 'u8'], 'u8', { cc: hitechC })(m)
```

### Low-level register/stack management

When using `runFrom` directly, you manage calling conventions manually:

```typescript
import { pushStackArg } from 'z80-testing-library'

// sdcccall(1): uint8_t add_offset(uint8_t val)
m.regs.a = 10
m.runFrom(symbols.get('add_offset'))
const result = m.regs.a

// sdcccall(1): void set_rect(uint8_t col, uint8_t row, uint8_t w, uint8_t h)
// col in A, row/w/h on stack (push in reverse order)
m.regs.a = 5
pushStackArg(m, 4) // h (pushed first = higher on stack)
pushStackArg(m, 3) // w
pushStackArg(m, 3) // row (pushed last = lower on stack, read first)
m.runFrom(symbols.get('set_rect'))
```

## Testing Patterns

### Testing a Pure Function

```typescript
// Using ffi.def (recommended)
const dirToIndex = ffi.def(symbols.get('dir_to_index'), ['u8'], 'u8')(m)

it('converts direction to index', () => {
  expect(dirToIndex(0x04)).toBe(0) // DIR_DOWN
})

// Using the low-level API
it('converts direction to index', () => {
  m.regs.a = 0x04 // DIR_DOWN
  m.runFrom(symbols.get('dir_to_index'))
  expect(m.regs.a).toBe(0)
})
```

### Testing a Function That Reads/Writes Globals

```typescript
const nextRng = ffi.def(symbols.get('next_rng'), [], 'u8')(m)
const rng     = ffi.var(symbols.get('rng'), 'u8')(m)

it('advances the RNG state', () => {
  rng.set(42)
  const expected = (42 * 109 + 31) & 0xFF
  expect(nextRng()).toBe(expected)
  expect(rng.get()).toBe(expected)
})
```

### Testing with Struct Pointers

Define read/write helpers for your game's struct layouts:

```typescript
const OBJ_SIZE = 15
const processKnockback = ffi.def(symbols.get('process_knockback'), ['u16'], 'void')(m)

function writeObj(m: Z80TestMachine, index: number, fields: Partial<{
  active: number, x: number, y: number, dir: number, hp: number
}>) {
  const base = symbols.get('objs') + index * OBJ_SIZE
  m.writeByte(base + 0, fields.active ?? 1)
  m.writeByte(base + 2, fields.x ?? 0x80)
  m.writeByte(base + 3, fields.y ?? 0x80)
  m.writeByte(base + 4, fields.dir ?? 0x04)
  m.writeByte(base + 11, fields.hp ?? 3)
}

it('processes knockback', () => {
  writeObj(m, 0, { active: 1, x: 0x80, y: 0x80 })
  processKnockback(symbols.get('objs'))
  expect(m.readByte(symbols.get('objs') + 2)).not.toBe(0x80) // x changed
})
```

### Testing Keyboard Input (MSX)

```typescript
// MSX keyboard row 8 contains arrow keys (active-low):
// bit 7=Right, 6=Down, 5=Up, 4=Left, 0=Space

it('reads right arrow press', () => {
  keyboard[8] = 0xFF & ~(1 << 7) // Right pressed
  m.runFrom(symbols.get('read_input'))
  expect(m.readByte(symbols.get('inputDir'))).toBe(0x01) // DIR_RIGHT
})
```

### Testing VDP/Sprite Output (MSX)

```typescript
it('updates sprite position in SAT', () => {
  writeObj(m, 0, { x: 0x80, y: 0x60 })
  m.runFrom(symbols.get('update_sprites'))

  const sprite = vdp.readSatEntry(0)
  expect(sprite.x).toBe(0x80)
  expect(sprite.y).toBe(0x60 - 1) // VDP Y is off by 1
})
```

### Testing Tile Map Operations (MSX)

```typescript
it('places wall tiles', () => {
  const addr = symbols.get('tileMap')
  for (let i = 0; i < 22 * 32; i++) m.writeByte(addr + i, 0x26)

  m.regs.a = 0  // room_id
  m.runFrom(symbols.get('build_room_tilemap'))

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

To support a new Z80 computer, implement the two port interfaces and write a factory function:

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
   m.runFrom(symbols.get('build_room_tilemap'), 500_000)
   ```

7. **No file I/O in the core.** The `Z80TestMachine` and `SdccSymbols` constructor accept raw data (`Uint8Array`, content strings), not file paths. Use `SdccSymbols.fromFiles()` or `readFileSync` for disk loading, or provide data directly for browser-compatible usage.

## Appendix: How SDCC Symbol Resolution Works

When you compile a C program with SDCC, the toolchain produces several artifact files. Understanding which ones matter — and why — helps explain how this library resolves function and variable addresses for testing.

### Exported vs. static symbols

In C, symbols (functions and variables) are **exported** by default — the linker can see them across files. Marking a symbol `static` makes it **file-local**: invisible to the linker, callable only within its own source file.

```c
void game_loop(void) { ... }           // exported — visible to linker
static void clamp_position(void) { ... } // static — file-local, invisible to linker

uint8_t score = 0;                      // exported variable
static uint8_t collision_count = 0;     // static variable
```

Normally you'd only test exported functions — they define the public interface of each module. But on a retro platform with tight ROM constraints, functions tend to be large and deeply intertwined. Testing through exported entry points alone may require complex setup or provide limited observability. Being able to call static helpers directly gives you a more practical way to isolate behavior:

```typescript
m.runFrom(symbols.get('clamp_position'))  // call a static function directly
m.readByte(symbols.get('collision_count'))  // read a static variable
```

### SDCC build artifacts

```
source.c  →  sdcc -c  →  source.rel, source.lst, ...
                              ↓
              sdcc -o  →  game.ihx, game.noi, game.lk, game.map
                              ↓
           sdobjcopy   →  game.rom
```

| File | Produced by | Contains |
|---|---|---|
| `.noi` | Linker | Exported symbol addresses (absolute, final) and segment bases |
| `.lst` | Compiler | All labels (exported and static) with local offsets per area |
| `.lk` | Linker | Link order of `.rel` files |
| `.map` | Linker | Human-readable summary (exported symbols, area layout, link order) |
| `.rom` | objcopy | The binary ROM image loaded into the emulator |

### Why we need each file

**`.noi`** provides the ground truth for exported symbols — their final absolute addresses after linking. This is the primary symbol source.

**`.lst`** files are needed for static symbols. Each `.lst` file contains labels with local offsets within their `.area` section. By finding an exported label that appears in both the `.lst` and `.noi`, the library computes the area's base address and resolves static labels relative to it.

**`.lk`** provides the link order of source files. This matters because the linker concatenates each file's contribution to shared areas (like `_DATA` or `_INITIALIZED`) in this order. When a static symbol has no exported anchor in its area, the library uses the cumulative sizes of prior files to compute the correct base address.

### How resolution works

1. **Exported symbols**: looked up directly from `.noi` content (name → absolute address).

2. **Static symbols with an exported anchor**: if the same `.lst` file has an exported label in the same area, the library computes `base = noi_address - local_offset` and resolves the static label relative to that base.

3. **Static symbols without an anchor**: the library accumulates per-file area sizes (from `.ds` directives in `.lst` files) across all files in link order, then computes `base = segment_start + cumulative_offset_of_prior_files`.

### Using `fromFiles` vs. the constructor

`SdccSymbols.fromFiles(noiPath, lstDir)` handles everything automatically — reads the `.noi`, parses the `.lk` for link order, and loads `.lst` files in the correct sequence.

For manual control (or non-filesystem sources), use `parseLk` to establish the correct order, then pass content strings to the constructor:

```typescript
const ordered = SdccSymbols.parseLk(lkContent, {
  main: mainLstContent,
  physics: physicsLstContent,
})
const provider = new SdccSymbols(noiContent, ordered)
```

The `OrderedLstContents` branded type returned by `parseLk` ensures the constructor receives correctly ordered content — passing a plain `string[]` is a type error.

## License

MIT
