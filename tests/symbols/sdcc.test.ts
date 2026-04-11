import { describe, it, expect } from 'vitest'
import { parseNoi, parseStaticSymbols, SdccSymbolProvider } from '../../src/symbols/sdcc.js'

describe('parseNoi', () => {
  it('parses DEF lines into symbol maps', () => {
    const symbols = parseNoi([
      'DEF _my_func 0x4030',
      'DEF _my_var 0xC000',
    ].join('\n'))

    expect(symbols.raw.get('_my_func')).toBe(0x4030)
    expect(symbols.raw.get('_my_var')).toBe(0xC000)
    expect(symbols.clean.get('my_func')).toBe(0x4030)
    expect(symbols.clean.get('my_var')).toBe(0xC000)
  })

  it('strips leading underscore for clean names', () => {
    const symbols = parseNoi('DEF _hello_world 0x5000\n')

    expect(symbols.raw.has('_hello_world')).toBe(true)
    expect(symbols.clean.has('hello_world')).toBe(true)
    expect(symbols.clean.get('hello_world')).toBe(0x5000)
  })

  it('preserves names without leading underscore', () => {
    const symbols = parseNoi('DEF noprefix 0x6000\n')

    expect(symbols.raw.get('noprefix')).toBe(0x6000)
    expect(symbols.clean.get('noprefix')).toBe(0x6000)
  })

  it('skips non-DEF lines', () => {
    const symbols = parseNoi([
      '# comment',
      '',
      'SOMETHING ELSE',
      'DEF _valid 0x1234',
      'INVALID LINE',
    ].join('\n'))

    expect(symbols.clean.size).toBe(1)
    expect(symbols.clean.get('valid')).toBe(0x1234)
  })

  it('handles uppercase hex addresses', () => {
    const symbols = parseNoi('DEF _upper 0xABCD\n')
    expect(symbols.clean.get('upper')).toBe(0xABCD)
  })
})

describe('SdccSymbolProvider', () => {
  it('implements SymbolProvider interface', () => {
    const noiContent = [
      'DEF _my_func 0x4030',
      'DEF _my_var 0xC000',
    ].join('\n')

    const provider = new SdccSymbolProvider(noiContent)

    expect(provider.has('my_func')).toBe(true)
    expect(provider.has('my_var')).toBe(true)
    expect(provider.has('nonexistent')).toBe(false)

    expect(provider.resolve('my_func')).toBe(0x4030)
    expect(provider.resolve('my_var')).toBe(0xC000)
    expect(provider.resolve('nonexistent')).toBeUndefined()
  })

  it('resolves static symbols when lstContents is provided', () => {
    const noiContent = 'DEF _exported_func 0x4100\n'

    const lstContent = [
      '                              1\t.area _CODE',
      '   00000000  1\t_exported_func::',
      '   00000010  2\t_static_helper:',
    ].join('\n')

    const provider = new SdccSymbolProvider(noiContent, [lstContent])

    // exported_func is at offset 0 in _CODE, absolute 0x4100
    // static_helper is at offset 0x10, so absolute 0x4100 + 0x10 = 0x4110
    expect(provider.has('static_helper')).toBe(true)
    expect(provider.resolve('static_helper')).toBe(0x4110)
  })

  it('resolves static data variables using segment base from .noi', () => {
    // .noi has an exported CODE symbol and the DATA segment base, but no exported DATA labels
    const noiContent = [
      'DEF _exported_func 0x4100',
      'DEF s__DATA 0xC000',
    ].join('\n')

    const lstContent = [
      '                              1\t.area _CODE',
      '   00000000  1\t_exported_func::',
      '   00000010  2\t_static_helper:',
      '                              3\t.area _DATA',
      '   00000000  4\t_paddle_l_y:',
      '   00000002  5\t_paddle_r_y:',
      '   00000004  6\t_ball_x:',
    ].join('\n')

    const provider = new SdccSymbolProvider(noiContent, [lstContent])

    // CODE symbols still resolve via exported anchor
    expect(provider.resolve('static_helper')).toBe(0x4110)

    // DATA symbols resolve via s__DATA segment base
    expect(provider.has('paddle_l_y')).toBe(true)
    expect(provider.resolve('paddle_l_y')).toBe(0xC000)
    expect(provider.resolve('paddle_r_y')).toBe(0xC002)
    expect(provider.resolve('ball_x')).toBe(0xC004)
  })
})
