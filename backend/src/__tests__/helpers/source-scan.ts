/**
 * Source lines for static scans, with comments blanked out and everything
 * else kept, line for line. The file is parsed with the TypeScript compiler,
 * so a comment is only what the language says is one: code that follows a
 * block comment on the same line is kept, and "//" or "/*" inside a string,
 * template or regular expression is not a comment.
 */
import fs from 'fs';
import ts from 'typescript';

/** `source` with every comment character replaced by a space (newlines kept). */
export function withoutComments(source: string): string {
  const file = ts.createSourceFile('scan.ts', source, ts.ScriptTarget.Latest, true);
  const keep = new Uint8Array(source.length);
  const visit = (node: ts.Node): void => {
    // JSDoc is attached to nodes as children, but it is a comment.
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(file);
    if (children.length === 0) {
      keep.fill(1, node.getStart(file), node.getEnd());
      return;
    }
    children.forEach(visit);
  };
  visit(file);
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    out += keep[i] || source[i] === '\n' || source[i] === '\r' ? source[i] : ' ';
  }
  return out;
}

/** The code lines of `source` (comments removed), numbered from 1, blank lines left out. */
export function codeLinesOf(source: string): Array<{ line: number; text: string }> {
  return withoutComments(source)
    .split('\n')
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => text.trim() !== '');
}

export function codeLines(file: string): Array<{ line: number; text: string }> {
  return codeLinesOf(fs.readFileSync(file, 'utf-8'));
}

/** Fixture for the scans' self-tests: which of these lines a scan must and must not see. */
export const COMMENT_FIXTURE = {
  source: [
    "/* note */ fetch('https://a.example/1');",
    "// fetch('https://a.example/2');",
    "/** fetch('https://a.example/3') */",
    '/*',
    " * fetch('https://a.example/4');",
    ' */',
    "const url = 'https://a.example/5'; // fetch('https://a.example/6')",
    "const pattern = /\\/\\//; fetch('https://a.example/7');",
    "const text = `/* ${fetch('https://a.example/8')} */`;",
  ].join('\n'),
  /** Lines (1-based) a scan for fetch( must find. */
  calls: [1, 8, 9],
};
