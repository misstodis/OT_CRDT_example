/**
 * ot-document.js — Server-Side OT Document Manager
 * ==================================================
 *
 * WHY DOES THE SERVER NEED TO DO WORK IN OT?
 * -------------------------------------------
 * In OT, the server is the "source of truth". It:
 *   1. Receives operations from clients
 *   2. Transforms incoming ops against any ops it received AFTER the client's version
 *   3. Applies the transformed op to the server's document
 *   4. Broadcasts the transformed op to all other clients
 *
 * This is the KEY DIFFERENCE between OT and CRDT:
 *   OT  → SERVER is intelligent, does transformation work
 *   CRDT → SERVER can be a dumb relay; clients handle merging
 *
 * VERSION NUMBERS EXPLAINED:
 * --------------------------
 * Every time the server applies an op, it increments serverVersion.
 * When a client sends an op, it includes its "clientVersion" — the version
 * number it had when it CREATED the op.
 *
 * If serverVersion = 5 and clientVersion = 3, it means:
 *   "Ops 3, 4 have been applied server-side that this client doesn't know about."
 *   → We must transform our incoming op against ops [3, 4] before applying it.
 */

const { transformOp, applyOp, Operation } = require('./ot-engine');

class OTDocument {
  constructor() {
    this.content = '';           // the authoritative text of the document
    this.serverVersion = 0;      // incremented on each accepted operation
    this.history = [];           // array of all applied Operation objects (in order)
  }

  /**
   * receiveOp(op)
   * -------------
   * The main OT server algorithm. Transforms and applies an incoming op.
   *
   * @param {Operation} op - the operation received from a client
   * @returns {Operation} the fully-transformed op (to broadcast to others)
   */
  receiveOp(op) {
    /**
     * STEP 1: Find the "concurrent" operations
     * -----------------------------------------
     * Any op in history with index >= op.clientVersion was applied AFTER
     * the client created this op. These are the "concurrent" ops we must
     * transform against.
     *
     * Example:
     *   history = [op0, op1, op2, op3, op4]   serverVersion = 5
     *   incoming op has clientVersion = 3
     *   → concurrent ops are history[3] and history[4]
     *   → we transform the incoming op against op3 first, then op4
     */
    const concurrentOps = this.history.slice(op.clientVersion);

    /**
     * STEP 2: Transform the incoming op against each concurrent op
     * -------------------------------------------------------------
     * We do this in order — each transformation adjusts the position/chars
     * so the original INTENT of the op is preserved after all concurrent ops.
     */
    let transformedOp = op;
    for (const concurrentOp of concurrentOps) {
      transformedOp = transformOp(transformedOp, concurrentOp);
    }

    /**
     * STEP 3: Apply the transformed op to the document
     * -------------------------------------------------
     * Now that positions are adjusted, we can safely apply it.
     */
    this.content = applyOp(this.content, transformedOp);

    /**
     * STEP 4: Record the op and increment the version
     * ------------------------------------------------
     * Store the TRANSFORMED op in history (not the original).
     * This is important — other clients will transform against what was
     * actually applied, not what the client intended.
     */
    this.history.push(transformedOp);
    this.serverVersion++;

    // Return the transformed op so the server can broadcast it
    // The serverVersion embedded here tells clients what version this corresponds to
    transformedOp.serverVersion = this.serverVersion;
    return transformedOp;
  }

  /**
   * getState()
   * ----------
   * Returns a snapshot of the document — used when a new client connects
   * and needs to catch up to the current state.
   */
  getState() {
    return {
      content: this.content,
      version: this.serverVersion
    };
  }

  /**
   * reset()
   * -------
   * Clears the document — useful for testing.
   */
  reset() {
    this.content = '';
    this.serverVersion = 0;
    this.history = [];
  }
}

// Singleton: one shared document for all OT clients
const otDocument = new OTDocument();

module.exports = { OTDocument, otDocument };

