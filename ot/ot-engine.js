/**
 * ot-engine.js — Core Operational Transformation Engine
 * ======================================================
 *
 * WHAT IS OPERATIONAL TRANSFORMATION?
 * ------------------------------------
 * OT is an algorithm for maintaining consistency in collaborative editors.
 * When two users edit a shared document simultaneously, their changes can
 * "conflict". OT resolves conflicts by TRANSFORMING each operation to account
 * for the operations that happened concurrently.
 *
 * THE CORE IDEA:
 * - Every edit is an "Operation" (insert or delete at a position)
 * - When the server receives concurrent ops, it TRANSFORMS them against each other
 * - Transformation adjusts the position so the intent of the original edit is preserved
 *
 * EXAMPLE:
 *   Document: "Hello"
 *   Client A: Insert "X" at position 2  → "HeXllo"
 *   Client B: Insert "Y" at position 2  → "HeYllo"  (concurrent, not aware of A's op)
 *
 *   If we apply A then B naively: "HeXllo" → insert Y at position 2 → "HeYXllo" ❌ WRONG
 *   OT transforms B's op: since A inserted before position 2, B's position shifts to 3
 *   Result: "HeXllo" → insert Y at position 3 → "HeXYllo" ✅ CORRECT
 */

/**
 * Operation class — represents a single text edit
 *
 * Types:
 *   "insert" — add characters at a position
 *   "delete" — remove characters starting at a position
 */
class Operation {
  /**
   * @param {string} type         - "insert" or "delete"
   * @param {number} position     - character index in the document string
   * @param {string} chars        - the text being inserted or deleted
   * @param {string} clientId     - unique ID of the client that created this op
   * @param {number} clientVersion - the document version the client had when creating this op
   */
  constructor(type, position, chars, clientId, clientVersion) {
    this.type = type;
    this.position = position;
    this.chars = chars;
    this.clientId = clientId;
    this.clientVersion = clientVersion; // used by server to know which ops to transform against
  }
}

/**
 * transformOp(opToTransform, appliedOp)
 * -------------------------------------
 * This is the HEART of OT. It answers the question:
 * "Given that 'appliedOp' was already applied to the document,
 *  how do I adjust 'opToTransform' so it still has the same INTENT?"
 *
 * There are 4 combinations to handle:
 *   1. insert vs insert
 *   2. insert vs delete
 *   3. delete vs insert
 *   4. delete vs delete
 *
 * @param {Operation} opToTransform - the op we need to adjust
 * @param {Operation} appliedOp     - the op that was already applied
 * @returns {Operation} a new (possibly adjusted) operation
 */
