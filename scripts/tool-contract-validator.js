'use strict';

/**
 * Tool Contract Validator
 *
 * A dependency-free JSON Schema subset for tool arguments and structured
 * outputs. The validator intentionally fails closed for unsupported schema
 * shapes used at an agent boundary instead of silently accepting them.
 */

const FORMAT_CHECKS = Object.freeze({
  'date-time': (value) => !Number.isNaN(Date.parse(value)) && /T/.test(value),
  email: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  uri: (value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  },
});

function validateToolContract(schema, args) {
  if (!schema) return { valid: true, errors: [] };
  const errors = [];
  validateValue(schema, args, '', errors);
  return { valid: errors.length === 0, errors };
}

function validateStructuredOutput(output, schema) {
  let value = output;
  if (typeof output === 'string') {
    try {
      value = JSON.parse(output);
    } catch (err) {
      return {
        valid: false,
        errors: [`Structured output must be valid JSON: ${err.message}`],
        value: null,
      };
    }
  }
  const result = validateToolContract(schema, value);
  return { ...result, value };
}

function validateValue(schema, value, path, errors) {
  if (schema === true || !schema) return;
  if (schema === false) {
    errors.push(`${label(path)} is disallowed by schema`);
    return;
  }

  if (schema.const !== undefined && !deepEqual(value, schema.const)) {
    errors.push(`${label(path)} must equal ${display(schema.const)} (got ${display(value)})`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => deepEqual(entry, value))) {
    if (path && schema.type === 'string') {
      errors.push(`Parameter '${path}' must be one of [${schema.enum.join(', ')}] (got '${value}')`);
    } else {
      errors.push(`${label(path)} must be one of [${schema.enum.map(display).join(', ')}] (got ${display(value)})`);
    }
  }

  validateCombinators(schema, value, path, errors);

  if (value === undefined) return;
  const allowedTypes = normalizeTypes(schema.type);
  if (allowedTypes.length > 0 && !allowedTypes.some((type) => matchesType(type, value))) {
    errors.push(typeError(path, allowedTypes, value));
    return;
  }

  if (value === null) return;
  const actualType = jsonType(value);
  if (actualType === 'object') validateObject(schema, value, path, errors);
  if (actualType === 'array') validateArray(schema, value, path, errors);
  if (actualType === 'string') validateString(schema, value, path, errors);
  if (actualType === 'number' || actualType === 'integer') validateNumber(schema, value, path, errors);
}

function validateCombinators(schema, value, path, errors) {
  if (Array.isArray(schema.allOf)) {
    for (const child of schema.allOf) validateValue(child, value, path, errors);
  }
  if (Array.isArray(schema.anyOf)) {
    const matches = schema.anyOf.filter((child) => validateChild(child, value).valid).length;
    if (matches === 0) errors.push(`${label(path)} must match at least one anyOf schema`);
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((child) => validateChild(child, value).valid).length;
    if (matches !== 1) errors.push(`${label(path)} must match exactly one oneOf schema (matched ${matches})`);
  }
  if (schema.not && validateChild(schema.not, value).valid) {
    errors.push(`${label(path)} matches a forbidden schema`);
  }
}

function validateChild(schema, value) {
  const errors = [];
  validateValue(schema, value, '', errors);
  return { valid: errors.length === 0, errors };
}

function validateObject(schema, value, path, errors) {
  const keys = Object.keys(value);
  if (Number.isFinite(schema.minProperties) && keys.length < schema.minProperties) {
    errors.push(`${label(path)} must have at least ${schema.minProperties} properties`);
  }
  if (Number.isFinite(schema.maxProperties) && keys.length > schema.maxProperties) {
    errors.push(`${label(path)} must have at most ${schema.maxProperties} properties`);
  }

  for (const required of schema.required || []) {
    if (value[required] === undefined || value[required] === null || value[required] === '') {
      const requiredPath = joinPath(path, required);
      errors.push(path
        ? `Parameter '${path}': Missing required parameter: '${required}'`
        : `Missing required parameter: '${required}'`);
      if (path && requiredPath === path) break;
    }
  }

  const properties = schema.properties || {};
  for (const [key, childSchema] of Object.entries(properties)) {
    if (value[key] === undefined) continue;
    validateValue(childSchema, value[key], joinPath(path, key), errors);
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(properties, key)) continue;
    if (schema.additionalProperties === false) {
      errors.push(`Unexpected parameter: '${joinPath(path, key)}'`);
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      validateValue(schema.additionalProperties, value[key], joinPath(path, key), errors);
    }
  }
}

