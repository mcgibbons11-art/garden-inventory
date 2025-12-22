/**
 * Garden Tycoon Inventory System for Portals
 * Handles plants, seeds, tools, and decorations with Portals SDK messaging
 * 
 * Requires: Portals SDK (https://portals-labs.github.io/portals-sdk/portalssdk.js)
 */

class InventorySystem {
  constructor(options = {}) {
    this.maxSlots = options.maxSlots || 50;
    this.inventory = new Map();
    this.taskPrefix = options.taskPrefix || 'inventory';
    this.debug = options.debug || false;
    
    // Check if Portals SDK is loaded
    if (typeof PortalsSdk === 'undefined') {
      console.error('PortalsSdk not found! Make sure to include the Portals SDK script.');
    }
    
    // Auto-save to localStorage for persistence
    this.autoSave = options.autoSave !== false;
    this.storageKey = options.storageKey || 'garden-inventory';
    
    // Load saved inventory
    if (this.autoSave) {
      this.loadInventory();
    }
    
    this.log('Inventory system initialized with', this.inventory.size, 'items');
  }

  /**
   * Send a task state update to Unity via Portals SDK
   * @param {string} taskName - The task identifier
   * @param {string} taskTargetState - The target state (e.g., 'SetActiveToCompleted')
   */
  sendTaskUpdate(taskName, taskTargetState) {
    if (typeof PortalsSdk === 'undefined') {
      this.log('PortalsSdk not available, skipping task update');
      return;
    }

    const message = {
      TaskName: taskName,
      TaskTargetState: taskTargetState
    };

    try {
      PortalsSdk.sendMessageToUnity(JSON.stringify(message));
      this.log('Sent task update:', taskName, '->', taskTargetState);
    } catch (error) {
      console.error('Failed to send task update:', error);
    }
  }

  /**
   * Helper to create task names for inventory events
   */
  getTaskName(action, itemId = '') {
    return `${this.taskPrefix}_${action}${itemId ? '_' + itemId : ''}`;
  }

  /**
   * Save inventory to localStorage
   */
  saveInventory() {
    if (!this.autoSave) return;
    
    try {
      const data = this.exportData();
      localStorage.setItem(this.storageKey, JSON.stringify(data));
      this.log('Inventory saved to localStorage');
    } catch (error) {
      console.error('Failed to save inventory:', error);
    }
  }

