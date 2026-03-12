/**
 * logoot-document.js — Logoot CRDT Document
 * ==========================================
 *
 * HOW A LOGOOT DOCUMENT WORKS:
 * ----------------------------
 * Instead of storing a plain string, we store a SORTED ARRAY of entries:
 *   [ { id: LogootID, char: "H" },
 *     { id: LogootID, char: "e" },
 *     { id: LogootID, char: "l" }, ... ]
 *
 * The array is always sorted by LogootID. Since IDs are globally ordered
 * and unique, every site that receives the same set of inserts/deletes
 * will produce the SAME sorted array → automatic convergence!
 *
 * CRDT PROPERTIES:
 * ----------------
 * ✅ Commutativity: op A then B = op B then A (same result)
 * ✅ Associativity: (A then B) then C = A then (B then C)
 * ✅ Idempotency: applying the same op twice = applying it once
 *
 * These properties mean:
 * - Operations can arrive in ANY ORDER and you still converge
 * - No server transformation needed
 * - Offline editing works: buffer ops, apply when back online
 *
 * CONFLICT RESOLUTION IN CRDT:
 * -----------------------------
 * There are NO conflicts in the traditional sense!
 * Two concurrent inserts at the "same position" both get unique IDs.
 * The ordering of IDs determines which one "wins" the position —
 * deterministically the same for every client.
 *
 * This is the fundamental advantage over OT: no transformation algorithm needed.
 */

const { LogootID, generateIDBetween } = require('./logoot-id');

class LogootDocument {
  constructor() {
    /**
     * entries: array of { id: LogootID, char: string }
     * Always kept sorted by id.compare()
     */
    this.entries = [];

    /**
     * deletedIds: Set of serialized IDs that have been deleted.
     * Used to handle "tombstones" — if a delete arrives before its insert
     * (network reorder), we can still record the deletion.
     *
     * In a full implementation, tombstones prevent re-insertion of deleted chars.
     * For this demo, we use a simple set of deleted ID strings.
     */
    this.deletedIds = new Set();
  }

  /**
   * insert(id, char)
   * ----------------
   * Insert a character with the given LogootID into the document.
   * We find the correct position in the sorted array and splice it in.
   *
   * This operation is IDEMPOTENT: inserting the same ID twice is harmless
   * (we check for duplicates).
   *
   * @param {LogootID} id
   * @param {string} char
   */
  insert(id, char) {
    // Check if this ID was already deleted (out-of-order message scenario)
    const idKey = `${id.position}:${id.siteId}:${id.clock}`;
    if (this.deletedIds.has(idKey)) {
      return; // already deleted, skip
    }

    // Check for duplicate insert (idempotency)
    for (const entry of this.entries) {
      if (entry.id.equals(id)) {
        return; // already exists, skip
      }
    }

    // Find the correct insertion index using binary search
    const index = this._findInsertIndex(id);
    this.entries.splice(index, 0, { id, char });
  }

  /**
   * delete(id)
   * ----------
   * Remove the character with the given LogootID.
   * If the character hasn't arrived yet (network reorder), record the deletion
   * so we can discard it when it does arrive.
   *
   * This operation is IDEMPOTENT: deleting the same ID twice is harmless.
   *
   * @param {LogootID} id
   */
  delete(id) {
    const idKey = `${id.position}:${id.siteId}:${id.clock}`;

    // Record the deletion (handles out-of-order: delete before insert)
    this.deletedIds.add(idKey);

    // Find and remove the entry from the array
    const index = this.entries.findIndex(e => e.id.equals(id));
    if (index !== -1) {
      this.entries.splice(index, 1);
    }
  }

  /**
   * toString()
   * ----------
   * Convert the sorted entries array into a plain string.
   * This is the "rendered" document that users see.
   */
  toString() {
    return this.entries.map(e => e.char).join('');
  }

  /**
   * getEntries()
   * ------------
   * Return the full sorted array for inspection or state sync.
   * Used when a new client connects and needs the full document.
   */
  getEntries() {
    return this.entries.map(e => ({
      id: e.id.toJSON(),
      char: e.char
    }));
  }

  /**
   * generateInsertBetween(leftIndex, rightIndex, char, siteId, clock)
   * -----------------------------------------------------------------
   * Helper: generate a new LogootID for a character to be inserted between
   * the characters at leftIndex and rightIndex (in the current document view).
   *
   * leftIndex = -1 means "insert at the start"
   * rightIndex = entries.length means "insert at the end"
   *
   * @param {number} leftIndex  - index of left neighbour (-1 for start)
   * @param {number} rightIndex - index of right neighbour (entries.length for end)
   * @param {string} char       - the character to insert
   * @param {string} siteId     - the site creating this character
   * @param {number} clock      - the site's current clock value
   * @returns {{ id: LogootID, char: string }}
   */
  generateInsertBetween(leftIndex, rightIndex, char, siteId, clock) {
    const leftId = leftIndex >= 0 ? this.entries[leftIndex].id : null;
    const rightId = rightIndex < this.entries.length ? this.entries[rightIndex].id : null;
    const newId = generateIDBetween(leftId, rightId, siteId, clock);
    return { id: newId, char };
  }

  /**
   * _findInsertIndex(id) [private]
   * -------------------------------
   * Binary search: find where to insert a new ID to keep the array sorted.
   *
   * @param {LogootID} id
   * @returns {number} index to splice at
   */
  _findInsertIndex(id) {
    let lo = 0;
    let hi = this.entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1; // integer division
      if (this.entries[mid].id.compare(id) < 0) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /**
   * reset()
   * -------
   * Clear the document. Used for testing.
   */
  reset() {
    this.entries = [];
    this.deletedIds = new Set();
  }
}

// Singleton: one shared document for the CRDT server-side state
// (used for catch-up when new clients join)
const crdtDocument = new LogootDocument();

module.exports = { LogootDocument, crdtDocument };

