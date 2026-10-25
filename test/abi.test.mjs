import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, selector, topic, encodeCall, decode, encodeArgs, checksum, revertReason } from '../lib/abi.mjs';

test('keccak256 known vectors', () => {
  assert.equal(keccak256(''), '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(keccak256('abc'), '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  // longer than one 136-byte block
  assert.equal(keccak256('a'.repeat(200)), keccak256(new TextEncoder().encode('a'.repeat(200))));
});

test('selectors and topics', () => {
  assert.equal(selector('transfer(address,uint256)'), '0xa9059cbb');
  assert.equal(selector('approve(address spender, uint256 amount)'), '0x095ea7b3');
  assert.equal(selector('balanceOf(address)'), '0x70a08231');
  assert.equal(selector('swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)'), '0xb6f9de95');
  assert.equal(selector('mint(uint256)'), '0xa0712d68');
  assert.equal(topic('Transfer(address,address,uint256)'), '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
});

test('encode static and dynamic', () => {
  const d = encodeCall('approve(address,uint256)', ['0x10ED43C718714eb63d5aA57B78B54704E256024E', 5n]);
  assert.equal(d, '0x095ea7b3' + '00000000000000000000000010ed43c718714eb63d5aa57b78b54704e256024e' + '5'.padStart(64, '0'));
  const s = encodeCall('swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)',
    [1n, ['0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', '0x55d398326f99059fF775485246999027B3197955'], '0x0000000000000000000000000000000000000001', 9n]);
  const body = s.slice(10);
  assert.equal(body.slice(64, 128), (128).toString(16).padStart(64, '0')); // offset of the array
  assert.equal(body.slice(256, 320), '2'.padStart(64, '0'));            // array length
});

test('decode round trip incl. tuple and string', () => {
  const enc = encodeArgs(['uint256', 'string', '(address,uint256)', 'uint256[]'], [7n, 'hello', ['0x0000000000000000000000000000000000000002', 3n], [1n, 2n]]);
  const [a, b, c, d] = decode(['uint256', 'string', '(address,uint256)', 'uint256[]'], enc);
  assert.equal(a, 7n); assert.equal(b, 'hello'); assert.deepEqual(c, ['0x0000000000000000000000000000000000000002', 3n]); assert.deepEqual(d, [1n, 2n]);
});

test('checksum and revert reasons', () => {
  assert.equal(checksum('0x10ed43c718714eb63d5aa57b78b54704e256024e'), '0x10ED43C718714eb63d5aA57B78B54704E256024E');
  const err = '0x08c379a0' + encodeArgs(['string'], ['Must hold the required NFT']).slice(2);
  assert.equal(revertReason(err), 'Must hold the required NFT');
  assert.equal(revertReason('0xf947691f', { '0xf947691f': 'NoAgentId' }), 'NoAgentId');
});
