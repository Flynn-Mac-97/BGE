/** The command schema subset supported by the engine's execution boundary. */
export function validateCommandInput(schema, value, path = 'args') {
  if (!schema) return
  const supported = ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'description']
  for (const key of Object.keys(schema)) if (!supported.includes(key)) throw new Error(`${path}: unsupported schema keyword ${key}`)
  const matches = { object: value !== null && typeof value === 'object' && !Array.isArray(value), array: Array.isArray(value), string: typeof value === 'string', number: typeof value === 'number' && Number.isFinite(value), integer: Number.isInteger(value), boolean: typeof value === 'boolean', null: value === null }
  if (schema.type && !matches[schema.type]) throw new Error(`${path}: expected ${schema.type}`)
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}: expected one of ${schema.enum.join(', ')}`)
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) throw new Error(`${path}: outside allowed range`)
  if (schema.type === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key}: required`)
    for (const key of Object.keys(value)) {
      if (schema.properties?.[key]) validateCommandInput(schema.properties[key], value[key], `${path}.${key}`)
      else if (schema.additionalProperties === false) throw new Error(`${path}.${key}: unknown argument`)
    }
  }
  if (schema.type === 'array' && schema.items) value.forEach((item, index) => validateCommandInput(schema.items, item, `${path}[${index}]`))
}
