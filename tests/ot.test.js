/**
 * ot.test.js — Unit Tests for the OT Engine
 * ==========================================
 *
 * We test the core OT algorithm: transformOp() and applyOp()
 *
 * Each test follows this pattern:
 *   1. Start with a document string
 *   2. Create two CONCURRENT operations (same base state)
 *   3. Transform one against the other
 *   4. Apply both in sequence
 *   5. Verify convergence: applying in reverse order gives the same result
 *
 * CONVERGENCE is the key OT guarantee: no matter which op is applied first,
 * after transformation, the final document is the same.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Operation, transformOp, applyOp } = require('../ot/ot-engine');
const { OTDocument } = require('../ot/ot-document');

// ─── Helper: create a simple operation ───────────────────────────────────────
function op(type, position, chars, clientId = 'client-A', clientVersion = 0) {
  return new Operation(type, position, chars, clientId, clientVersion);
}

// ─── applyOp tests ────────────────────────────────────────────────────────────
describe('applyOp', () => {

  it('inserts text at the beginning', () => {
    const result = applyOp('world', op('insert', 0, 'Hello '));
    assert.equal(result, 'Hello world');
  });

  it('inserts text in the middle', () => {
    const result = applyOp('Hllo', op('insert', 1, 'e'));
    assert.equal(result, 'Hello');
  });

  it('inserts text at the end', () => {
    const result = applyOp('Hello', op('insert', 5, '!'));
    assert.equal(result, 'Hello!');
  });

  it('deletes text from the beginning', () => {
    const result = applyOp('Hello', op('delete', 0, 'He'));
    assert.equal(result, 'llo');
  });

  it('deletes text from the middle', () => {
    const result = applyOp('Hello', op('delete', 2, 'l'));
    assert.equal(result, 'Helo');
  });

  it('deletes text at the end', () => {
    const result = applyOp('Hello!', op('delete', 5, '!'));
    assert.equal(result, 'Hello');
  });

});

// ─── transformOp: Insert vs Insert ───────────────────────────────────────────
describe('transformOp — Insert vs Insert', () => {

  it('transforms: insert before another insert → position shifts right', () => {
    /**
     * Document: "Hello"
     * opA: insert "X" at position 1 (between H and e)
     * opB: insert "Y" at position 3 (between l and l)
     *
     * If we apply opA first, "Hello" → "HXello"
     * Then opB should still insert at position 4 (shifted by 1 due to opA)
     */
    const opA = op('insert', 1, 'X', 'A');
    const opB = op('insert', 3, 'Y', 'B');

    const opB_after_opA = transformOp(opB, opA);
    assert.equal(opB_after_opA.position, 4, 'B should shift right by 1 (length of X)');

    // Verify convergence:
    const docAfterAB = applyOp(applyOp('Hello', opA), opB_after_opA);

    const opA_after_opB = transformOp(opA, opB);
    const docAfterBA = applyOp(applyOp('Hello', opB), opA_after_opB);

    assert.equal(docAfterAB, docAfterBA, 'Documents must converge regardless of apply order');
  });

  it('transforms: insert at same position — tie-break by clientId', () => {
    /**
     * Two concurrent inserts at the SAME position.
     * Client "A" < Client "B" alphabetically → A's char goes first.
     *
     * Document: "Hi"
     * opA: insert "X" at position 1 (client "A")
     * opB: insert "Y" at position 1 (client "B")
     *
     * Expected after transform:
     *   A wins position 1 (keeps position)
     *   B shifts to position 2
     * Result: "HXYi"
     */
    const opA = op('insert', 1, 'X', 'A');
    const opB = op('insert', 1, 'Y', 'B');

    const opB_after_opA = transformOp(opB, opA);
    assert.equal(opB_after_opA.position, 2, 'B should shift right because A has lower clientId');

    const docAfterAB = applyOp(applyOp('Hi', opA), opB_after_opA);

    const opA_after_opB = transformOp(opA, opB);
    const docAfterBA = applyOp(applyOp('Hi', opB), opA_after_opB);

    assert.equal(docAfterAB, docAfterBA, 'Converges to same result');
    assert.equal(docAfterAB, 'HXYi');
  });

  it('transforms: insert after another insert → no position change', () => {
    /**
     * opA inserts at position 3, opB inserts at position 1.
     * Since opB is before opA, transforming opA against opB shifts it right.
     * But transforming opB against opA: opA is after opB → no change.
     */
    const opA = op('insert', 3, 'X', 'A');
    const opB = op('insert', 1, 'Y', 'B');

    const opA_after_opB = transformOp(opA, opB);
    assert.equal(opA_after_opB.position, 4, 'A shifts right because B inserted before A');

    const opB_after_opA = transformOp(opB, opA);
    assert.equal(opB_after_opA.position, 1, 'B does not change because A is after B');
  });

});

// ─── transformOp: Insert vs Delete ───────────────────────────────────────────
describe('transformOp — Insert vs Delete', () => {

  it('transforms: delete before an insert → insert position shifts left', () => {
    /**
     * Document: "Hello World"
     * opA: delete "ello" at position 1 → "H World"
     * opB: insert "!" at position 6
     *
     * After opA, position 6 becomes position 2 (shifted left by 4)
     */
    const opA = op('delete', 1, 'ello', 'A');
    const opB = op('insert', 6, '!', 'B');

    const opB_after_opA = transformOp(opB, opA);
    assert.equal(opB_after_opA.position, 2, 'B should shift left by 4 (length of deleted "ello")');
  });

  it('transforms: delete after an insert → no position change', () => {
    /**
     * opA: delete at position 8 (after opB's insert position of 2)
     * opB: insert at position 2
     *
     * Transforming opA against opB: opB inserted before position 8 → shift right
     */
    const opA = op('delete', 8, 'x', 'A');
    const opB = op('insert', 2, 'abc', 'B');

    const opA_after_opB = transformOp(opA, opB);
    assert.equal(opA_after_opB.position, 11, 'A shifts right because B inserted 3 chars before it');
  });

});

