// Build: inline the scripts into a single page.
//   node build.mjs          → dist/index.html (artifact fragment) + index.html (full page for GitHub Pages)
//   node build.mjs --local <three.min.js>  → also dist/local.html with three inlined, for offline testing
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const page = readFileSync('src/page.html', 'utf8');
const esc = (js) => js.replace(/<\/script/gi, '<\\/script');
const inline = (name) => `<script>\n${esc(readFileSync(`src/${name}.js`, 'utf8'))}\n</script>`;
let out = page.replace('<!--@aero-->', () => inline('aero')).replace('<!--@objects-->', () => inline('objects')).replace('<!--@app-->', () => inline('app'));
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', out);
const full = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="color-scheme" content="light dark">\n</head>\n<body>\n${out}\n</body>\n</html>\n`;
writeFileSync('index.html', full);
const li = process.argv.indexOf('--local');
if (li > 0) {
  const three = esc(readFileSync(process.argv[li + 1], 'utf8'));
  const local = full.replace(/<script src="https:\/\/cdnjs[^"]+three[^"]+"><\/script>/, () => `<script>\n${three}\n</script>`);
  writeFileSync('dist/local.html', local);
}
console.log('built dist/index.html, index.html' + (li > 0 ? ', dist/local.html' : ''));
