/**
 * Record keys in atproto's TID format: 13 characters of base32-sortable
 * microseconds since the epoch plus a 10-bit clock id, so keys made here sort
 * by creation time like the PDS's own.
 */

const ALPHABET = '234567abcdefghijklmnopqrstuvwxyz'
let last = 0
const clockId = Math.floor(Math.random() * 1024)

function encode(value: bigint, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out = ALPHABET[Number(value & 31n)] + out
    value >>= 5n
  }
  return out
}

export function nextTid(now: () => number = () => Date.now()): string {
  // Microseconds, strictly increasing even within one millisecond.
  let micros = now() * 1000
  if (micros <= last) micros = last + 1
  last = micros
  return encode(BigInt(micros), 11) + encode(BigInt(clockId), 2)
}

export function isTid(value: string): boolean {
  return /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/.test(value)
}
