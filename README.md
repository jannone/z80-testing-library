# z80-testing-library

Headless unit testing library for MSX programs compiled with SDCC. Loads your ROM and symbols into a Z80 emulator, runs individual C functions, and lets you assert on registers, memory, and VDP state.

## Install

```bash
npm install z80-testing-library
```

## Quick Start

Build your MSX project with SDCC (producing a `.rom` and `.noi` file), then write tests with any test runner (vitest, jest, mocha, etc.):

```typescript
import { MsxMachine } from 'z80-testing-library'

const m = new MsxMachine({
  romPath: 'path/to/game.rom',
  symbolsPath: 'path/to/game.noi',
})

// Call a function by symbol name
m.regs.a = 42                     // set up argument (sdcccall convention)
m.runFunction('my_function')       // run until RET
expect(m.regs.a).toBe(expectedResult)  // check return value
```

## Architecture

```
z80-testing-library/
  src/
    machine.ts        Z80Machine — generic Z80 emulator wrapper
    msx.ts            MsxMachine — extends Z80Machine with MSX memory map,
                      BIOS stubs, VDP, and keyboard simulation
    symbols.ts        Parses SDCC .noi symbol files
    static-symbols.ts Resolves static (non-exported) symbols from .lst files
    vdp-capture.ts    VDP port capture with 16KB VRAM buffer
    utils.ts          Helpers: pushStackArg, signed8
```

### How It Works

1. `MsxMachine` loads your ROM at `0x4000` (MSX cartridge slot 1) and parses the `.noi` file for symbol addresses.
2. All MSX BIOS entry points (DISSCR, WRTVDP, LDIRVM, SNSMAT, etc.) are patched with `RET` so BIOS calls return immediately. Key BIOS routines (WRTVRM, LDIRVM, FILVRM, SNSMAT) have hooks that emulate their behavior.
3. A `HALT` instruction at address `0x0000` acts as a sentinel — `runFunction()` pushes `0x0000` as the return address, so when the function executes `RET`, the CPU halts.
4. A configurable cycle limit (default 100,000 T-states) prevents infinite loops.

## API Reference

### MsxMachine

The main class for testing MSX programs. Extends `Z80Machine` with MSX-specific hardware emulation.

```typescript
import { MsxMachine } from 'z80-testing-library'

const m = new MsxMachine({
  romPath: 'game.rom',           // path to ROM file
  symbolsPath: 'game.noi',      // SDCC .noi symbol file
  romLoadAddress: 0x4000,        // default: 0x4000 (slot 1)
  stackPointer: 0xF380,          // default: 0xF380
  extraStubs: [0x1234],          // additional addresses to stub with RET
  lstDir: './build',             // directory with .lst files (for static symbols)
})
```

#### Symbol Access

| Method | Description |
|---|---|
| `sym(name)` | Look up a symbol address by name. Throws if not found. |
| `hasSym(name)` | Check if a symbol exists. Returns boolean. |
| `staticSym(name)` | Look up a static (non-exported) symbol. Requires `lstDir`. |
| `hasStaticSym(name)` | Check if a static symbol exists. |

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

#### VDP

Access the VDP capture via `m.vdp`:

```typescript
m.vdp.readVram(addr)                 // read from 16KB VRAM buffer
m.vdp.writeVram(addr, value)         // write to VRAM buffer
m.vdp.fillVram(addr, value, len)     // fill VRAM region
m.vdp.readSatEntry(index)            // read sprite attribute: { y, x, pattern, color }
m.vdp.readPntTile(col, row)          // read Pattern Name Table tile
m.vdp.getRegisterWrites()            // recorded VDP register writes
m.vdp.getVramWrites()                // recorded data port writes
m.vdp.clear()                        // clear recorded writes (keep VRAM)
m.vdp.clearAll()                     // clear everything including VRAM
```

#### Keyboard

Simulate keyboard input via the MSX keyboard matrix:

```typescript
// Rows 0-15, each byte is active-low (0 = pressed, 1 = released)
m.keyboardRows[row] = 0xFF            // all released
m.keyboardRows[row] = 0xFF & ~(1 << bit)  // press a key

// The SNSMAT BIOS hook reads from keyboardRows automatically
```

### Z80Machine

Lower-level class for generic Z80 testing (no MSX assumptions). Use this if your program isn't MSX-specific or you need full control over the hardware abstraction.

```typescript
import { Z80Machine } from 'z80-testing-library'

const m = new Z80Machine({
  regions: [[0x100, myCode]],              // load code at address 0x100
  stubs: [0x0041, 0x0047],                 // place RET at these addresses
  stackPointer: 0xF000,
  isWritable: (addr) => addr >= 0xC000,    // ROM/RAM split
  onPortRead: (port) => 0xFF,              // I/O port handlers
  onPortWrite: (port, value) => {},
  hooks: new Map([[0x100, (m) => { ... }]]),  // PC-triggered hooks
})
```

### Utility Functions

