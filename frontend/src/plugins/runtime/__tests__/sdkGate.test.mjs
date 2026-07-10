// Proving test for the load-time SDK gate (plan 32 Decision 1).
//
// The gate is the pure half of the runtime loader's version check, split out so
// it runs under plain node. This covers the refusal matrix: grace (no range),
// load (in range / panel reported nothing), and refuse (out of range).
//
// Run: node --test src/plugins/runtime/__tests__/sdkGate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { sdkGateDecision, sdkRefusalMessage } from '../sdkGate.js';

test('no pinned range → grace (warn-and-load for one release)', () => {
    assert.equal(sdkGateDecision('', '1.5.0'), 'grace');
    assert.equal(sdkGateDecision('   ', '1.5.0'), 'grace');
    assert.equal(sdkGateDecision(null, '1.5.0'), 'grace');
    assert.equal(sdkGateDecision(undefined, '1.5.0'), 'grace');
});

test('panel reported no SDK version → load (no opinion)', () => {
    assert.equal(sdkGateDecision('^1.2.0', null), 'load');
    assert.equal(sdkGateDecision('^1.2.0', ''), 'load');
    assert.equal(sdkGateDecision('^1.2.0', undefined), 'load');
});

test('range covers the panel SDK → load', () => {
    assert.equal(sdkGateDecision('^1.2.0', '1.2.0'), 'load');
    assert.equal(sdkGateDecision('^1.2.0', '1.9.9'), 'load');
    assert.equal(sdkGateDecision('~1.2.0', '1.2.9'), 'load');
    assert.equal(sdkGateDecision('>=2.0.0', '2.0.0'), 'load');
    assert.equal(sdkGateDecision('*', '3.1.4'), 'load');
});

test('range excludes the panel SDK → refuse (fail closed)', () => {
    assert.equal(sdkGateDecision('^1.2.0', '2.0.0'), 'refuse');
    assert.equal(sdkGateDecision('^1.2.0', '1.1.9'), 'refuse');
    assert.equal(sdkGateDecision('~1.2.0', '1.3.0'), 'refuse');
    assert.equal(sdkGateDecision('>=2.0.0', '1.9.0'), 'refuse');
});

test('refusal message names the range and the panel version', () => {
    const msg = sdkRefusalMessage('^2.0.0', '1.4.1');
    assert.ok(msg.includes('^2.0.0'));
    assert.ok(msg.includes('1.4.1'));
    assert.equal(typeof msg, 'string');
});
