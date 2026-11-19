// Drop-in replacement for ./nf.ts that uses String.prototype.normalize().
// Smaller, but the result depends on the JS engine's Unicode version.

import { explodeCp, strFromCps } from './utils.ts';

const nf = (cps: Iterable<number>, form: string) => explodeCp(strFromCps([...cps]).normalize(form));

/** canonical decomposition (native) */
export const nfd = (cps: Iterable<number>): number[] => nf(cps, 'NFD');

/** canonical composition (native) */
export const nfc = (cps: Iterable<number>): number[] => nf(cps, 'NFC');

/** nothing to load */
export const initNF = (_cm: number[]) => {};
