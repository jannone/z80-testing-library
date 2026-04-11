export interface VdpRegisterWrite {
  register: number
  value: number
}

export interface VramWrite {
  value: number
}

/** Standard TMS9918 VRAM layout for Graphics II (Screen 2) */
export const TMS9918_LAYOUT = {
  PNT:  0x1800,  // Pattern Name Table (768 bytes)
  PGT:  0x0000,  // Pattern Generator Table (6144 bytes)
  CT:   0x2000,  // Color Table (6144 bytes)
  SAT:  0x1B00,  // Sprite Attribute Table (128 bytes)
  SPT:  0x3800,  // Sprite Pattern Table (2048 bytes)
} as const

/** SAT entry layout: Y, X, pattern, color — 4 bytes each, 32 entries */
export interface SatEntry {
  y: number
  x: number
  pattern: number
  color: number
}

/**
 * Captures writes to TMS9918 VDP ports and maintains a 16KB VRAM buffer.
 *
 * VDP register write protocol (control port):
 *   1st write: data byte (value)
 *   2nd write: register number | 0x80
 */
export class Tms9918 {
  private regWrites: VdpRegisterWrite[] = []
  private vramWrites: VramWrite[] = []
  private pendingByte: number | null = null

  /** 16KB VRAM buffer — populated by BIOS hooks and port writes */
  public vram = new Uint8Array(16384)

  /** Handle a write to the VDP control port */
  writeControl(value: number): void {
    if (this.pendingByte === null) {
      this.pendingByte = value
    } else {
      if (value & 0x80) {
        this.regWrites.push({
          register: value & 0x3F,
          value: this.pendingByte,
        })
      }
      // If bit 7 is 0, it's a VRAM address setup — we just discard
      this.pendingByte = null
    }
  }

  /** Handle a write to the VDP data port */
  writeData(value: number): void {
    this.vramWrites.push({ value })
    // Data write resets the control port flip-flop
    this.pendingByte = null
  }

  /** Handle a read from the VDP data port */
  readData(): number {
    // Reading also resets the flip-flop
    this.pendingByte = null
    return 0
  }

  /** Handle a read from the VDP status port */
  readStatus(): number {
    this.pendingByte = null
    return 0
  }

  /** Write a byte to the VRAM buffer (called by BIOS hooks) */
  writeVram(addr: number, value: number): void {
    this.vram[addr & 0x3FFF] = value & 0xFF
  }

  /** Read a byte from the VRAM buffer */
  readVram(addr: number): number {
    return this.vram[addr & 0x3FFF]
  }

  /** Write a block of data to the VRAM buffer */
  writeVramBlock(addr: number, data: Uint8Array | number[], len: number): void {
    const base = addr & 0x3FFF
    for (let i = 0; i < len; i++) {
      this.vram[(base + i) & 0x3FFF] = data[i]
    }
  }

  /** Fill a VRAM region with a byte value */
  fillVram(addr: number, value: number, len: number): void {
    const base = addr & 0x3FFF
    const v = value & 0xFF
    for (let i = 0; i < len; i++) {
      this.vram[(base + i) & 0x3FFF] = v
    }
  }

  /** Read a SAT entry (4 bytes: Y, X, pattern, color) */
  readSatEntry(index: number): SatEntry {
    const base = TMS9918_LAYOUT.SAT + index * 4
    return {
      y:       this.vram[base],
      x:       this.vram[base + 1],
      pattern: this.vram[base + 2],
      color:   this.vram[base + 3],
    }
  }

  /** Read a tile index from the Pattern Name Table */
  readPntTile(col: number, row: number): number {
    return this.vram[TMS9918_LAYOUT.PNT + row * 32 + col]
  }

  getRegisterWrites(): VdpRegisterWrite[] {
    return [...this.regWrites]
  }

  getVramWrites(): VramWrite[] {
    return [...this.vramWrites]
  }

  clear(): void {
    this.regWrites = []
    this.vramWrites = []
    this.pendingByte = null
  }

  /** Clear VRAM buffer and all recorded writes */
  clearAll(): void {
    this.clear()
    this.vram.fill(0)
  }
}
