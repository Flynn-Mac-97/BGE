/** The command schema subset supported by the engine's execution boundary. */
const SUPPORTED_KEYWORDS = [
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'minimum',
  'maximum',
  'pattern',
  'description'
]

/** Whether a value is the named JSON type. `object` means a plain object, not an array or null. */
const TYPE_MATCHES = {
  object: value => value !== null && typeof value === 'object' && !Array.isArray(value),
  array: value => Array.isArray(value),
  string: value => typeof value === 'string',
  number: value => typeof value === 'number' && Number.isFinite(value),
  integer: value => Number.isInteger(value),
  boolean: value => typeof value === 'boolean',
  null: value => value === null
}

function assertSupportedKeywords(schema, path) {
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.includes(key)) throw new Error(`${path}: unsupported schema keyword ${key}`)
  }
}

function assertEnum(schema, value, path) {
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}: expected one of ${schema.enum.join(', ')}`)
}

function assertPattern(schema, value, path) {
  if (schema.pattern === undefined) return
  if (typeof schema.pattern !== 'string') throw new Error(`${path}: schema pattern must be a string`)
  let pattern
  try {
    pattern = new RegExp(schema.pattern)
  } catch (error) {
    throw new Error(`${path}: invalid schema pattern ${JSON.stringify(schema.pattern)} (${error.message})`, {
      cause: error
    })
  }
  if (typeof value === 'string' && !pattern.test(value))
    throw new Error(`${path}: does not match pattern ${schema.pattern}`)
}

function assertRange(schema, value, path) {
  if (typeof value !== 'number') return
  const below = schema.minimum !== undefined && value < schema.minimum
  const above = schema.maximum !== undefined && value > schema.maximum
  if (below || above) throw new Error(`${path}: outside allowed range`)
}

function validateObjectMembers(schema, value, path) {
  for (const key of schema.required || []) {
    if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key}: required`)
  }
  for (const key of Object.keys(value)) {
    if (schema.properties?.[key]) validateCommandInput(schema.properties[key], value[key], `${path}.${key}`)
    else if (schema.additionalProperties === false) throw new Error(`${path}.${key}: unknown argument`)
  }
}

function validateArrayItems(schema, value, path) {
  if (schema.items) value.forEach((item, index) => validateCommandInput(schema.items, item, `${path}[${index}]`))
}

export function validateCommandInput(schema, value, path = 'args') {
  if (!schema) return
  assertSupportedKeywords(schema, path)
  if (schema.type && !TYPE_MATCHES[schema.type]?.(value)) throw new Error(`${path}: expected ${schema.type}`)
  assertEnum(schema, value, path)
  assertPattern(schema, value, path)
  assertRange(schema, value, path)
  if (schema.type === 'object') validateObjectMembers(schema, value, path)
  if (schema.type === 'array') validateArrayItems(schema, value, path)
}
