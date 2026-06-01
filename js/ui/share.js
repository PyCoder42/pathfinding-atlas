// share.js
// -----------------------------------------------------------------------------
// Self-contained, dependency-free scenario serialization for sharing app state
// via URLs. State objects are JSON-serializable (numbers, strings, arrays,
// nested objects, booleans). The encoding is Unicode-safe base64url so it
// survives being placed in a URL hash.
//
// Pipeline (encode):
//   object -> JSON.stringify -> UTF-8 bytes -> base64 -> base64url (URL-safe)
// Pipeline (decode) reverses each step and JSON.parses the result.
//
// All functions are pure and never throw on bad input: decode/read return null.
// They also guard against a missing `window`/`location` so the module can be
// imported and unit-tested in Node.
// -----------------------------------------------------------------------------

// --- Low-level UTF-8 <-> base64 helpers --------------------------------------

// Encode a JS string (which may contain arbitrary Unicode) into a standard
// base64 string. We must go through UTF-8 because btoa/atob only operate on
// "binary strings" (one byte per char). We prefer TextEncoder when available
// (browser + modern Node) and fall back to the classic encodeURIComponent/
// unescape trick otherwise.
function utf8ToBase64(str) {
  if (typeof TextEncoder !== 'undefined') {
    // Convert the string to UTF-8 bytes, then to a binary string for btoa.
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    // Build the binary string in chunks to avoid call-stack limits on big inputs.
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(i, i + CHUNK)
      );
    }
    return base64FromBinary(binary);
  }
  // Fallback: percent-encode to UTF-8, then unescape back into a binary string.
  // encodeURIComponent turns non-ASCII into %XX (UTF-8); unescape collapses
  // those into single-byte chars, giving us a btoa-safe binary string.
  const binary = unescape(encodeURIComponent(str));
  return base64FromBinary(binary);
}

// Decode a standard base64 string back into a JS (Unicode) string.
function base64ToUtf8(b64) {
  const binary = binaryFromBase64(b64);
  if (typeof TextDecoder !== 'undefined') {
    // Rebuild the byte array from the binary string and decode as UTF-8.
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }
  // Fallback inverse of the encodeURIComponent/unescape trick above.
  return decodeURIComponent(escape(binary));
}

// btoa wrapper that also works in Node (where btoa may be absent) via Buffer.
function base64FromBinary(binary) {
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  if (typeof Buffer !== 'undefined') {
    // 'binary' (latin1) keeps the one-byte-per-char mapping intact.
    return Buffer.from(binary, 'binary').toString('base64');
  }
  throw new Error('No base64 encoder available');
}

// atob wrapper that also works in Node via Buffer.
function binaryFromBase64(b64) {
  if (typeof atob === 'function') {
    return atob(b64);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('binary');
  }
  throw new Error('No base64 decoder available');
}

// --- base64 <-> base64url ----------------------------------------------------

// Make standard base64 URL-safe: + -> -, / -> _, and drop '=' padding.
function toBase64Url(b64) {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// Reverse toBase64Url: - -> +, _ -> /, and restore '=' padding so atob is happy.
function fromBase64Url(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  // base64 length must be a multiple of 4; pad the remainder with '='.
  const pad = b64.length % 4;
  if (pad === 2) b64 += '==';
  else if (pad === 3) b64 += '=';
  else if (pad === 1) b64 += '==='; // malformed, but let the decoder reject it
  return b64;
}

// --- Public API --------------------------------------------------------------

/**
 * Encode an arbitrary JSON-serializable object into a compact, URL-safe string.
 * @param {*} obj
 * @returns {string}
 */
export function encodeState(obj) {
  const json = JSON.stringify(obj);
  return toBase64Url(utf8ToBase64(json));
}

/**
 * Decode a string produced by encodeState back into an object.
 * Returns null on any malformed input instead of throwing.
 * @param {string} str
 * @returns {object|null}
 */
export function decodeState(str) {
  if (typeof str !== 'string' || str.length === 0) return null;
  try {
    const json = base64ToUtf8(fromBase64Url(str));
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

/**
 * Build a full shareable URL with the encoded state in the location hash.
 * Uses location.origin + location.pathname so query strings are dropped and
 * the state lives entirely in the fragment (never sent to the server).
 * Falls back to just the hash fragment if window/location is unavailable.
 * @param {*} obj
 * @returns {string}
 */
export function buildShareURL(obj) {
  const encoded = encodeState(obj);
  if (typeof location === 'undefined' || !location) {
    // No location (e.g. Node): return just the fragment portion.
    return '#s=' + encoded;
  }
  return location.origin + location.pathname + '#s=' + encoded;
}

/**
 * Read and decode state from the current URL hash ('#s=...').
 * Returns null if there is no window/location, no matching hash, or the
 * payload is malformed.
 * @returns {object|null}
 */
export function readStateFromURL() {
  if (typeof location === 'undefined' || !location) return null;
  const hash = location.hash || '';
  // Match '#s=' followed by the encoded payload (allow it anywhere in the hash).
  const match = /[#&]s=([^&]*)/.exec(hash);
  if (!match) return null;
  // The hash value may be percent-encoded by some environments; try to decode
  // it first, but fall back to the raw value if that fails.
  let payload = match[1];
  try {
    payload = decodeURIComponent(payload);
  } catch (e) {
    // keep raw payload
  }
  return decodeState(payload);
}
