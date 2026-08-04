/** Чому в частини лідів місто не визначилось. */
import { getPlaces } from '../src/db/index.js';
import { cityOf, stateOf } from '../src/filters/address.js';

const places = getPlaces("WHERE bucket = 'leads'");

const bad: string[] = [];
let ok = 0;

for (const p of places) {
  const city = cityOf(p.address);
  const state = stateOf(p.address);
  if (city && state) {
    ok++;
    continue;
  }
  bad.push(`${(city ?? '∅').padEnd(18)} ${(state ?? '∅').padEnd(4)} ← ${p.address}`);
}

console.log(`лідів: ${places.length}, місто визначено: ${ok}, ні: ${bad.length}\n`);
for (const b of bad.slice(0, 15)) console.log('  ' + b);