function transformOp(opToTransform, appliedOp) {
  // Clone the operation so we don't mutate the original
  const transformed = new Operation(
    opToTransform.type,
    opToTransform.position,
    opToTransform.chars,
    opToTransform.clientId,
    opToTransform.clientVersion
  );

  // ─── CASE 1: Insert vs Insert ───────────────────────────────────────────────
  if (opToTransform.type === 'insert' && appliedOp.type === 'insert') {
    /**
     * If appliedOp inserted BEFORE or AT our position, our position shifts right.
     * If appliedOp inserted AFTER our position, no change needed.
     *
     * Tie-breaking: if both inserts are at the SAME position, we use clientId
     * to decide ordering. Lower clientId wins (goes first). This ensures
     * BOTH clients end up with the same document order — deterministic!
     */
    if (appliedOp.position < opToTransform.position) {
      // appliedOp inserted before us → we shift right by the length of inserted text
      transformed.position += appliedOp.chars.length;
    } else if (appliedOp.position === opToTransform.position) {
      // Same position! Use clientId as tie-breaker for deterministic ordering
      if (appliedOp.clientId < opToTransform.clientId) {
        // appliedOp "wins" this position — our op shifts right
        transformed.position += appliedOp.chars.length;
      }
      // else: our op keeps its position (we "win")
    }
    // appliedOp.position > opToTransform.position → no change needed
  }

  // ─── CASE 2: Insert vs Delete ───────────────────────────────────────────────
  else if (opToTransform.type === 'insert' && appliedOp.type === 'delete') {
    /**
     * appliedOp deleted some text. If the deletion happened BEFORE our insert
     * position, our position shifts left by the number of deleted characters.
     * If the deletion happened AT or AFTER our position, no change needed.
     */
    if (appliedOp.position < opToTransform.position) {
      // How many characters of the deletion fall before our position?
      const deletedBeforeUs = Math.min(
        appliedOp.chars.length,
        opToTransform.position - appliedOp.position
      );
      transformed.position -= deletedBeforeUs;
    }
    // appliedOp.position >= opToTransform.position → no change
  }

  // ─── CASE 3: Delete vs Insert ───────────────────────────────────────────────
  else if (opToTransform.type === 'delete' && appliedOp.type === 'insert') {
    /**
     * appliedOp inserted text. If insertion happened BEFORE our delete position,
     * our delete position shifts right. If AT or AFTER, no change.
     */
    if (appliedOp.position <= opToTransform.position) {
      // Insertion happened before or at our deletion point → shift right
      transformed.position += appliedOp.chars.length;
    }
    // appliedOp.position > opToTransform.position → no change
  }

  // ─── CASE 4: Delete vs Delete ───────────────────────────────────────────────
  else if (opToTransform.type === 'delete' && appliedOp.type === 'delete') {
    /**
     * Both ops delete text. Several sub-cases:
     * a) appliedOp deleted entirely before our range → shift our position left
     * b) appliedOp overlaps our deletion range → reduce what we need to delete
     * c) appliedOp deleted entirely after our range → no change
     */
    const appliedEnd = appliedOp.position + appliedOp.chars.length;
    const ourEnd = opToTransform.position + opToTransform.chars.length;

    if (appliedEnd <= opToTransform.position) {
      // Case a: appliedOp was entirely before us
      transformed.position -= appliedOp.chars.length;
    } else if (appliedOp.position >= ourEnd) {
      // Case c: appliedOp was entirely after us — no change
    } else {
      // Case b: Overlap. We need to figure out what's left to delete.
      // The overlap region was already deleted by appliedOp.

      // Characters before the overlap (still need to delete)
      const beforeOverlap = Math.max(0, appliedOp.position - opToTransform.position);
      // Characters after the overlap (still need to delete)
      const afterOverlap = Math.max(0, ourEnd - appliedEnd);

      // New chars to delete = non-overlapping portions
      // We reconstruct based on what's left
      const newChars = opToTransform.chars.substring(0, beforeOverlap) +
                       opToTransform.chars.substring(opToTransform.chars.length - afterOverlap);

      transformed.chars = newChars;
      // Position: if appliedOp started before us, our new position shifts left
      if (appliedOp.position < opToTransform.position) {
        transformed.position = appliedOp.position;
      }
    }
  }

  return transformed;
}

/**
 * applyOp(content, op)
 * --------------------
 * Apply an operation to a string, returning the new string.
 * This is straightforward — OT's complexity is in transformOp(), not here.
 *
 * @param {string} content - the current document text
 * @param {Operation} op   - the operation to apply
 * @returns {string} new document text
 */
function applyOp(content, op) {
  if (op.type === 'insert') {
    // Insert chars at the given position
    return content.slice(0, op.position) + op.chars + content.slice(op.position);
  } else if (op.type === 'delete') {
    // Delete chars starting at position (up to the length of op.chars)
    const deleteLength = op.chars.length;
    // Guard against out-of-bounds deletions (can happen in edge cases)
    const safePos = Math.min(op.position, content.length);
    return content.slice(0, safePos) + content.slice(safePos + deleteLength);
  }
  return content; // unknown op type — no change
}

module.exports = { Operation, transformOp, applyOp };

