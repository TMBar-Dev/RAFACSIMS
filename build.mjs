import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve paths from this script, so running npm from another working directory
// cannot redirect the build cleanup or change where assets are read.
const root = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(root, 'build');
const entryPoint = 'Frontend/main.jsx';
const development = process.argv.includes('--dev');

// Restrict cleanup to the fixed output directory next to this script.
if (relative(root, outdir) !== 'build') throw new Error('Invalid build directory.');
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
// Copy only public files. The Worker, sources and configuration stay private.
for (const asset of ['favicon.ico', 'apple-touch-icon.png', 'app-icon-192.png', 'app-icon-512.png', 'manifest.json', 'robots.txt']) {
  await cp(resolve(root, 'Frontend', asset), resolve(outdir, asset));
}

await cp(resolve(root, 'Cloudflare', '_headers'), resolve(outdir, '_headers'));

function assetUrl(path) {
  // esbuild's metadata paths are relative to root. Published URLs are relative
  // to build/ and always use forward slashes, including when built on Windows.
  return '/' + relative(outdir, resolve(root, path)).split(sep).join('/');
}

const options = {
  absWorkingDir: root,
  entryPoints: [entryPoint],
  outdir,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome111', 'edge111', 'firefox114', 'safari16.4'],
  jsx: 'automatic',
  // React and Material UI select development/production behavior using this value.
  define: {
    'process.env.NODE_ENV': JSON.stringify(development ? 'development' : 'production'),
    // Workers Builds supplies the Git branch on every build, including rebuilds.
    __RAFACSIMS_PREVIEW__: JSON.stringify(process.env.WORKERS_CI_BRANCH === 'preview')
  },
  minify: !development,
  sourcemap: development,
  metafile: true,
  // Content hashes prevent browsers reusing old scripts, styles, images or fonts.
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
        // Read generated filenames instead of guessing hashes or hard-coding
        // bundle names. Imported CSS is emitted separately and linked here.
        const entry = Object.entries(result.metafile.outputs)
          .find(([path, info]) => path.endsWith('.js') && info.entryPoint && resolve(root, info.entryPoint) === resolve(root, entryPoint));
        if (!entry || !entry[1].cssBundle) throw new Error('Missing application JavaScript or CSS bundle.');
        const template = await readFile(resolve(root, 'Frontend', 'index.html'), 'utf8');
        const html = template
          .replace('<!-- APP_STYLES -->', `<link rel="stylesheet" href="${assetUrl(entry[1].cssBundle)}" />`)
          .replace('<!-- APP_SCRIPT -->', `<script type="module" src="${assetUrl(entry[0])}"></script>`);
        await writeFile(resolve(outdir, 'index.html'), html);
      });
    }
  }]
};

if (development) {
  // Frontend preview only: this does not emulate Worker routes or the D1 binding.
  const session = await context(options);
  await session.watch();
  const { port } = await session.serve({ servedir: outdir, host: '127.0.0.1', port: 5173, fallback: 'index.html' });
  console.log(`Frontend preview: http://127.0.0.1:${port} (API requires the Cloudflare Worker).`);
} else {
  await build(options);
}
