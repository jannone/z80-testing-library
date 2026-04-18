import type { Hardware } from '../../core/types.js'

/**
 * Minimal ZX Spectrum hardware port.
 *
 * ULA / I/O is not modelled — unit-testing pure functions does not need
 * it. For ROM routines (RST 0x10, CHAN_OPEN, etc.) install PC hooks via
 * the `hooks` field of `Z80TestMachineConfig`, or stub individual
 * addresses through `extraStubs`.
 */
export const spectrumHardware: Hardware = {
  readPort: () => 0xFF,
  writePort: () => {},
  hooks: new Map(),
  stubs: [],
}
