import { readFileSync } from 'fs'

export interface SymbolMap {
  /** All raw symbols from the .noi file (with leading underscore) */
  raw: Map<string, number>
  /** Clean symbols (leading underscore stripped) for convenient access */
  clean: Map<string, number>
}

/**
 * Parse an SDCC .noi file into symbol maps.
 * Format: `DEF _symbolName 0xABCD` (one per line)
 */
export function parseNoi(path: string): SymbolMap {
  const content = readFileSync(path, 'utf-8')
  const raw = new Map<string, number>()
  const clean = new Map<string, number>()

  for (const line of content.split('\n')) {
    const match = line.match(/^DEF\s+(\S+)\s+(0x[0-9a-fA-F]+)$/)
    if (!match) continue
    const [, name, addrStr] = match
    const addr = parseInt(addrStr, 16)
    raw.set(name, addr)
    // Strip leading underscore for cleaner API
    const cleanName = name.startsWith('_') ? name.slice(1) : name
    clean.set(cleanName, addr)
  }

  return { raw, clean }
}
