/**
 * crdt.test.js — Unit Tests for the Logoot CRDT
 * ===============================================
 *
 * We test the core CRDT properties:
 *   1. ID ordering (LogootID.compare)
 *   2. Insert ordering (characters always sorted by ID)
 *   3. Commutativity (apply A then B = apply B then A)
 *   4. Idempotency (applying same op twice = applying once)
 *   5. Conflict-free concurrent inserts at the same "position"
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { LogootID, generateIDBetween } = require('../crdt/logoot-id');
const { LogootDocument } = require('../crdt/logoot-document');

// ─── LogootID tests ───────────────────────────────────────────────────────────
describe('LogootID — ordering', () => {

  it('orders by position (lower position = earlier in document)', () => {
    const id1 = new LogootID(0.3, 'A', 1);
    const id2 = new LogootID(0.7, 'A', 1);
    assert.ok(id1.compare(id2) < 0, 'id1 (0.3) should come before id2 (0.7)');
    assert.ok(id2.compare(id1) > 0, 'id2 (0.7) should come after id1 (0.3)');
  });

  it('breaks ties by siteId (lexicographic)', () => {
    const idA = new LogootID(0.5, 'A', 1);
    const idB = new LogootID(0.5, 'B', 1);
    assert.ok(idA.compare(idB) < 0, 'A should come before B (lexicographic)');
    assert.ok(idB.compare(idA) > 0, 'B should come after A');
  });

  it('breaks ties by clock when position and siteId are equal', () => {
    const id1 = new LogootID(0.5, 'A', 1);
    const id2 = new LogootID(0.5, 'A', 2);
    assert.ok(id1.compare(id2) < 0, 'Lower clock comes first');
  });

  it('equals() returns true for identical IDs', () => {
    const id1 = new LogootID(0.5, 'X', 3);
    const id2 = new LogootID(0.5, 'X', 3);
    assert.ok(id1.equals(id2));
  });

  it('serializes and deserializes correctly (JSON round-trip)', () => {
    const original = new LogootID(0.123456789, 'client-abc', 42);
    const serialized = original.toJSON();
    const restored = LogootID.fromJSON(serialized);
    assert.ok(original.equals(restored), 'Round-trip should preserve the ID');
  });

});

// ─── generateIDBetween tests ──────────────────────────────────────────────────
describe('generateIDBetween — ID allocation', () => {

  it('generates an ID strictly between two neighbours', () => {
    const left = new LogootID(0.2, 'A', 1);
    const right = new LogootID(0.8, 'A', 2);
    const newId = generateIDBetween(left, right, 'B', 1);

    assert.ok(newId.compare(left) > 0, 'New ID must be after left');
    assert.ok(newId.compare(right) < 0, 'New ID must be before right');
  });

  it('generates an ID after null left (start of document)', () => {
    const right = new LogootID(0.5, 'A', 1);
    const newId = generateIDBetween(null, right, 'B', 1);

    assert.ok(newId.position > 0, 'Must be after document start (0)');
    assert.ok(newId.compare(right) < 0, 'Must be before right neighbour');
  });

  it('generates an ID before null right (end of document)', () => {
    const left = new LogootID(0.5, 'A', 1);
    const newId = generateIDBetween(left, null, 'B', 1);

    assert.ok(newId.compare(left) > 0, 'Must be after left neighbour');
    assert.ok(newId.position < 1, 'Must be before document end (1)');
  });

  it('allocates unique IDs even between very close neighbours', () => {
    // Stress test: repeatedly allocate IDs in a tight range
    let left = new LogootID(0.4999, 'A', 1);
    let right = new LogootID(0.5001, 'A', 2);

    for (let i = 0; i < 10; i++) {
      const newId = generateIDBetween(left, right, 'B', i);
      assert.ok(newId.compare(left) > 0, `Iteration ${i}: must be after left`);
      assert.ok(newId.compare(right) < 0, `Iteration ${i}: must be before right`);
    }
  });

});

// ─── LogootDocument tests ─────────────────────────────────────────────────────
describe('LogootDocument — insert and toString', () => {

  it('inserts a single character', () => {
    const doc = new LogootDocument();
    const id = new LogootID(0.5, 'A', 1);
    doc.insert(id, 'H');
    assert.equal(doc.toString(), 'H');
  });

  it('inserts multiple characters in position order', () => {
    /**
     * Even if we insert out of order (id3, id1, id2),
     * the document should render in ID-sorted order (id1, id2, id3).
     * This is the CRDT sorting guarantee.
     */
    const doc = new LogootDocument();
    const id1 = new LogootID(0.2, 'A', 1);
    const id2 = new LogootID(0.5, 'A', 2);
    const id3 = new LogootID(0.8, 'A', 3);

    // Insert in reverse order
    doc.insert(id3, 'o');
    doc.insert(id1, 'H');
    doc.insert(id2, 'i');

    // Should render in position order: H(0.2), i(0.5), o(0.8)
    assert.equal(doc.toString(), 'Hio');
  });

  it('is idempotent: inserting the same ID twice has no effect', () => {
    const doc = new LogootDocument();
    const id = new LogootID(0.5, 'A', 1);

    doc.insert(id, 'X');
    doc.insert(id, 'X'); // duplicate
    doc.insert(id, 'X'); // duplicate again

    assert.equal(doc.toString(), 'X', 'Should only contain one X');
    assert.equal(doc.entries.length, 1);
  });

});

