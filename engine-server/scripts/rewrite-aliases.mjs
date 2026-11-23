import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));

if (!fs.existsSync(outDir)) {
  console.error(`[rewrite-aliases] Output directory does not exist: ${outDir}`);
  process.exit(1);
}

function walkFiles(dir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, results);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.js') ||
        entry.name.endsWith('.cjs') ||
        entry.name.endsWith('.mjs') ||
        entry.name.endsWith('.d.ts'))
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

function toRelativeImport(fromFile, aliasSpecifier, isDeclarationFile) {
  const subpath = aliasSpecifier.slice(2); // strip "@/"
  const targetAbs = path.resolve(outDir, subpath);

  if (!isDeclarationFile) {
    const hasFile = fs.existsSync(`${targetAbs}.js`) || fs.existsSync(targetAbs);
    const hasIndex = fs.existsSync(path.join(targetAbs, 'index.js'));
    if (!hasFile && !hasIndex) {
      throw new Error(
        `[rewrite-aliases] Unresolvable alias "${aliasSpecifier}" referenced from "${path.relative(outDir, fromFile)}" (expected "${targetAbs}.js" or "${path.join(targetAbs, 'index.js')}")`
      );
    }
  }

  let rel = path.relative(path.dirname(fromFile), targetAbs).split(path.sep).join('/');
  if (!rel.startsWith('.')) {
    rel = `./${rel}`;
  }
  return rel;
}

const files = walkFiles(outDir);
let rewrittenFiles = 0;
let rewrittenImports = 0;

for (const filePath of files) {
  const isDts = filePath.endsWith('.d.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  let next = source;
  if (isDts) {
    next = next.replace(/(\bfrom\s+|import\s*\(\s*)(['"])(@\/[^'"]+)\2/g, (full, prefix, quote, spec) => {
      changed = true;
      rewrittenImports += 1;
      return `${prefix}${quote}${toRelativeImport(filePath, spec, true)}${quote}`;
    });
  } else {
    next = next.replace(/(\brequire\s*\(\s*|\bimport\s*\(\s*)(['"])(@\/[^'"]+)\2(\s*\))/g, (full, prefix, quote, spec, suffix) => {
      changed = true;
      rewrittenImports += 1;
      return `${prefix}${quote}${toRelativeImport(filePath, spec, false)}${quote}${suffix}`;
    });
  }

  if (changed) {
    fs.writeFileSync(filePath, next, 'utf8');
    rewrittenFiles += 1;
  }
}

console.log(`[rewrite-aliases] Rewrote ${rewrittenImports} @/ specifier(s) across ${rewrittenFiles} file(s) in ${outDir}`);
