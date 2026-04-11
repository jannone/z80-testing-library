import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'
import type { SymbolProvider } from '../core/types.js'

export interface SymbolMap {
  /** All raw symbols from the .noi file (with leading underscore) */
  raw: Map<string, number>
  /** Clean symbols (leading underscore stripped) for convenient access */
  clean: Map<string, number>
}

/**
 * Parse SDCC .noi content into symbol maps.
 * Format: `DEF _symbolName 0xABCD` (one per line)
 */
export function parseNoi(content: string): SymbolMap {
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

/**
 * Parse SDCC .lst file contents to resolve static (non-exported) function addresses.
 *
 * Strategy:
 * 1. For each .lst content, collect all labels grouped by their .area section.
 * 2. For each area, find an exported label that exists in the .noi symbols.
 * 3. Compute area base = noi_absolute_addr - lst_local_offset.
 * 4. For areas with no exported anchor, fall back to the segment base
 *    from the .noi file (e.g. s__DATA for .area _DATA).
 * 5. Resolve static labels in the same area using that base.
 */
export function parseStaticSymbols(
  lstContents: string[],
  noiSymbols: SymbolMap,
): Map<string, number> {
  const result = new Map<string, number>()

  for (const content of lstContents) {
    interface LabelInfo {
      name: string
      offset: number
      exported: boolean
      area: string
    }

    const labels: LabelInfo[] = []
    let currentArea = ''

    const areaRegex = /\s+\d+\s+\.area\s+(\w+)/
    const labelRegex = /^\s+([0-9A-Fa-f]{8})\s+\d+\s+(_\w+)(::?)\s*$/

    for (const line of content.split('\n')) {
      const areaMatch = line.match(areaRegex)
      if (areaMatch) {
        currentArea = areaMatch[1]
        continue
      }

      const match = line.match(labelRegex)
      if (!match) continue
      const [, offsetHex, name, colons] = match
      const offset = parseInt(offsetHex, 16)
      labels.push({
        name: name.startsWith('_') ? name.slice(1) : name,
        offset,
        exported: colons === '::',
        area: currentArea,
      })
    }

    const areaBases = new Map<string, number>()
    for (const label of labels) {
      if (!label.exported) continue
      if (areaBases.has(label.area)) continue
      const absAddr = noiSymbols.clean.get(label.name)
      if (absAddr !== undefined) {
        areaBases.set(label.area, absAddr - label.offset)
      }
    }

    // Fallback: use segment base from .noi (e.g. s__DATA for .area _DATA)
    for (const label of labels) {
      if (areaBases.has(label.area)) continue
      const segBase = noiSymbols.raw.get(`s_${label.area}`)
      if (segBase !== undefined) {
        areaBases.set(label.area, segBase)
      }
    }

    for (const label of labels) {
      if (label.exported) continue
      if (result.has(label.name)) continue
      const base = areaBases.get(label.area)
      if (base === undefined) continue
      result.set(label.name, base + label.offset)
    }
  }

  return result
}

/**
 * SymbolProvider implementation for SDCC-compiled programs.
 * Resolves both exported (.noi) and static (.lst) symbols.
 */
export class SdccSymbolProvider implements SymbolProvider {
  private noiSymbols: SymbolMap
  private staticSymbols: Map<string, number> | null

  constructor(noiContent: string, lstContents?: string[]) {
    this.noiSymbols = parseNoi(noiContent)
    this.staticSymbols = lstContents
      ? parseStaticSymbols(lstContents, this.noiSymbols)
      : null
  }

  /** Create from file paths (convenience for loading from disk) */
  static fromFiles(noiPath: string, lstDir?: string): SdccSymbolProvider {
    const noiContent = readFileSync(noiPath, 'utf-8')
    const lstContents = lstDir
      ? readdirSync(lstDir)
          .filter((f: string) => f.endsWith('.lst'))
          .map((f: string) => readFileSync(resolve(lstDir, f), 'utf-8'))
      : undefined
    return new SdccSymbolProvider(noiContent, lstContents)
  }

  resolve(name: string): number | undefined {
    return this.noiSymbols.clean.get(name)
      ?? this.staticSymbols?.get(name)
  }

  has(name: string): boolean {
    return this.noiSymbols.clean.has(name)
      || (this.staticSymbols?.has(name) ?? false)
  }
}