function validateArray(schema, value, path, errors) {
  if (Number.isFinite(schema.minItems) && value.length < schema.minItems) {
    errors.push(`${label(path)} must contain at least ${schema.minItems} items`);
  }
  if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) {
    errors.push(`${label(path)} must contain at most ${schema.maxItems} items`);
  }
  if (schema.uniqueItems === true) {
    const serialized = value.map(stableStringify);
    if (new Set(serialized).size !== serialized.length) {
      errors.push(`${label(path)} must contain unique items`);
    }
  }
  if (schema.items) {
    value.forEach((entry, index) => validateValue(schema.items, entry, `${path}[${index}]`, errors));
  }
}

function validateString(schema, value, path, errors) {
  if (Number.isFinite(schema.minLength) && value.length < schema.minLength) {
    errors.push(`${label(path)} must contain at least ${schema.minLength} characters`);
  }
  if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) {
    errors.push(`${label(path)} must contain at most ${schema.maxLength} characters`);
  }
  if (schema.pattern) {
    let regex;
    try {
      regex = new RegExp(schema.pattern);
    } catch {
      errors.push(`${label(path)} uses invalid schema pattern '${schema.pattern}'`);
      return;
    }
    if (!regex.test(value)) errors.push(`${label(path)} must match pattern ${schema.pattern}`);
  }
  if (schema.format && FORMAT_CHECKS[schema.format] && !FORMAT_CHECKS[schema.format](value)) {
    errors.push(`${label(path)} must match format ${schema.format}`);
  }
}

function validateNumber(schema, value, path, errors) {
  if (Number.isFinite(schema.minimum) && value < schema.minimum) {
    errors.push(`${label(path)} must be >= ${schema.minimum}`);
  }
  if (Number.isFinite(schema.maximum) && value > schema.maximum) {
    errors.push(`${label(path)} must be <= ${schema.maximum}`);
  }
  if (Number.isFinite(schema.exclusiveMinimum) && value <= schema.exclusiveMinimum) {
    errors.push(`${label(path)} must be > ${schema.exclusiveMinimum}`);
  }
  if (Number.isFinite(schema.exclusiveMaximum) && value >= schema.exclusiveMaximum) {
    errors.push(`${label(path)} must be < ${schema.exclusiveMaximum}`);
  }
  if (Number.isFinite(schema.multipleOf) && !isMultipleOf(value, schema.multipleOf)) {
    errors.push(`${label(path)} must be a multiple of ${schema.multipleOf}`);
  }
}

function normalizeTypes(type) {
  if (!type) return [];
  return Array.isArray(type) ? type : [type];
}

function matchesType(type, value) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  if (typeof value === 'number') return 'number';
  return typeof value;
}

function typeError(path, types, value) {
  const expected = types.length === 1 ? types[0] : types.join(' or ');
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (!path) return `Expected ${expected}, got ${actual}`;
  return `Parameter '${path}' must be ${article(expected)} ${expected} (got ${actual})`;
}

function article(value) {
  return /^[aeiou]/i.test(value) ? 'an' : 'a';
}

function label(path) {
  return path ? `Parameter '${path}'` : 'Value';
}

function joinPath(parent, child) {
  return parent ? `${parent}.${child}` : child;
}

function display(value) {
  if (typeof value === 'string') return `'${value}'`;
  return stableStringify(value);
}

function stableStringify(value) {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function deepEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}

function isMultipleOf(value, multiple) {
  const quotient = value / multiple;
  return Math.abs(quotient - Math.round(quotient)) < Number.EPSILON * 10;
}

module.exports = {
  validateStructuredOutput,
  validateToolContract,
};