  /**
   * Load inventory from localStorage
   */
  loadInventory() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) {
        const data = JSON.parse(saved);
        this.importData(data);
        this.log('Inventory loaded from localStorage');
      }
    } catch (error) {
      console.error('Failed to load inventory:', error);
    }
  }

  /**
   * Add an item to the inventory
   */
  addItem(item, quantity = 1) {
    // Validate item structure
    if (!item.id || !item.name || !item.type) {
      throw new Error('Invalid item: must have id, name, and type');
    }

    // Check if inventory has space
    if (this.inventory.size >= this.maxSlots && !this.inventory.has(item.id)) {
      this.log('Inventory full!');
      // Notify Unity that inventory is full
      this.sendTaskUpdate(
        this.getTaskName('full'),
        'SetNotActiveToActive'
      );
      throw new Error('Inventory is full');
    }

    // Check if item already exists
    if (this.inventory.has(item.id)) {
      const existingItem = this.inventory.get(item.id);
      existingItem.quantity = (existingItem.quantity || 0) + quantity;
      existingItem.lastModified = Date.now();
      
      this.log(`Updated ${existingItem.name}: +${quantity} (total: ${existingItem.quantity})`);
      
      // Notify Unity that item was updated
      this.sendTaskUpdate(
        this.getTaskName('item_updated', item.id),
        'SetNotActiveToActive'
      );
      
      this.saveInventory();
      return existingItem;
    } else {
      // Add new item
      const newItem = {
        ...item,
        quantity,
        addedAt: Date.now(),
        lastModified: Date.now()
      };
      
      this.inventory.set(item.id, newItem);
      
      this.log(`Added ${newItem.name} x${quantity}`);
      
      // Notify Unity that item was added
      this.sendTaskUpdate(
        this.getTaskName('item_added', item.id),
        'SetNotActiveToCompleted'
      );
      
      this.saveInventory();
      return newItem;
    }
  }

  /**
   * Remove an item from inventory
   */
  removeItem(itemId, quantity = null) {
    if (!this.inventory.has(itemId)) {
      throw new Error(`Item ${itemId} not found in inventory`);
    }

    const item = this.inventory.get(itemId);
    
    // Remove all if quantity is null
    if (quantity === null || quantity >= item.quantity) {
      this.inventory.delete(itemId);
      
      this.log(`Removed all ${item.name}`);
      
      this.sendTaskUpdate(
        this.getTaskName('item_removed', itemId),
        'SetActiveToCompleted'
      );
      
      this.saveInventory();
      return { removed: true, quantity: item.quantity };
    } else {
      // Remove partial quantity
      item.quantity -= quantity;
      item.lastModified = Date.now();
      
      this.log(`Removed ${quantity} ${item.name} (${item.quantity} remaining)`);
      
      this.sendTaskUpdate(
        this.getTaskName('item_updated', itemId),
        'SetActiveToActive'
      );
      
      this.saveInventory();
      return { removed: false, quantity, remaining: item.quantity };
    }
  }

  /**
   * Get a specific item
   */
  getItem(itemId) {
    return this.inventory.get(itemId) || null;
  }

  /**
   * Update item properties
   */
  updateItem(itemId, updates) {
    if (!this.inventory.has(itemId)) {
      throw new Error(`Item ${itemId} not found in inventory`);
    }

    const item = this.inventory.get(itemId);
    Object.assign(item, updates, { lastModified: Date.now() });
    
    this.log(`Updated ${item.name}`);
    
    this.sendTaskUpdate(
      this.getTaskName('item_updated', itemId),
      'SetActiveToActive'
    );
    
    this.saveInventory();
    return item;
  }

  /**
   * Get entire inventory
   */
  getInventory() {
    return {
      items: Array.from(this.inventory.values()),
      count: this.inventory.size,
      maxSlots: this.maxSlots,
      emptySlots: this.maxSlots - this.inventory.size
    };
  }

  /**
   * Get items by category
   */
  getItemsByCategory(category) {
    return Array.from(this.inventory.values()).filter(
      item => item.category === category || item.type === category
    );
  }

  /**
   * Use/consume an item
   */
  useItem(itemId, quantity = 1) {
    if (!this.inventory.has(itemId)) {
      throw new Error(`Item ${itemId} not found in inventory`);
    }

    const item = this.inventory.get(itemId);
    
    if (item.quantity < quantity) {
      throw new Error(`Insufficient quantity of ${item.name}`);
    }

    // Check if item is consumable
    if (!item.consumable && item.type !== 'seed' && item.type !== 'fertilizer') {
      throw new Error(`Item ${item.name} is not consumable`);
    }

    this.removeItem(itemId, quantity);
    
    this.log(`Used ${quantity} ${item.name}`);
    
    this.sendTaskUpdate(
      this.getTaskName('item_used', itemId),
      'SetActiveToCompleted'
    );

    return { success: true, itemId, quantity };
  }

  /**
   * Transfer item to another entity (e.g., garden plot, storage, trade)
   */
  transferItem(itemId, quantity, targetId) {
    const item = this.getItem(itemId);
    
    if (!item) {
      throw new Error(`Item ${itemId} not found in inventory`);
    }

    if (item.quantity < quantity) {
      throw new Error(`Insufficient quantity of ${item.name}`);
    }

    this.removeItem(itemId, quantity);
    
    this.log(`Transferred ${quantity} ${item.name} to ${targetId}`);
    
    this.sendTaskUpdate(
      this.getTaskName('transfer', `${itemId}_to_${targetId}`),
      'SetActiveToCompleted'
    );

    return { success: true, itemId, quantity, targetId };
  }

  /**
   * Clear entire inventory
   */
  clearInventory() {
    const itemCount = this.inventory.size;
    this.inventory.clear();
    
    this.log(`Cleared ${itemCount} items from inventory`);
    
    this.sendTaskUpdate(
      this.getTaskName('cleared'),
      'SetActiveToCompleted'
    );
    
    this.saveInventory();
    return { cleared: itemCount };
  }

  /**
   * Export inventory data
   */
  exportData() {
    return {
      items: Array.from(this.inventory.entries()).map(([id, item]) => ({
        id,
        ...item
      })),
      metadata: {
        exportedAt: Date.now(),
        maxSlots: this.maxSlots,
        itemCount: this.inventory.size
      }
    };
  }

  /**
   * Import inventory data
   */
  importData(data) {
    if (!data.items || !Array.isArray(data.items)) {
      throw new Error('Invalid import data');
    }

    this.inventory.clear();
    
    data.items.forEach(item => {
      this.inventory.set(item.id, item);
    });

    this.sendToParent('INVENTORY_IMPORTED', {
      itemCount: this.inventory.size
    });

    return { imported: this.inventory.size };
  }

  /**
   * Logging helper
   */
  log(...args) {
    if (this.debug) {
      console.log('[InventorySystem]', ...args);
    }
  }
}