// ─── LogootDocument: delete ────────────────────────────────────────────────────
describe('LogootDocument — delete', () => {

  it('deletes a character by ID', () => {
    const doc = new LogootDocument();
    const id1 = new LogootID(0.3, 'A', 1);
    const id2 = new LogootID(0.6, 'A', 2);

    doc.insert(id1, 'A');
    doc.insert(id2, 'B');
    doc.delete(id1);

    assert.equal(doc.toString(), 'B');
    assert.equal(doc.entries.length, 1);
  });

  it('delete is idempotent: deleting same ID twice is safe', () => {
    const doc = new LogootDocument();
    const id = new LogootID(0.5, 'A', 1);

    doc.insert(id, 'X');
    doc.delete(id);
    doc.delete(id); // second delete should be a no-op

    assert.equal(doc.toString(), '');
    assert.equal(doc.entries.length, 0);
  });

  it('handles delete before insert (out-of-order network delivery)', () => {
    /**
     * CRDT tombstone test:
     * The delete message arrives BEFORE the insert (due to network reordering).
     * When the insert arrives later, it should be discarded because it was already deleted.
     */
    const doc = new LogootDocument();
    const id = new LogootID(0.5, 'A', 1);

    // Delete arrives first (tombstone is recorded)
    doc.delete(id);
    // Insert arrives later — should be ignored because of tombstone
    doc.insert(id, 'X');

    assert.equal(doc.toString(), '', 'Character should not appear (already tombstoned)');
    assert.equal(doc.entries.length, 0);
  });

});

