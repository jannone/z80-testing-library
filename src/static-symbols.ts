import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { type SymbolMap } from './symbols.js'

/**
 * Parse SDCC .lst files to resolve static (non-exported) function addresses.
 *
 * Strategy:
 * 1. For each .lst file, collect all labels grouped by their .area section.
 * 2. For each area, find an exported label that exists in the .noi symbols.
 * 3. Compute area base = noi_absolute_addr - lst_local_offset.
 * 4. Resolve static labels in the same area using that base.
 *
 * This is critical because _DATA and _CODE areas have independent offset
 * spaces (both start at 0), so a single module base doesn't work.
 */
export function parseStaticSymbols(
  lstDir: string,
  noiSymbols: SymbolMap,
): Map<string, number> {
  const result = new Map<string, number>()

  // Find all .lst files in the directory
  const { readdirSync } = require('fs') as typeof import('fs')
  const lstFiles = readdirSync(lstDir)
    .filter((f: string) => f.endsWith('.lst'))
    .map((f: string) => resolve(lstDir, f))

  for (const lstPath of lstFiles) {
    const content = readFileSync(lstPath, 'utf-8')

    // Group labels by area. Each label has: name, local offset, exported flag, area name.
    interface LabelInfo {
      name: string
      offset: number
      exported: boolean
      area: string
    }

    const labels: LabelInfo[] = []
    let currentArea = ''

    // .area directive regex (matches lines like "	.area _CODE" in the source column)
    const areaRegex = /\s+\d+\s+\.area\s+(\w+)/
    // Label regex: hex offset, line number, label with : or ::
    const labelRegex = /^\s+([0-9A-Fa-f]{8})\s+\d+\s+(_\w+)(::?)\s*$/

    for (const line of content.split('\n')) {
      // Check for area change
      const areaMatch = line.match(areaRegex)
      if (areaMatch) {
        currentArea = areaMatch[1]
        continue
      }

      // Check for label
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

    // Compute base address per area using exported labels as reference points
    const areaBases = new Map<string, number>()
    for (const label of labels) {
      if (!label.exported) continue
      if (areaBases.has(label.area)) continue // already found a reference for this area
      const absAddr = noiSymbols.clean.get(label.name)
      if (absAddr !== undefined) {
        areaBases.set(label.area, absAddr - label.offset)
      }
    }

    // Add all static (non-exported) labels to the result
    for (const label of labels) {
      if (label.exported) continue
      if (result.has(label.name)) continue
      const base = areaBases.get(label.area)
      if (base === undefined) continue // no reference point for this area
      result.set(label.name, base + label.offset)
    }
  }

  return result
}
