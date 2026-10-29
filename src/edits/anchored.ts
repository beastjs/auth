const MARKER = 'beast-auth'

export const startMarker = (id: string) => `// ${MARKER}:${id} start`
export const endMarker = (id: string) => `// ${MARKER}:${id} end`

/**
 * A block of generated lines inside a file the app owns.
 *
 * Marker-wrapped rather than AST-rewritten, because idempotency is the hard
 * requirement here: a marked region is replaced byte for byte, so a second run
 * is a true no-op, adding a third console is a clean diff, and nothing else in
 * the file is reprinted. There is no formatter in these projects, so an AST
 * round-trip would quietly restyle whatever it touched.
 */
export type Block = {
  readonly id: string
  readonly lines: readonly string[]
  /** Indentation applied to every generated line. */
  readonly indent?: string
}

export const hasBlock = (source: string, id: string): boolean => source.includes(startMarker(id))

const blockPattern = (id: string) =>
  new RegExp(`[ \\t]*${startMarker(id).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}[\\s\\S]*?${endMarker(id).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`, 'm')

function renderBlock({ id, lines, indent = '' }: Block): string {
  return [`${indent}${startMarker(id)}`, ...lines.map((line) => (line.length === 0 ? '' : `${indent}${line}`)), `${indent}${endMarker(id)}`].join(
    '\n'
  )
}

/**
 * Replaces an existing block in place. Returns null when there is none.
 *
 * The indentation of the block already on disk wins over anything the caller
 * passes: re-rendering at a different depth would make every re-run report a
 * change, which is exactly what idempotency has to rule out.
 */
export function replaceBlock(source: string, block: Block): string | null {
  const pattern = blockPattern(block.id)
  const match = pattern.exec(source)
  if (match === null) return null

  const indent = /^[ \t]*/.exec(match[0])?.[0] ?? block.indent ?? ''

  return source.replace(pattern, renderBlock({ ...block, indent }))
}

/**
 * Inserts a block after the file's last top-level import.
 *
 * A file with no imports is not a failure — plenty of Workers have none — so the
 * block goes to the top, below any leading comment, where an import belongs.
 */
export function insertAfterLastImport(source: string, block: Block): string | null {
  const lines = source.split('\n')
  let lastImport = -1

  for (const [index, line] of lines.entries()) {
    // Only top-level imports: an indented `import(` is a dynamic one inside code.
    if (/^import\s/.test(line) || /^}\s*from\s/.test(line)) lastImport = index
  }

  if (lastImport === -1) {
    let top = 0
    while (top < lines.length && (lines[top]?.startsWith('//') === true || lines[top]?.trim() === '')) top += 1

    lines.splice(top, 0, renderBlock(block), '')

    return lines.join('\n')
  }

  lines.splice(lastImport + 1, 0, '', renderBlock(block))

  return lines.join('\n')
}

type Scan = { readonly open: number; readonly close: number }

/**
 * Finds the braces of the declaration a pattern matches.
 *
 * Walks the source rather than parsing it, skipping strings, template literals
 * and comments so a `{` inside any of them cannot be mistaken for the body. No
 * dependency, and the hard cases are testable on their own.
 */
export function findBracedBody(source: string, pattern: RegExp, openChar = '{', closeChar = '}'): Scan | null {
  const match = pattern.exec(source)
  if (match === null) return null

  const open = source.indexOf(openChar, match.index + match[0].length - 1)
  if (open === -1) return null

  let depth = 0
  let index = open

  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (char === '/' && next === '/') {
      const lineEnd = source.indexOf('\n', index)
      index = lineEnd === -1 ? source.length : lineEnd
      continue
    }

    if (char === '/' && next === '*') {
      const commentEnd = source.indexOf('*/', index)
      index = commentEnd === -1 ? source.length : commentEnd + 2
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      index = skipString(source, index)
      continue
    }

    if (char === openChar) depth += 1
    if (char === closeChar) {
      depth -= 1
      if (depth === 0) return { open, close: index }
    }

    index += 1
  }

  return null
}

/** Advances past a string or template literal, honouring escapes. */
function skipString(source: string, start: number): number {
  const quote = source[start]
  let index = start + 1

  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === quote) return index + 1
    index += 1
  }

  return index
}

/** Inserts a block at the top of the body a pattern names. */
export function insertAtTopOfBody(source: string, pattern: RegExp, block: Block): string | null {
  const scan = findBracedBody(source, pattern)
  if (scan === null) return null

  const lineStart = source.indexOf('\n', scan.open)
  if (lineStart === -1 || lineStart > scan.close) return null

  const indent = block.indent ?? detectIndent(source, lineStart + 1)

  return `${source.slice(0, lineStart + 1)}${renderBlock({ ...block, indent })}\n${source.slice(lineStart + 1)}`
}

/** Inserts a block just before the closing brace of the body a pattern names. */
export function insertAtEndOfBody(source: string, pattern: RegExp, block: Block): string | null {
  const scan = findBracedBody(source, pattern)
  if (scan === null) return null

  const lineStart = source.lastIndexOf('\n', scan.close) + 1
  const indent = block.indent ?? source.slice(lineStart, scan.close).match(/^[ \t]*/)?.[0].concat('  ') ?? '  '

  return `${source.slice(0, lineStart)}${renderBlock({ ...block, indent })}\n${source.slice(lineStart)}`
}

function detectIndent(source: string, from: number): string {
  const line = source.slice(from, source.indexOf('\n', from) === -1 ? undefined : source.indexOf('\n', from))
  return line.match(/^[ \t]*/)?.[0] ?? '  '
}

export type EditOutcome =
  | { readonly kind: 'written'; readonly contents: string }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'blocked'; readonly reason: string; readonly snippet: readonly string[] }

/**
 * Applies a block: replacing it if it is already there, inserting it otherwise.
 *
 * A file whose anchor cannot be found is reported as blocked with the lines to
 * paste, never guessed at. Mangling a file the user owns is worse than asking
 * them to add two lines.
 */
export function applyBlock(
  source: string,
  block: Block,
  insert: (source: string, block: Block) => string | null,
  blockedReason: string
): EditOutcome {
  const replaced = replaceBlock(source, block)
  if (replaced !== null) return replaced === source ? { kind: 'unchanged' } : { kind: 'written', contents: replaced }

  const inserted = insert(source, block)
  if (inserted === null) return { kind: 'blocked', reason: blockedReason, snippet: block.lines }

  return { kind: 'written', contents: inserted }
}
