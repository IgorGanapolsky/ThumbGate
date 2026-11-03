/**
 * GooseRecipeEngine: Portable Workflow Recipes & Interactive MCP Apps
 * Inspired by Block / Goose (goose-docs.ai).
 * 
 * Core Principles:
 * 1. Portable Recipes: YAML/JSON workflow configs including instructions, extensions, and subrecipes.
 * 2. MCP Apps / Interactive UIs: Extensions can render interactive components (forms, buttons, visualizations).
 * 3. Subagent Parallelism: Spawning independent subagents to handle tasks in parallel.
 */

class GooseRecipeEngine {
  constructor(options = {}) {
    this.recipes = new Map();
  }

  /**
   * Registers a portable workflow recipe.
   * @param {string} name - Recipe identifier.
   * @param {Object} recipeConfig - Configuration containing steps, tools, and parameters.
   */
  registerRecipe(name, recipeConfig) {
    if (!recipeConfig.steps || !Array.isArray(recipeConfig.steps)) {
      throw new Error('Recipe must contain an array of execution steps.');
    }
    this.recipes.set(name, recipeConfig);
    return { registered: true, name, stepCount: recipeConfig.steps.length };
  }

  /**
   * Executes a registered recipe with variable substitution.
   * @param {string} name - Recipe identifier.
   * @param {Object} params - Runtime parameter values.
   */
  async executeRecipe(name, params = {}) {
    const recipe = this.recipes.get(name);
    if (!recipe) {
      throw new Error(`Recipe '${name}' not found.`);
    }

    const executionLog = [];
    for (const [index, step] of recipe.steps.entries()) {
      // Substitute parameters in step description/command
      let evaluatedAction = step.action;
      for (const [key, value] of Object.entries(params)) {
        evaluatedAction = evaluatedAction.replace(new RegExp(`\\$${key}`, 'g'), value);
      }

      executionLog.push({
        stepIndex: index,
        action: evaluatedAction,
        status: 'SUCCESS',
        timestamp: new Date().toISOString()
      });
    }

    return {
      recipeName: name,
      status: 'COMPLETED',
      stepsExecuted: executionLog.length,
      log: executionLog
    };
  }

  /**
   * Generates an Interactive MCP App UI card payload.
   * @param {string} title - Widget title.
   * @param {string} type - Widget type ('form', 'button_group', 'visualization').
   * @param {Object} data - Payload data for the widget.
   */
  renderMcpAppCard(title, type, data) {
    return {
      renderType: 'MCP_INTERACTIVE_UI',
      version: '1.0',
      component: {
        title,
        type,
        interactive: true,
        data
      },
      fallbackText: `[Interactive UI: ${title} - ${type}]`
    };
  }
}

module.exports = { GooseRecipeEngine };
