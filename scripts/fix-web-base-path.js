// Rewrites Expo's absolute asset paths (e.g. "/favicon.ico") to relative ones
// so the exported web build works when served from a GitHub Pages project
// subpath like https://<user>.github.io/<repo>/ instead of the domain root.
const fs = require('node:fs');
const path = require('node:path');

const distDir = path.join(__dirname, '..', 'dist');
const indexPath = path.join(distDir, 'index.html');

const html = fs.readFileSync(indexPath, 'utf8');
const fixed = html.replace(/(href|src)="\//g, '$1="./');
fs.writeFileSync(indexPath, fixed);

// GitHub Pages runs Jekyll by default, which ignores files/folders starting
// with an underscore (like Expo's "_expo/" bundle folder) unless this is present.
fs.writeFileSync(path.join(distDir, '.nojekyll'), '');

console.log('Fixed web base paths and added .nojekyll for GitHub Pages.');