// ─── transformOp: Delete vs Delete ───────────────────────────────────────────
describe('transformOp — Delete vs Delete', () => {

  it('transforms: two non-overlapping deletes', () => {
    /**
     * Document: "Hello World"
     * opA: delete "Hel" at position 0
     * opB: delete "orld" at position 7
     *
     * After opA: "lo World" — opB's position shifts left by 3
     */
    const opA = op('delete', 0, 'Hel', 'A');
    const opB = op('delete', 7, 'orld', 'B');

    const opB_after_opA = transformOp(opB, opA);
    assert.equal(opB_after_opA.position, 4, 'B shifts left by 3 (length of deleted "Hel")');

    // Convergence check
    const docAfterAB = applyOp(applyOp('Hello World', opA), opB_after_opA);
    const opA_after_opB = transformOp(opA, opB);
    const docAfterBA = applyOp(applyOp('Hello World', opB), opA_after_opB);

    assert.equal(docAfterAB, docAfterBA, 'Converges');
  });

  it('transforms: overlapping deletes — both try to delete same region', () => {
    /**
     * Document: "abcde"
     * opA: delete "bc" at position 1
     * opB: delete "bcd" at position 1
     *
     * After opA: "ade" — opB should only delete "d" (the non-overlapping part)
     */
    const opA = op('delete', 1, 'bc', 'A');
    const opB = op('delete', 1, 'bcd', 'B');

    const opB_after_opA = transformOp(opB, opA);
    // The "bc" part was already deleted by opA; only "d" remains
    assert.equal(opB_after_opA.chars, 'd', 'Should only delete the non-overlapping "d"');

    const docAfterAB = applyOp(applyOp('abcde', opA), opB_after_opA);
    assert.equal(docAfterAB, 'ae', 'Result should be "ae" after both deletes');
  });

});

// ─── OTDocument: Server-side transformation ───────────────────────────────────
describe('OTDocument — server-side transformation', () => {

  it('single client: applies ops in order', () => {
    const doc = new OTDocument();
    const op1 = new Operation('insert', 0, 'Hello', 'client1', 0);
    const op2 = new Operation('insert', 5, ' World', 'client1', 1);

    doc.receiveOp(op1);
    doc.receiveOp(op2);

    assert.equal(doc.content, 'Hello World');
    assert.equal(doc.serverVersion, 2);
  });

  it('two concurrent inserts at different positions converge', () => {
    /**
     * Two clients start from the same empty document.
     * Both send ops with clientVersion = 0 (concurrent).
     * Server transforms the second to account for the first.
     */
    const doc = new OTDocument();

    // Client A: insert "Hello" at position 0
    const opA = new Operation('insert', 0, 'Hello', 'clientA', 0);
    // Client B: insert " World" at position 0 (concurrent — also starts from v0)
    const opB = new Operation('insert', 0, ' World', 'clientB', 0);

    doc.receiveOp(opA); // applies "Hello" → doc = "Hello", v=1
    doc.receiveOp(opB); // transforms opB: clientB > clientA → shifts right by 5

    // Client A's "Hello" is at pos 0-4, Client B's " World" goes after
    // Tie at position 0: clientA < clientB → A wins position 0, B shifts to position 5
    assert.equal(doc.content, 'Hello World');
    assert.equal(doc.serverVersion, 2);
  });

  it('three concurrent ops all converge', () => {
    const doc = new OTDocument();

    // All three clients start from version 0 (fully concurrent)
    const opA = new Operation('insert', 0, 'A', 'clientA', 0);
    const opB = new Operation('insert', 0, 'B', 'clientB', 0);
    const opC = new Operation('insert', 0, 'C', 'clientC', 0);

    doc.receiveOp(opA);
    doc.receiveOp(opB);
    doc.receiveOp(opC);

    // All chars inserted at position 0, tie-break by clientId (A < B < C)
    // A wins pos 0, B shifts to 1, C shifts to 2
    assert.equal(doc.content, 'ABC');
    assert.equal(doc.serverVersion, 3);
  });

  it('insert then delete convergence', () => {
    const doc = new OTDocument();

    // Start with "Hello"
    doc.receiveOp(new Operation('insert', 0, 'Hello', 'setup', 0));

    // Two concurrent ops from version 1:
    // Client A inserts "X" at position 2
    const opA = new Operation('insert', 2, 'X', 'clientA', 1);
    // Client B deletes 'l' at position 2
    const opB = new Operation('delete', 2, 'l', 'clientB', 1);

    doc.receiveOp(opA); // "Hello" → "HeXllo", v=2
    doc.receiveOp(opB); // transform: B's delete at pos 2 → pos 3 (after X), "HeXllo" → "HeXlo"

    assert.equal(doc.content, 'HeXlo');
    assert.equal(doc.serverVersion, 3);
  });

  it('reset clears the document', () => {
    const doc = new OTDocument();
    doc.receiveOp(new Operation('insert', 0, 'test', 'c', 0));
    doc.reset();
    assert.equal(doc.content, '');
    assert.equal(doc.serverVersion, 0);
    assert.deepEqual(doc.history, []);
  });

});

