/**
 * The kernel's formatter settings.
 *
 * They match what `engine/**` and `test/core/**` already write by hand: no
 * semicolons, single quotes, no trailing commas, and no parentheses around a
 * single arrow parameter. The width is wide because the kernel keeps a whole
 * record on one line when it reads better.
 */
export default {
  semi: false,
  singleQuote: true,
  arrowParens: 'avoid',
  trailingComma: 'none',
  printWidth: 120,
  tabWidth: 2
}
