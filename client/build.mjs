import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(root, 'build');
const development = process.argv.includes('--dev');

// Restrict cleanup to the fixed output directory next to this script.
if (relative(root, outdir) !== 'build') throw new Error('Invalid build directory.');
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await cp(resolve(root, 'public'), outdir, { recursive: true });

function assetUrl(path) {
  return '/' + relative(outdir, resolve(root, path)).split(sep).join('/');
}

const options = {
  absWorkingDir: root,
  entryPoints: ['src/main.jsx'],
  outdir,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome111', 'edge111', 'firefox114', 'safari16.4'],
  jsx: 'transform',
  define: { 'process.env.NODE_ENV': JSON.stringify(development ? 'development' : 'production') },
  minify: !development,
  sourcemap: development,
  metafile: true,
  entryNames: 'assets/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  publicPath: '/',
  loader: { '.jpg': 'file', '.png': 'file', '.svg': 'file', '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
  logLevel: 'info',
  plugins: [{
    name: 'html-entry',
    setup(builder) {
      builder.onEnd(async result => {
        if (result.errors.length) return;
        const entry = Object.entries(result.metafile.outputs)
          .find(([path, info]) => path.endsWith('.js') && info.entryPoint === 'src/main.jsx');
        if (!entry || !entry[1].cssBundle) throw new Error('Missing application JavaScript or CSS bundle.');
        const template = await readFile(resolve(root, 'index.html'), 'utf8');
        const html = template
          .replace('<!-- APP_STYLES -->', `<link rel="stylesheet" href="${assetUrl(entry[1].cssBundle)}" />`)
          .replace('<!-- APP_SCRIPT -->', `<script type="module" src="${assetUrl(entry[0])}"></script>`);
        await writeFile(resolve(outdir, 'index.html'), html);
      });
    }
  }]
};

if (development) {
  const session = await context(options);
  await session.watch();
  const { port } = await session.serve({ servedir: outdir, host: '127.0.0.1', port: 5173, fallback: 'index.html' });
  console.log(`Frontend preview: http://127.0.0.1:${port} (API requires the Cloudflare Worker).`);
} else {
  await build(options);
}
