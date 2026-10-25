/**
 * Every package the backend imports is declared in backend/package.json.
 * A package that is only installed because something else depends on it can
 * disappear from the lockfile when that something changes, and the import
 * then fails at start-up. Type-checking does not catch it if @types for the
 * package are still installed.
 *
 * Runtime files (backend/src outside tests, backend/scripts) may import only
 * `dependencies`, since production installs with --omit=dev. Test files may
 * also import `devDependencies`.
 */
import fs from 'fs';
import { builtinModules } from 'module';
import path from 'path';
import ts from 'typescript';

const BACKEND_ROOT = path.join(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8'));
const runtimeDeclared = new Set(Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }));
const testDeclared = new Set([...runtimeDeclared, ...Object.keys(manifest.devDependencies ?? {})]);
const builtins = new Set(builtinModules);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|js)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

const isTestFile = (file: string) => file.split(path.sep).includes('__tests__') || /\.test\.ts$/.test(file);

/** The package a bare specifier names ('@scope/pkg/sub' -> '@scope/pkg', 'pkg/sub' -> 'pkg'), or null for relative paths and built-ins. */
function packageOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return null;
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return builtins.has(name) ? null : name;
}

/** Packages `file` imports (import, export from, require, dynamic import) that its kind of file may not use. */
function undeclaredImports(file: string): string[] {
  const allowed = isTestFile(file) ? testDeclared : runtimeDeclared;
  const { importedFiles } = ts.preProcessFile(fs.readFileSync(file, 'utf8'), true, true);
  return importedFiles
    .map(({ fileName }) => packageOf(fileName))
    .filter((name): name is string => name !== null && !allowed.has(name))
    .map((name) => `${path.relative(BACKEND_ROOT, file)}: ${name}`);
}

describe('backend imports', () => {
  it('every imported package is declared in backend/package.json for that kind of file', () => {
    const files = [...sourceFiles(path.join(BACKEND_ROOT, 'src')), ...sourceFiles(path.join(BACKEND_ROOT, 'scripts'))];
    expect(files.length).toBeGreaterThan(100);

    expect(files.flatMap(undeclaredImports)).toEqual([]);
  });

  it('reads package names from specifiers', () => {
    expect(packageOf('express')).toBe('express');
    expect(packageOf('@aws-sdk/client-sts')).toBe('@aws-sdk/client-sts');
    expect(packageOf('jspdf-autotable/dist/x')).toBe('jspdf-autotable');
    expect(packageOf('@scope/pkg/sub/path')).toBe('@scope/pkg');
    expect(packageOf('./local')).toBeNull();
    expect(packageOf('../up')).toBeNull();
    expect(packageOf('crypto')).toBeNull();
    expect(packageOf('fs/promises')).toBeNull();
    expect(packageOf('node:path')).toBeNull();
  });
});
