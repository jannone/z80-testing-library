/** Standard MSX BIOS entry points */
export const MSX_BIOS = {
  DISSCR: 0x0041,
  ENASCR: 0x0044,
  WRTVDP: 0x0047,
  WRTVRM: 0x004D,
  RDVRM:  0x0053,
  FILVRM: 0x0056,
  LDIRVM: 0x005C,
  CHGCLR: 0x0062,
  INIGRP: 0x0072,
  SNSMAT: 0x0141,
} as const
