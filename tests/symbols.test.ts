import { describe, it, expect } from 'vitest'
import { parseNoi } from '../src/symbols.js'
import { writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { tmpdir } from 'os'

const TMP_DIR = resolve(tmpdir(), 'msx-test-lib-test')

function writeTmpFile(name: string, content: string): string {
  mkdirSync(TMP_DIR, { recursive: true })
  const path = resolve(TMP_DIR, name)
  writeFileSync(path, content, 'utf-8')
  return path
}

describe('parseNoi', () => {
  it('parses DEF lines into symbol maps', () => {
    const path = writeTmpFile('test.noi', [
      'DEF _my_func 0x4030',
      'DEF _my_var 0xC000',
    ].join('\n'))

    const symbols = parseNoi(path)

    expect(symbols.raw.get('_my_func')).toBe(0x4030)
    expect(symbols.raw.get('_my_var')).toBe(0xC000)
    expect(symbols.clean.get('my_func')).toBe(0x4030)
    expect(symbols.clean.get('my_var')).toBe(0xC000)

    unlinkSync(path)
  })

  it('strips leading underscore for clean names', () => {
    const path = writeTmpFile('test2.noi', 'DEF _hello_world 0x5000\n')
    const symbols = parseNoi(path)

    expect(symbols.raw.has('_hello_world')).toBe(true)
    expect(symbols.clean.has('hello_world')).toBe(true)
    expect(symbols.clean.get('hello_world')).toBe(0x5000)

    unlinkSync(path)
  })

  it('preserves names without leading underscore', () => {
    const path = writeTmpFile('test3.noi', 'DEF noprefix 0x6000\n')
    const symbols = parseNoi(path)

    expect(symbols.raw.get('noprefix')).toBe(0x6000)
    expect(symbols.clean.get('noprefix')).toBe(0x6000)

    unlinkSync(path)
  })

  it('skips non-DEF lines', () => {
    const path = writeTmpFile('test4.noi', [
      '# comment',
      '',
      'SOMETHING ELSE',
      'DEF _valid 0x1234',
      'INVALID LINE',
    ].join('\n'))

    const symbols = parseNoi(path)
    expect(symbols.clean.size).toBe(1)
    expect(symbols.clean.get('valid')).toBe(0x1234)

    unlinkSync(path)
  })

  it('handles uppercase hex addresses', () => {
    const path = writeTmpFile('test5.noi', 'DEF _upper 0xABCD\n')
    const symbols = parseNoi(path)
    expect(symbols.clean.get('upper')).toBe(0xABCD)

    unlinkSync(path)
  })
})