// ─── CRDT Commutativity — the key property ────────────────────────────────────
describe('LogootDocument — commutativity (order-independence)', () => {

  it('concurrent inserts converge regardless of application order', () => {
    /**
     * This is THE KEY TEST for CRDT correctness.
     *
     * Scenario: Two clients insert characters at the same logical position.
     * Client A inserts "X" with id [0.5, "A", 1]
     * Client B inserts "Y" with id [0.5, "B", 1]  ← same position, different site
     *
     * Both clients receive both ops (possibly in different order).
     * Both documents should converge to "XY" (A < B alphabetically).
     */
    const idA = new LogootID(0.5, 'A', 1);
    const idB = new LogootID(0.5, 'B', 1);

    // Client 1: receives A's op first, then B's
    const doc1 = new LogootDocument();
    doc1.insert(idA, 'X');
    doc1.insert(idB, 'Y');

    // Client 2: receives B's op first, then A's (different network order!)
    const doc2 = new LogootDocument();
    doc2.insert(idB, 'Y');
    doc2.insert(idA, 'X');

    // CRDT GUARANTEE: both should produce the same result
    assert.equal(doc1.toString(), doc2.toString(), 'CRDT must be commutative');
    assert.equal(doc1.toString(), 'XY', 'A (lower siteId) comes before B');
  });

  it('insert and delete commute: different orders give same result', () => {
    /**
     * Two concurrent ops:
     *   Client A: insert "Z" (new character)
     *   Client B: delete character with idX
     *
     * No matter which order these are applied, the result is the same.
     */
    const idX = new LogootID(0.3, 'A', 1);
    const idZ = new LogootID(0.6, 'B', 1);

    // Client 1: insert X, then later: insert Z and delete X
    const doc1 = new LogootDocument();
    doc1.insert(idX, 'X');
    // Concurrent: A inserts Z, B deletes X
    doc1.insert(idZ, 'Z');
    doc1.delete(idX);

    // Client 2: insert X, then later: delete X and insert Z (reverse order)
    const doc2 = new LogootDocument();
    doc2.insert(idX, 'X');
    doc2.delete(idX);
    doc2.insert(idZ, 'Z');

    assert.equal(doc1.toString(), doc2.toString(), 'Delete + insert must commute');
    assert.equal(doc1.toString(), 'Z');
  });

  it('three concurrent insertions converge on all permutations', () => {
    /**
     * Test all 6 permutations of 3 concurrent inserts.
     * All should produce the same document.
     */
    const id1 = new LogootID(0.3, 'A', 1);
    const id2 = new LogootID(0.5, 'B', 1);
    const id3 = new LogootID(0.7, 'C', 1);

    const permutations = [
      [[id1,'a'],[id2,'b'],[id3,'c']],
      [[id1,'a'],[id3,'c'],[id2,'b']],
      [[id2,'b'],[id1,'a'],[id3,'c']],
      [[id2,'b'],[id3,'c'],[id1,'a']],
      [[id3,'c'],[id1,'a'],[id2,'b']],
      [[id3,'c'],[id2,'b'],[id1,'a']],
    ];

    const results = permutations.map(perm => {
      const doc = new LogootDocument();
      for (const [id, char] of perm) doc.insert(id, char);
      return doc.toString();
    });

    // All permutations must give the same result
    const first = results[0];
    results.forEach((r, i) => {
      assert.equal(r, first, `Permutation ${i} should equal permutation 0`);
    });
    assert.equal(first, 'abc');
  });

});

// ─── generateInsertBetween integration test ───────────────────────────────────
describe('LogootDocument — generateInsertBetween', () => {

  it('generates IDs that maintain correct ordering when typing sequentially', () => {
    /**
     * Simulate typing "Hello" character by character.
     * Each char's ID must be greater than the previous.
     * generateInsertBetween(leftIndex, rightIndex, char, siteId, clock) returns { id, char }
     */
    const doc = new LogootDocument();
    const siteId = 'site-A';
    const text = 'Hello';

    for (let i = 0; i < text.length; i++) {
      // Insert at end: leftIndex = i-1, rightIndex = i (which is doc.entries.length)
      const { id: newId, char } = doc.generateInsertBetween(i - 1, doc.entries.length, text[i], siteId, i + 1);
      doc.insert(newId, char);
    }

    assert.equal(doc.toString(), 'Hello', 'Sequential typing should produce correct text');

    // Verify IDs are strictly increasing
    for (let i = 1; i < doc.entries.length; i++) {
      assert.ok(
        doc.entries[i].id.compare(doc.entries[i-1].id) > 0,
        `Entry ${i} must have a larger ID than entry ${i-1}`
      );
    }
  });

});