// Garden-specific item types and helpers
class GardenInventory extends InventorySystem {
  constructor(options = {}) {
    super(options);
    
    // Garden-specific categories
    this.categories = {
      SEEDS: 'seeds',
      PLANTS: 'plants',
      TOOLS: 'tools',
      FERTILIZER: 'fertilizer',
      DECORATIONS: 'decorations',
      RESOURCES: 'resources'
    };

    // Register garden-specific handlers
    this.registerGardenHandlers();
  }

  registerGardenHandlers() {
    this.on('PLANT_SEED', (payload) => this.plantSeed(payload));
    this.on('HARVEST_PLANT', (payload) => this.harvestPlant(payload));
    this.on('UPGRADE_TOOL', (payload) => this.upgradeTool(payload));
    this.on('CRAFT_ITEM', (payload) => this.craftItem(payload));
  }

  /**
   * Plant a seed in a garden plot
   */
  plantSeed(payload) {
    const { seedId, plotId } = payload;
    
    const seed = this.getItem(seedId);
    if (!seed || seed.type !== this.categories.SEEDS) {
      throw new Error('Invalid seed');
    }

    this.useItem(seedId, 1);
    
    this.log(`Planted ${seed.name} in plot ${plotId}`);
    
    this.sendTaskUpdate(
      this.getTaskName('seed_planted', `${seedId}_${plotId}`),
      'SetNotActiveToCompleted'
    );

    return { 
      success: true, 
      plotId, 
      seedType: seed.plantType,
      growthTime: seed.growthTime 
    };
  }

  /**
   * Harvest a plant and add produce to inventory
   */
  harvestPlant(payload) {
    const { plotId, produce } = payload;
    
    // Add harvested produce to inventory
    this.addItem(produce.item, produce.quantity);
    
    this.log(`Harvested ${produce.quantity} ${produce.item.name} from plot ${plotId}`);
    
    this.sendTaskUpdate(
      this.getTaskName('plant_harvested', plotId),
      'SetActiveToCompleted'
    );

    return { success: true, plotId, produce };
  }

  /**
   * Upgrade a tool
   */
  upgradeTool(payload) {
    const { toolId, upgradeMaterials } = payload;
    
    const tool = this.getItem(toolId);
    if (!tool || tool.type !== this.categories.TOOLS) {
      throw new Error('Invalid tool');
    }

    // Check if player has upgrade materials
    for (const material of upgradeMaterials) {
      const hasItem = this.getItem(material.id);
      if (!hasItem || hasItem.quantity < material.quantity) {
        throw new Error(`Insufficient ${material.name}`);
      }
    }

    // Consume upgrade materials
    upgradeMaterials.forEach(material => {
      this.removeItem(material.id, material.quantity);
    });

    // Upgrade tool
    tool.level = (tool.level || 1) + 1;
    tool.efficiency = (tool.efficiency || 1) * 1.2;
    tool.lastModified = Date.now();

    this.log(`Upgraded ${tool.name} to level ${tool.level}`);
    
    this.sendTaskUpdate(
      this.getTaskName('tool_upgraded', toolId),
      'SetActiveToCompleted'
    );

    this.saveInventory();
    return { success: true, tool };
  }

  /**
   * Craft an item using resources
   */
  craftItem(payload) {
    const { recipe, quantity = 1 } = payload;
    
    // Check if player has required materials
    for (const material of recipe.materials) {
      const hasItem = this.getItem(material.id);
      if (!hasItem || hasItem.quantity < (material.quantity * quantity)) {
        throw new Error(`Insufficient ${material.name}`);
      }
    }

    // Consume materials
    recipe.materials.forEach(material => {
      this.removeItem(material.id, material.quantity * quantity);
    });

    // Add crafted item
    this.addItem(recipe.result, quantity);

    this.log(`Crafted ${quantity}x ${recipe.result.name}`);
    
    this.sendTaskUpdate(
      this.getTaskName('item_crafted', recipe.result.id),
      'SetNotActiveToCompleted'
    );

    return { success: true, crafted: recipe.result, quantity };
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { InventorySystem, GardenInventory };
}
