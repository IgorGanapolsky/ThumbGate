/**
 * RigTypeSafeAgentEngine: Modular, Type-Safe Agent & Tool Abstraction
 * Inspired by Rig (rig.rs).
 * 
 * Core Principles:
 * 1. Type-Safe Tool Contracts: Explicit argument schemas and validation before execution.
 * 2. Portable Model Abstraction: Unified API across providers with pluggable agent loops.
 * 3. Manager-Worker Delegation: Agents-as-tools for hierarchical task execution.
 */

class RigTypeSafeAgentEngine {
  constructor(options = {}) {
    this.tools = new Map();
    this.subAgents = new Map();
  }

  /**
   * Registers a type-safe tool with an explicit schema.
   * @param {string} name - Tool name.
   * @param {Object} schema - Expected argument types/properties.
   * @param {Function} handler - Execution function.
   */
  registerTool(name, schema, handler) {
    this.tools.set(name, { schema, handler });
    return { registered: true, toolName: name };
  }

  /**
   * Executes a tool with strict type-safety validation against its schema.
   * @param {string} name - Tool name.
   * @param {Object} args - Provided arguments.
   */
  async executeTool(name, args) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not registered.`);
    }

    // Validate required fields in schema
    for (const [field, expectedType] of Object.entries(tool.schema)) {
      if (args[field] === undefined) {
        throw new Error(`Type-safety validation failed: Missing required field '${field}' for tool '${name}'.`);
      }
      const actualType = typeof args[field];
      if (actualType !== expectedType) {
        throw new Error(`Type-safety validation failed: Field '${field}' expected type '${expectedType}', got '${actualType}'.`);
      }
    }

    return await tool.handler(args);
  }

  /**
   * Turns an agent into a tool (Rig Manager-Worker pattern).
   * @param {string} agentName - Sub-agent identifier.
   * @param {string} description - Agent capability description.
   * @param {Function} agentRunner - Execution function for the sub-agent.
   */
  registerAgentAsTool(agentName, description, agentRunner) {
    this.subAgents.set(agentName, { description, agentRunner });
    return { agentToolRegistered: true, agentName };
  }

  /**
   * Delegates a prompt to a registered sub-agent.
   */
  async invokeAgentTool(agentName, prompt) {
    const agent = this.subAgents.get(agentName);
    if (!agent) {
      throw new Error(`Sub-agent '${agentName}' not found.`);
    }
    return await agent.agentRunner(prompt);
  }
}

module.exports = { RigTypeSafeAgentEngine };
