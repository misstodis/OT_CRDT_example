/**
 * logoot-id.js — Logoot Position Identifier
 * ==========================================
 *
 * WHAT IS A LOGOOT ID?
 * --------------------
 * In a Logoot CRDT, every character in the document has a UNIQUE, GLOBALLY
 * ORDERED identifier. The document is not just a string — it's a sorted
 * list of (id, character) pairs.
 *
 * WHY DOES THIS SOLVE CONFLICTS?
 * --------------------------------
 * In OT, position "3" means "the 3rd character", but this shifts as
 * other characters are inserted/deleted. This causes conflicts.
 *
 * In Logoot, each character has a STABLE identifier that never changes,
 * regardless of what other characters are inserted or deleted around it.
 * Because IDs are globally ordered, every client sorts them the same way
 * → all clients always converge to the same document order.
 *
 * THE IDENTIFIER FORMAT:
 * ----------------------
 * A LogootID is a tuple: [position (float), siteId (string), clock (int)]
 *
 * - position: a floating point number between 0 and 1 (like a decimal fraction)
 *   representing WHERE in the document this character lives logically.
 *   We pick positions between existing neighbours to "fit" new characters in.
 *
 * - siteId: the unique ID of the client that created this character.
 *   Used as a tie-breaker when two clients pick the same position number.
 *
 * - clock: a local Lamport clock increment, in case the same site creates
 *   two chars at the same position in the same instant.
 *
 * EXAMPLE:
 *   Doc starts empty: [BOUNDARY_LEFT(0) ... BOUNDARY_RIGHT(1)]
 *   Insert "H": id = [0.5, "clientA", 1]
 *   Insert "e" after "H": id = [0.75, "clientA", 2]   (midpoint of 0.5 and 1.0)
 *   Insert "l" after "e": id = [0.875, "clientA", 3]  (midpoint of 0.75 and 1.0)
 *
 * Two clients inserting at the "same place" get different positions
 * because we add a tiny random jitter + site tie-break → no conflict!
 */

/**
 * LogootID — a sortable, unique position identifier for one character
 */
class LogootID {
  /**
   * @param {number} position - float in (0, 1) representing logical position
   * @param {string} siteId   - unique identifier of the creating client
   * @param {number} clock    - monotonically increasing counter per site
   */
  constructor(position, siteId, clock) {
    this.position = position;
    this.siteId = siteId;
    this.clock = clock;
  }

  /**
   * compare(other)
   * --------------
   * Total ordering of Logoot IDs. Returns:
   *   negative → this ID comes before other
   *   0        → same ID (should not happen in practice)
   *   positive → this ID comes after other
   *
   * Ordering rules (in priority):
   *   1. Compare position numbers (the main ordering)
   *   2. If equal, compare siteId lexicographically (tie-breaker)
   *   3. If still equal, compare clocks (extremely rare)
   */
  compare(other) {
    // Primary: numeric position
    if (this.position !== other.position) {
      return this.position - other.position;
    }
    // Secondary tie-breaker: site ID (lexicographic)
    if (this.siteId !== other.siteId) {
      return this.siteId < other.siteId ? -1 : 1;
    }
    // Tertiary tie-breaker: clock
    return this.clock - other.clock;
  }

  /**
   * equals(other) — check exact equality
   */
  equals(other) {
    return this.position === other.position &&
           this.siteId === other.siteId &&
           this.clock === other.clock;
  }

  /**
   * Serialize to a plain object (for JSON transmission over WebSocket)
   */
  toJSON() {
    return { position: this.position, siteId: this.siteId, clock: this.clock };
  }

  /**
   * Deserialize from a plain object (after JSON.parse)
   */
  static fromJSON(obj) {
    return new LogootID(obj.position, obj.siteId, obj.clock);
  }
}

/**
 * generateIDBetween(leftId, rightId, siteId, clock)
 * --------------------------------------------------
 * The key allocation function: given two neighbouring IDs, generate a new ID
 * that sorts BETWEEN them.
 *
 * We use the midpoint of the two positions + a small random jitter to reduce
 * the chance of collision when two sites insert at the same spot simultaneously.
 *
 * @param {LogootID|null} leftId  - the ID to the left (null = document start)
 * @param {LogootID|null} rightId - the ID to the right (null = document end)
 * @param {string} siteId
 * @param {number} clock
 * @returns {LogootID}
 */
function generateIDBetween(leftId, rightId, siteId, clock) {
  // Boundary positions: 0 = start of document, 1 = end of document
  const leftPos = leftId ? leftId.position : 0;
  const rightPos = rightId ? rightId.position : 1;

  // Midpoint between neighbours
  let newPos = (leftPos + rightPos) / 2;

  // Add tiny random jitter in the range (-gap/4, +gap/4)
  // This dramatically reduces the chance two concurrent inserts get the same position
  // even after midpoint calculation
  const gap = rightPos - leftPos;
  const jitter = (Math.random() - 0.5) * (gap / 4);
  newPos += jitter;

  // Clamp strictly inside (leftPos, rightPos) to preserve ordering guarantee
  newPos = Math.max(leftPos + Number.EPSILON, Math.min(rightPos - Number.EPSILON, newPos));

  return new LogootID(newPos, siteId, clock);
}

module.exports = { LogootID, generateIDBetween };

