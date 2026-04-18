import { describe, it, expect } from 'vitest'
import { Z88dkSymbols } from '../../src/symbols/z88dk.js'

const SAMPLE_MAP = `
_clamp_add                      = $9363 ; addr, public, , hello_c, code_compiler, hello.c:14
_main                           = $9383 ; addr, public, , hello_c, code_compiler, hello.c:20
l_clamp_add_00103               = $9380 ; addr, local, , hello_c, code_compiler, hello.c:18
CHAR_BELL                       = $0007 ; const, public, , zx_crt_asm_m4, , config.inc:370
PAPER_WHITE                     = $0047 ; const, local, , zx_crt_asm_m4, , config.inc:371
`.trim()

describe('Z88dkSymbols', () => {
  const symbols = new Z88dkSymbols(SAMPLE_MAP)

  it('resolves exported functions and strips the leading underscore', () => {
    expect(symbols.get('clamp_add')).toBe(0x9363)
    expect(symbols.get('main')).toBe(0x9383)
  })

  it('ignores constants (non-addr metadata)', () => {
    expect(symbols.has('CHAR_BELL')).toBe(false)
    expect(symbols.has('PAPER_WHITE')).toBe(false)
  })

  it('includes local (non-underscore-prefixed) labels only when they have the underscore', () => {
    // l_clamp_add_00103 has no leading _ → not captured
    expect(symbols.has('l_clamp_add_00103')).toBe(false)
  })

  it('query returns undefined for missing symbols', () => {
    expect(symbols.query('does_not_exist')).toBeUndefined()
  })

  it('get throws for missing symbols', () => {
    expect(() => symbols.get('does_not_exist')).toThrow(/Unknown symbol/)
  })

  it('has returns boolean', () => {
    expect(symbols.has('clamp_add')).toBe(true)
    expect(symbols.has('nope')).toBe(false)
  })
})
