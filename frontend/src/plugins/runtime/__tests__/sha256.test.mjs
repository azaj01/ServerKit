// Proving test for the dependency-free SHA-256 + the digest seam (plan 32
// Decision 2). The HTTP-only panel path (pure-JS sha256) MUST compute the same
// digest as the secure-context path (crypto.subtle). This asserts the pure-JS
// implementation against known vectors AND against Node's crypto for random
// inputs, and asserts the digest seam agrees with the pure-JS hash.
//
// Run: node --test src/plugins/runtime/__tests__/sha256.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import { sha256Hex } from '../sha256.js';
import { digestBytes } from '../digest.js';

const enc = new TextEncoder();

function nodeSha256(bytes) {
    return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

test('known NIST vectors', () => {
    // Empty input
    assert.equal(
        sha256Hex(new Uint8Array(0)),
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    // "abc"
    assert.equal(
        sha256Hex(enc.encode('abc')),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    // 448-bit multi-block message
    assert.equal(
        sha256Hex(enc.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')),
        '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
});

test('accepts ArrayBuffer, Uint8Array, and DataView views alike', () => {
    const u8 = enc.encode('serverkit');
    const expected = nodeSha256(u8);
    assert.equal(sha256Hex(u8), expected);
    assert.equal(sha256Hex(u8.buffer), expected);
    assert.equal(sha256Hex(new DataView(u8.buffer)), expected);
});

test('agrees with Node crypto across random sizes (incl. padding boundaries)', () => {
    // Sizes around the 56/64-byte block-padding boundary are the classic
    // off-by-one traps, so hit them explicitly plus a spread of larger buffers.
    const sizes = [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000, 4096];
    for (const n of sizes) {
        const bytes = new Uint8Array(randomBytes(n));
        assert.equal(sha256Hex(bytes), nodeSha256(bytes), `size ${n}`);
    }
});

test('digest seam agrees with the pure-JS hash', async () => {
    // In node globalThis.crypto.subtle exists, so digestBytes takes the native
    // path — this asserts the two implementations produce the IDENTICAL digest.
    const bytes = new Uint8Array(randomBytes(2048));
    assert.equal(await digestBytes(bytes), sha256Hex(bytes));
    assert.equal(await digestBytes(bytes), nodeSha256(bytes));
});