```typescript
import { pushStackArg, signed8 } from 'z80-testing-library'

// Push a byte onto the stack (for SDCC multi-arg calling conventions)
pushStackArg(m, 0x42)

// Convert unsigned byte to signed int8
signed8(0xFE)  // → -2
signed8(127)   // → 127
```

### Symbol Parsing

```typescript
import { parseNoi, parseStaticSymbols } from 'z80-testing-library'

// Parse .noi file (generated by SDCC linker)
const symbols = parseNoi('game.noi')
symbols.clean.get('my_function')   // → 0x4030
symbols.raw.get('_my_function')    // → 0x4030

// Parse static symbols from .lst files
const statics = parseStaticSymbols('./build', symbols)
statics.get('local_helper')        // → 0x4120
```

### Constants

```typescript
import { MSX_BIOS, VDP_LAYOUT } from 'z80-testing-library'

MSX_BIOS.SNSMAT   // 0x0141
MSX_BIOS.WRTVDP   // 0x0047
// ... DISSCR, ENASCR, WRTVRM, RDVRM, FILVRM, LDIRVM, CHGCLR, INIGRP

VDP_LAYOUT.SAT     // 0x1B00 (Sprite Attribute Table)
VDP_LAYOUT.PNT     // 0x1800 (Pattern Name Table)
VDP_LAYOUT.PGT     // 0x0000 (Pattern Generator Table)
VDP_LAYOUT.CT      // 0x2000 (Color Table)
VDP_LAYOUT.SPT     // 0x3800 (Sprite Pattern Table)
```

## SDCC Calling Conventions

The library is designed for ROMs compiled with SDCC. Understanding the calling conventions is essential for setting up function arguments and reading return values.

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

All parameters on the stack. Used for BIOS wrapper functions. These are stubbed in `MsxMachine`, so you rarely need to call them directly.

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

function writeObj(m: MsxMachine, index: number, fields: Partial<{
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

### Testing Keyboard Input

```typescript
// MSX keyboard row 8 contains arrow keys (active-low):
// bit 7=Right, 6=Down, 5=Up, 4=Left, 0=Space

it('reads right arrow press', () => {
  m.keyboardRows[8] = 0xFF & ~(1 << 7) // Right pressed
  m.runFunction('read_input')
  expect(m.readByte(m.sym('inputDir'))).toBe(0x01) // DIR_RIGHT
})
```

### Testing VDP/Sprite Output

```typescript
it('updates sprite position in SAT', () => {
  writeObj(m, 0, { x: 0x80, y: 0x60 })
  m.runFunction('update_sprites')

  const sprite = m.vdp.readSatEntry(0)
  expect(sprite.x).toBe(0x80)
  expect(sprite.y).toBe(0x60 - 1) // VDP Y is off by 1
})
```

### Testing Tile Map Operations

```typescript
it('places wall tiles', () => {
  // Fill tilemap with floor
  const addr = m.sym('tileMap')
  for (let i = 0; i < 22 * 32; i++) m.writeByte(addr + i, 0x26)

  m.regs.a = 0  // room_id
  m.runFunction('build_room_tilemap')

  // Check that walls were placed at expected positions
  expect(m.readByte(addr + 0 * 32 + 15)).toBe(0x90) // TILE_WALL
})
```

## MSX Memory Map

MsxMachine enforces the standard MSX memory layout:

| Range | Contents | Writable |
|---|---|---|
| `0x0000-0x3FFF` | BIOS / system area (stubs) | Yes |
| `0x4000-0xBFFF` | ROM (your cartridge) | No |
| `0xC000-0xFFFF` | RAM (variables, stack) | Yes |

## VDP Layout (SCREEN 2)

| Region | Address | Size | Description |
|---|---|---|---|
| PGT | `0x0000` | 6144 | Pattern Generator Table |
| PNT | `0x1800` | 768 | Pattern Name Table |
| SAT | `0x1B00` | 128 | Sprite Attribute Table (32 sprites x 4 bytes) |
| CT | `0x2000` | 6144 | Color Table |
| SPT | `0x3800` | 2048 | Sprite Pattern Table |

## Tips and Gotchas

1. **RAM is uninitialized.** The machine starts with zeros in RAM. Always initialize the globals your function depends on.

2. **BIOS calls are partially emulated.** SNSMAT, WRTVRM, LDIRVM, and FILVRM have functional hooks. Other BIOS calls are stubbed with `RET` (no-op). The function's logic still executes — only the actual hardware I/O is skipped.

3. **Signed bytes.** When reading Z80 memory values that represent `int8_t`, use `signed8()`:
   ```typescript
   import { signed8 } from 'z80-testing-library'
   const offset = signed8(m.readByte(addr))  // -128..127
   ```

4. **ROM is read-only.** Writes to `0x4000-0xBFFF` are silently dropped.

5. **Stack location.** SP starts at `0xF380`. Keep object data away from the stack region (`0xF000-0xF380`) to avoid corruption in deeply nested calls.

6. **Cycle limits.** Default is 100,000 T-states. Pass a higher limit for complex functions:
   ```typescript
   m.runFunction('build_room_tilemap', 500_000)
   ```

## License

MIT
