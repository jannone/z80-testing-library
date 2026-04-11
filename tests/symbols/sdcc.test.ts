import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { resolve } from 'path'
import { tmpdir } from 'os'
import { parseNoi, parseStaticSymbols, SdccSymbolProvider, type OrderedLstContents } from '../../src/symbols/sdcc.js'

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

    const lkContent = 'test.rel\n'
    const ordered = SdccSymbolProvider.parseLk(lkContent, { test: lstContent })
    const provider = new SdccSymbolProvider(noiContent, ordered)

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
      '   00000000  5\t\t.ds 2',
      '   00000002  6\t_paddle_r_y:',
      '   00000002  7\t\t.ds 2',
      '   00000004  8\t_ball_x:',
      '   00000004  9\t\t.ds 1',
    ].join('\n')

    const lkContent = 'test.rel\n'
    const ordered = SdccSymbolProvider.parseLk(lkContent, { test: lstContent })
    const provider = new SdccSymbolProvider(noiContent, ordered)

    // CODE symbols still resolve via exported anchor
    expect(provider.resolve('static_helper')).toBe(0x4110)

    // DATA symbols resolve via s__DATA segment base (single file, offset = 0)
    expect(provider.has('paddle_l_y')).toBe(true)
    expect(provider.resolve('paddle_l_y')).toBe(0xC000)
    expect(provider.resolve('paddle_r_y')).toBe(0xC002)
    expect(provider.resolve('ball_x')).toBe(0xC004)
  })

  it('resolves static vars using cumulative offsets across multiple files', () => {
    // Simulates 3 source files contributing to _INITIALIZED:
    //   main.lst:    score(1) + frame_count(2) = 3 bytes  (has exported anchor)
    //   physics.lst: ball_x(1) + ball_y(1) + ball_dx(1) + ball_dy(1) + collision_count(1) = 5 bytes (has exported anchor)
    //   render.lst:  sprite_count(1) = 1 byte (NO exported anchor in _INITIALIZED)

    const noiContent = [
      'DEF s__INITIALIZED 0xC082',
      'DEF _score 0xC082',
      'DEF _ball_x 0xC085',
      'DEF _main_func 0x4000',
      'DEF _physics_func 0x4100',
      'DEF _render_func 0x4200',
    ].join('\n')

    // main.lst: exported _score in _INITIALIZED
    const mainLst = [
      '                              1\t.area _CODE',
      '   00000000  1\t_main_func::',
      '                              2\t.area _INITIALIZED',
      '   00000000  3\t_score::',
      '   00000000  4\t\t.ds 1',
      '   00000001  5\t_frame_count::',
      '   00000001  6\t\t.ds 2',
    ].join('\n')

    // physics.lst: exported _ball_x in _INITIALIZED
    const physicsLst = [
      '                              1\t.area _CODE',
      '   00000000  1\t_physics_func::',
      '                              2\t.area _INITIALIZED',
      '   00000000  3\t_ball_x::',
      '   00000000  4\t\t.ds 1',
      '   00000001  5\t_ball_y::',
      '   00000001  6\t\t.ds 1',
      '   00000002  7\t_ball_dx::',
      '   00000002  8\t\t.ds 1',
      '   00000003  9\t_ball_dy::',
      '   00000003 10\t\t.ds 1',
      '   00000004 11\t_collision_count:',
      '   00000004 12\t\t.ds 1',
    ].join('\n')

    // render.lst: NO exported anchor in _INITIALIZED, only static _sprite_count
    const renderLst = [
      '                              1\t.area _CODE',
      '   00000000  1\t_render_func::',
      '                              2\t.area _INITIALIZED',
      '   00000000  3\t_sprite_count:',
      '   00000000  4\t\t.ds 1',
    ].join('\n')

    const lkContent = 'main.rel\nphysics.rel\nrender.rel\n'
    const ordered = SdccSymbolProvider.parseLk(lkContent, {
      main: mainLst,
      physics: physicsLst,
      render: renderLst,
    })
    const provider = new SdccSymbolProvider(noiContent, ordered)

    // Anchored symbols resolve correctly
    expect(provider.resolve('collision_count')).toBe(0xC089) // 0xC085 + 4

    // sprite_count must use cumulative offset: s__INITIALIZED + 3 (main) + 5 (physics) = 0xC08A
    expect(provider.resolve('sprite_count')).toBe(0xC08A)
  })

  it('parseLk orders lst contents by link order and skips missing entries', () => {
    const lkContent = [
      '-mjwx',
      '-i game.ihx',
      'bbb.rel',
      'aaa.rel',
      'missing.rel',
      '-e',
    ].join('\n')

    const ordered = SdccSymbolProvider.parseLk(lkContent, {
      aaa: 'content_aaa',
      bbb: 'content_bbb',
    })

    expect(ordered).toHaveLength(2)
    expect(ordered[0]).toBe('content_bbb')
    expect(ordered[1]).toBe('content_aaa')
  })

  it('parseLk strips directory prefixes from .rel paths', () => {
    const lkContent = [
      '-mjwx',
      '-i dist/game.ihx',
      'dist/pong.rel',
      'dist/intro.rel',
      '-e',
    ].join('\n')

    const ordered = SdccSymbolProvider.parseLk(lkContent, {
      pong: 'content_pong',
      intro: 'content_intro',
    })

    expect(ordered).toHaveLength(2)
    expect(ordered[0]).toBe('content_pong')
    expect(ordered[1]).toBe('content_intro')
  })

  it('fromFiles reads .lst files in link order from .lk file', () => {
    // Two files: alphabetical order is [aaa.lst, bbb.lst]
    // but link order in .lk is [bbb.rel, aaa.rel]
    // bbb contributes 4 bytes to _DATA, aaa has a static var at offset 0.
    // If link order is respected: static_var = s__DATA + 4
    // If alphabetical: static_var = s__DATA + 0 (wrong)

    const dir = resolve(tmpdir(), 'z80-test-lk-order-' + Date.now())
    mkdirSync(dir, { recursive: true })

    try {
      writeFileSync(resolve(dir, 'game.noi'), [
        'DEF s__DATA 0xC000',
        'DEF _func_b 0x4000',
        'DEF _func_a 0x4100',
      ].join('\n'))

      writeFileSync(resolve(dir, 'game.lk'), [
        '-mjwx',
        '-i game.ihx',
        'bbb.rel',
        'aaa.rel',
        '-e',
      ].join('\n'))

      // bbb.lst: 4 bytes in _DATA, no static labels there
      writeFileSync(resolve(dir, 'bbb.lst'), [
        '                              1\t.area _CODE',
        '   00000000  1\t_func_b::',
        '                              2\t.area _DATA',
        '   00000000  3\t_buf::',
        '   00000000  4\t\t.ds 4',
      ].join('\n'))

      // aaa.lst: static var in _DATA, no exported anchor
      writeFileSync(resolve(dir, 'aaa.lst'), [
        '                              1\t.area _CODE',
        '   00000000  1\t_func_a::',
        '                              2\t.area _DATA',
        '   00000000  3\t_my_static:',
        '   00000000  4\t\t.ds 1',
      ].join('\n'))

      const provider = SdccSymbolProvider.fromFiles(resolve(dir, 'game.noi'), dir)

      // With correct link order [bbb, aaa]: my_static = 0xC000 + 4 = 0xC004
      // With wrong alphabetical order [aaa, bbb]: my_static = 0xC000 + 0 = 0xC000
      expect(provider.resolve('my_static')).toBe(0xC004)
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  it('prefers exported anchor over cumulative offset fallback', () => {
    const noiContent = [
      'DEF s__DATA 0xC000',
      'DEF _buf 0xC010',
      'DEF _func_a 0x4000',
      'DEF _func_b 0x4100',
    ].join('\n')

    // file1: 16 bytes in _DATA (no exported anchor)
    const file1 = [
      '                              1\t.area _CODE',
      '   00000000  1\t_func_a::',
      '                              2\t.area _DATA',
      '   00000000  3\t_local_a:',
      '   00000000  4\t\t.ds 16',
    ].join('\n')

    // file2: has exported _buf in _DATA at offset 0 → anchor base = 0xC010
    const file2 = [
      '                              1\t.area _CODE',
      '   00000000  1\t_func_b::',
      '                              2\t.area _DATA',
      '   00000000  3\t_buf::',
      '   00000000  4\t\t.ds 8',
      '   00000008  5\t_local_b:',
      '   00000008  6\t\t.ds 1',
    ].join('\n')

    const lkContent = 'a.rel\nb.rel\n'
    const ordered = SdccSymbolProvider.parseLk(lkContent, { a: file1, b: file2 })
    const provider = new SdccSymbolProvider(noiContent, ordered)

    // file1 has no anchor: cumulative offset = 0, so base = 0xC000 + 0 = 0xC000
    expect(provider.resolve('local_a')).toBe(0xC000)
    // file2 has exported anchor _buf = 0xC010: anchor wins over fallback (0xC000 + 16 = 0xC010)
    expect(provider.resolve('local_b')).toBe(0xC018)
  })
})
