/**
 * Every package the frontend source, and the repo-root database/ and scripts/,
 * import is declared in the root package.json. Without that, an import can
 * resolve only because the backend workspace (or another package) happens to
 * install the package at the top of node_modules, and it breaks the build when
 * that changes.
 */
import fs from 'fs'
import { builtinModules } from 'module'
import path from 'path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = path.join(__dirname, '..', '..')
const SOURCE = ['app', 'components', 'lib', 'hooks', 'types', 'middleware.ts', 'database', 'scripts']
const SKIP_DIRS = new Set(['node_modules', '.next'])

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const declared = new Set(
  Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies })
)
const builtins = new Set(builtinModules)

function sourceFiles(entry: string): string[] {
  if (!fs.existsSync(entry)) return []
  if (fs.statSync(entry).isFile()) return [entry]
  return fs.readdirSync(entry, { withFileTypes: true }).flatMap((child) => {
    const full = path.join(entry, child.name)
    if (child.isDirectory()) return SKIP_DIRS.has(child.name) ? [] : sourceFiles(full)
    return /\.(ts|tsx|js|jsx|mjs)$/.test(child.name) && !child.name.endsWith('.d.ts') ? [full] : []
  })
}

/** The package a bare specifier names, or null for relative, aliased (@/) and built-in imports. */
function packageOf(specifier: string): string | null {
  if (/^(\.|\/|@\/|node:)/.test(specifier)) return null
  const parts = specifier.split('/')
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  return builtins.has(name) ? null : name
}

describe('frontend imports', () => {
  it('every imported package is declared in the root package.json', () => {
    const files = SOURCE.flatMap((entry) => sourceFiles(path.join(ROOT, entry)))
    expect(files.length).toBeGreaterThan(100)

    const undeclared = files.flatMap((file) =>
      ts
        .preProcessFile(fs.readFileSync(file, 'utf8'), true, true)
        .importedFiles.map(({ fileName }) => packageOf(fileName))
        .filter((name): name is string => name !== null && !declared.has(name))
        .map((name) => `${path.relative(ROOT, file)}: ${name}`)
    )

    expect(undeclared).toEqual([])
  })

  it('reads package names from specifiers', () => {
    expect(packageOf('next/navigation')).toBe('next')
    expect(packageOf('@tanstack/react-query')).toBe('@tanstack/react-query')
    expect(packageOf('@/lib/api')).toBeNull()
    expect(packageOf('./local')).toBeNull()
    expect(packageOf('fs')).toBeNull()
  })
})
