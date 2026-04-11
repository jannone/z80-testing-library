import { describe, it, expect } from 'vitest'
import { parseNoi, parseStaticSymbols, SdccSymbolProvider } from '../../src/symbols/sdcc.js'
import { writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { tmpdir } from 'os'

const TMP_DIR = resolve(tmpdir(), 'z80-test-lib-test')

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

describe('SdccSymbolProvider', () => {
  it('implements SymbolProvider interface', () => {
    const path = writeTmpFile('provider.noi', [
      'DEF _my_func 0x4030',
      'DEF _my_var 0xC000',
    ].join('\n'))

    const provider = new SdccSymbolProvider(path)

    expect(provider.has('my_func')).toBe(true)
    expect(provider.has('my_var')).toBe(true)
    expect(provider.has('nonexistent')).toBe(false)

    expect(provider.resolve('my_func')).toBe(0x4030)
    expect(provider.resolve('my_var')).toBe(0xC000)
    expect(provider.resolve('nonexistent')).toBeUndefined()

    unlinkSync(path)
  })

  it('resolves static symbols when lstDir is provided', () => {
    // Create a .noi file with one exported symbol
    const noiPath = writeTmpFile('static.noi', 'DEF _exported_func 0x4100\n')

    // Create a .lst file with both exported and static labels in a _CODE area
    const lstContent = [
      '                              1\t.area _CODE',
      '   00000000  1\t_exported_func::',
      '   00000010  2\t_static_helper:',
    ].join('\n')
    writeTmpFile('static.lst', lstContent)

    const provider = new SdccSymbolProvider(noiPath, TMP_DIR)

    // exported_func is at offset 0 in _CODE, absolute 0x4100
    // static_helper is at offset 0x10, so absolute 0x4100 + 0x10 = 0x4110
    expect(provider.has('static_helper')).toBe(true)
    expect(provider.resolve('static_helper')).toBe(0x4110)

    unlinkSync(noiPath)
    unlinkSync(resolve(TMP_DIR, 'static.lst'))
  })

  it('resolves static data variables using segment base from .noi', () => {
    // .noi has an exported CODE symbol and the DATA segment base, but no exported DATA labels
    const noiPath = writeTmpFile('data.noi', [
      'DEF _exported_func 0x4100',
      'DEF s__DATA 0xC000',
    ].join('\n'))

    const lstContent = [
      '                              1\t.area _CODE',
      '   00000000  1\t_exported_func::',
      '   00000010  2\t_static_helper:',
      '                              3\t.area _DATA',
      '   00000000  4\t_paddle_l_y:',
      '   00000002  5\t_paddle_r_y:',
      '   00000004  6\t_ball_x:',
    ].join('\n')
    writeTmpFile('data.lst', lstContent)

    const provider = new SdccSymbolProvider(noiPath, TMP_DIR)

    // CODE symbols still resolve via exported anchor
    expect(provider.resolve('static_helper')).toBe(0x4110)

    // DATA symbols resolve via s__DATA segment base
    expect(provider.has('paddle_l_y')).toBe(true)
    expect(provider.resolve('paddle_l_y')).toBe(0xC000)
    expect(provider.resolve('paddle_r_y')).toBe(0xC002)
    expect(provider.resolve('ball_x')).toBe(0xC004)

    unlinkSync(noiPath)
    unlinkSync(resolve(TMP_DIR, 'data.lst'))
  })
})
