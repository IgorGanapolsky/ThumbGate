'use strict';

/**
 * Tool Contract Validator
 * Validates tool arguments against the tool's inputSchema.
 */
function validateToolContract(schema, args) {
  const errors = [];
  if (!schema) return { valid: true, errors };

  if (schema.type === 'object') {
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      errors.push(`Expected object, got ${args === null ? 'null' : Array.isArray(args) ? 'array' : typeof args}`);
      return { valid: false, errors };
    }

    // Check required fields
    if (Array.isArray(schema.required)) {
      for (const req of schema.required) {
        if (args[req] === undefined || args[req] === null || args[req] === '') {
          errors.push(`Missing required parameter: '${req}'`);
        }
      }
    }

    // Check properties
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        const value = args[key];
        if (value === undefined || value === null) continue; // Optional field not provided

        const valType = typeof value;
        if (propSchema.type === 'string') {
          if (valType !== 'string') {
            errors.push(`Parameter '${key}' must be a string (got ${valType})`);
          } else if (Array.isArray(propSchema.enum)) {
            if (!propSchema.enum.includes(value)) {
              errors.push(`Parameter '${key}' must be one of [${propSchema.enum.join(', ')}] (got '${value}')`);
            }
          }
        } else if (propSchema.type === 'number') {
          if (valType !== 'number' || isNaN(value)) {
            errors.push(`Parameter '${key}' must be a number (got ${valType})`);
          }
        } else if (propSchema.type === 'boolean') {
          if (valType !== 'boolean') {
            errors.push(`Parameter '${key}' must be a boolean (got ${valType})`);
          }
        } else if (propSchema.type === 'array') {
          if (!Array.isArray(value)) {
            errors.push(`Parameter '${key}' must be an array (got ${valType})`);
          }
        } else if (propSchema.type === 'object') {
          if (valType !== 'object' || value === null || Array.isArray(value)) {
            errors.push(`Parameter '${key}' must be an object (got ${valType})`);
          } else {
            // Recurse for nested objects
            const subRes = validateToolContract(propSchema, value);
            if (!subRes.valid) {
              for (const err of subRes.errors) {
                errors.push(`Parameter '${key}': ${err}`);
              }
            }
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = { validateToolContract };
