import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'packages/platform.json'), 'utf8'));

function exportsOf(file) {
  const src = readFileSync(join(root, file), 'utf8');
  const blocks = [...src.matchAll(/^  return \{([^}]*)\};?\s*$/gms)];
  const last = blocks[blocks.length - 1];
  if (!last) return [];
  return last[1].split(/[\n,]/).map(x => x.trim()).filter(x => /^[A-Za-z_]\w*$/.test(x));
}

const imports = [];
const seeds = [];
const blocks = [];
for (const p of manifest.packages) {
  imports.push(`import { ${p.define}${p.seed ? `, ${p.seed}` : ''} } from '${p.name}';`);
  if (p.seed) seeds.push(`  ${p.seed}(ctx as never);`);
  const names = p.files.flatMap(exportsOf);
  if (!names.length) throw new Error(`no exports found for ${p.name}`);
  blocks.push(`export const {\n${names.map(n => `  ${n},\n`).join('')}} = ${p.define}(spacetimedb);\n`);
}

const out = `${imports.join('\n')}
import spacetimedb from './schema';
import { gameInit } from './game/init';

function seedAll(ctx: unknown) {
${seeds.join('\n')}
}

export const init = spacetimedb.init(ctx => {
  seedAll(ctx);
  gameInit(ctx);
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  seedAll(ctx);
});

${blocks.join('\n')}`;
writeFileSync(join(root, 'games/template/spacetimedb/src/platform.ts'), out);

const tables = `${manifest.packages.map(p => `import { ${p.tables}, ${p.env} } from '${p.name}';`).join('\n')}

export const platformTables = { ${manifest.packages.map(p => `...${p.tables}`).join(', ')} };
export const platformEnv = { ${manifest.packages.map(p => `...${p.env}`).join(', ')} };
`;
writeFileSync(join(root, 'games/template/spacetimedb/src/platform-tables.ts'), tables);
console.log(manifest.packages.map(p => p.name).join(', '));
