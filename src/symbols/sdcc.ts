import { readFileSync, readdirSync, existsSync } from 'fs'
import { resolve, basename } from 'path'
import type { Symbols } from '../core/types.js'

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

  const areaRegex = /\s+\d+\s+\.area\s+(\w+)/
  const labelRegex = /^\s+([0-9A-Fa-f]{8})\s+\d+\s+(_\w+)(::?)\s*$/
  const dsRegex = /^\s+([0-9A-Fa-f]{8})\s+\d+\s+\.ds\s+(\d+)/

  interface LabelInfo {
    name: string
    offset: number
    exported: boolean
    area: string
  }

  // First pass: compute each file's contribution size per area
  const fileSizes: Map<string, number>[] = []

  for (const content of lstContents) {
    const sizes = new Map<string, number>()
    let currentArea = ''

    for (const line of content.split('\n')) {
      const areaMatch = line.match(areaRegex)
      if (areaMatch) {
        currentArea = areaMatch[1]
        continue
      }

      const dsMatch = line.match(dsRegex)
      if (dsMatch && currentArea) {
        const offset = parseInt(dsMatch[1], 16)
        const size = parseInt(dsMatch[2], 10)
        const end = offset + size
        sizes.set(currentArea, Math.max(sizes.get(currentArea) ?? 0, end))
      }
    }

    fileSizes.push(sizes)
  }

  // Build cumulative offsets per area (running sum of prior files' sizes)
  const allAreas = new Set(fileSizes.flatMap(s => [...s.keys()]))
  const cumulativeOffsets: Map<string, number[]> = new Map()

  for (const area of allAreas) {
    const offsets: number[] = []
    let running = 0
    for (const sizes of fileSizes) {
      offsets.push(running)
      running += sizes.get(area) ?? 0
    }
    cumulativeOffsets.set(area, offsets)
  }

  // Second pass: resolve labels
  for (let fileIndex = 0; fileIndex < lstContents.length; fileIndex++) {
    const content = lstContents[fileIndex]
    const labels: LabelInfo[] = []
    let currentArea = ''

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

    // Fallback: segment base + cumulative offset from prior files
    for (const label of labels) {
      if (areaBases.has(label.area)) continue
      const segBase = noiSymbols.raw.get(`s_${label.area}`)
      if (segBase !== undefined) {
        const cumOffset = cumulativeOffsets.get(label.area)?.[fileIndex] ?? 0
        areaBases.set(label.area, segBase + cumOffset)
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

/** Array of .lst file contents in link order. Use SdccSymbolProvider.parseLk() to create. */
export type OrderedLstContents = string[] & { readonly __brand: 'OrderedLstContents' }

/**
 * Symbols implementation for SDCC-compiled programs.
 * Resolves both exported (.noi) and static (.lst) symbols.
 */
export class SdccSymbols implements Symbols {
  private noiSymbols: SymbolMap
  private staticSymbols: Map<string, number> | null

  constructor(noiContent: string, lstContents?: OrderedLstContents) {
    this.noiSymbols = parseNoi(noiContent)
    this.staticSymbols = lstContents
      ? parseStaticSymbols(lstContents, this.noiSymbols)
      : null
  }

  /**
   * Parse .lk content and return .lst contents in link order.
   * Keys in lstContents are basenames (without extension) matching the .rel entries in the .lk file.
   */
  static parseLk(lkContent: string, lstContents: Record<string, string>): OrderedLstContents {
    return lkContent
      .split('\n')
      .map(line => line.trim().match(/^(\S+)\.rel\s*$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map(m => basename(m[1]))
      .filter(name => name in lstContents)
      .map(name => lstContents[name]) as OrderedLstContents
  }

  /** Create from file paths (convenience for loading from disk) */
  static fromFiles(noiPath: string, lstDir?: string): SdccSymbols {
    const noiContent = readFileSync(noiPath, 'utf-8')
    if (!lstDir) {
      return new SdccSymbols(noiContent)
    }

    const lkPath = noiPath.replace(/\.noi$/, '.lk')
    const allLst = readdirSync(lstDir).filter((f: string) => f.endsWith('.lst'))

    let ordered: OrderedLstContents
    if (existsSync(lkPath)) {
      const lkContent = readFileSync(lkPath, 'utf-8')
      const lstByName: Record<string, string> = {}
      for (const f of allLst) {
        lstByName[f.replace(/\.lst$/, '')] = readFileSync(resolve(lstDir, f), 'utf-8')
      }
      ordered = SdccSymbols.parseLk(lkContent, lstByName)
    } else {
      ordered = allLst.map(f => readFileSync(resolve(lstDir, f), 'utf-8')) as OrderedLstContents
    }

    return new SdccSymbols(noiContent, ordered)
  }

  query(name: string): number | undefined {
    return this.noiSymbols.clean.get(name)
      ?? this.staticSymbols?.get(name)
  }

  get(name: string): number {
    const addr = this.query(name)
    if (addr === undefined) {
      throw new Error(`Unknown symbol: ${name}`)
    }
    return addr
  }

  has(name: string): boolean {
    return this.noiSymbols.clean.has(name)
      || (this.staticSymbols?.has(name) ?? false)
  }
}
