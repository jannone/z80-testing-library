import { readFileSync } from 'fs'
import type { Symbols } from '../core/types.js'

/**
 * Symbol resolver for programs compiled with z88dk.
 *
 * Parses the linker map file (`.map`) that z88dk emits when `-m` is
 * passed to `zcc`. Lines of interest look like:
 *
 *   _clamp_add                      = $9363 ; addr, public, , hello_c, ...
 *
 * SDCC prefixes C identifiers with `_`; the parser strips it for
 * ergonomic lookups (`symbols.get('clamp_add')`). Lines whose metadata
 * does not include `addr` (e.g. constants from `.inc` files) are
 * skipped so name collisions between code labels and equates don't
 * poison the table.
 *
 *   const symbols = Z88dkSymbols.fromFile('hello.map')
 *   symbols.get('clamp_add')   // → 0x9363
 */
export class Z88dkSymbols implements Symbols {
  private table = new Map<string, number>()

  constructor(mapContent: string) {
    const re = /^_(\w+)\s*=\s*\$([0-9A-Fa-f]+)\s*;.*?\baddr\b/gm
    let match: RegExpExecArray | null
    while ((match = re.exec(mapContent)) !== null) {
      this.table.set(match[1], parseInt(match[2], 16))
    }
  }

  /** Convenience: read the map file from disk. */
  static fromFile(path: string): Z88dkSymbols {
    return new Z88dkSymbols(readFileSync(path, 'utf8'))
  }

  query(name: string): number | undefined {
    return this.table.get(name)
  }

  get(name: string): number {
    const addr = this.table.get(name)
    if (addr === undefined) throw new Error(`Unknown symbol: ${name}`)
    return addr
  }

  has(name: string): boolean {
    return this.table.has(name)
  }
}
