const crypto = require('crypto');

class ConsistentHashRing {
  /**
   * @param {Array<string>} nodes - Initial physical database shard names / connection keys
   * @param {number} vnodesPerNode - Number of virtual nodes per physical node (for uniform distribution)
   */
  constructor(nodes = [], vnodesPerNode = 100) {
    this.vnodesPerNode = vnodesPerNode;
    this.ring = {};      // Map of hash -> physical node name
    this.sortedKeys = []; // Sorted list of VNode hashes for binary searching
    
    nodes.forEach(node => this.addNode(node));
  }

  /**
   * Helper to hash strings to 32-bit unsigned integers
   * @param {string} str 
   * @returns {number}
   */
  _hash(str) {
    const md5 = crypto.createHash('md5').update(str).digest('hex');
    // Take first 8 characters of hex MD5 to form a 32-bit integer
    return parseInt(md5.substring(0, 8), 16);
  }

  /**
   * Adds a physical database shard node onto the ring.
   * @param {string} node 
   */
  addNode(node) {
    for (let i = 0; i < this.vnodesPerNode; i++) {
      const vnodeKey = `${node}#${i}`;
      const hash = this._hash(vnodeKey);
      this.ring[hash] = node;
      this.sortedKeys.push(hash);
    }
    this.sortedKeys.sort((a, b) => a - b);
    console.log(`[Hash Ring] Added physical node "${node}" with ${this.vnodesPerNode} VNodes.`);
  }

  /**
   * Removes a physical database shard node from the ring.
   * @param {string} node 
   */
  removeNode(node) {
    for (let i = 0; i < this.vnodesPerNode; i++) {
      const vnodeKey = `${node}#${i}`;
      const hash = this._hash(vnodeKey);
      delete this.ring[hash];
    }
    this.sortedKeys = this.sortedKeys.filter(hash => this.ring[hash] !== undefined);
    console.log(`[Hash Ring] Removed physical node "${node}" and its VNodes.`);
  }

  /**
   * Finds the closest physical database shard node clockwise on the ring for a given key.
   * @param {string} key - User ID or username
   * @returns {string} Target physical shard node name
   */
  getNode(key) {
    if (this.sortedKeys.length === 0) {
      return null;
    }

    const hash = this._hash(key);
    
    // Binary search for the first VNode hash >= key hash
    let low = 0;
    let high = this.sortedKeys.length - 1;
    let index = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.sortedKeys[mid] >= hash) {
        index = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    // Wrap around to 0 if the key hash is greater than all VNode hashes on the ring
    const targetHash = this.sortedKeys[index];
    return this.ring[targetHash];
  }
}

module.exports = ConsistentHashRing;
