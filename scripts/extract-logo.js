// One-time utility: pulls the FB Construction logo out of the sibling
// deckbuilder project (embedded there as a base64 JPEG) and saves it as a
// real .jpg file for this project's docx/PDF generators to embed.
//
// Usage: node scripts/extract-logo.js [pathToDeckbuilderIndexHtml] [--force]

const fs = require('fs');
const path = require('path');

const forceOverwrite = process.argv.includes('--force');
const sourceArg = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'));
const sourcePath = sourceArg
  ? path.resolve(sourceArg)
  : path.resolve(__dirname, '..', '..', 'deckbuilder', 'index.html');

const outputPath = path.resolve(__dirname, '..', 'assets', 'logo_rgb.jpg');

function main() {
  if (!fs.existsSync(sourcePath)) {
    console.error(`Source file not found: ${sourcePath}`);
    process.exit(1);
  }

  if (fs.existsSync(outputPath) && !forceOverwrite) {
    console.error(`${outputPath} already exists. Re-run with --force to overwrite.`);
    process.exit(1);
  }

  const html = fs.readFileSync(sourcePath, 'utf8');

  const logoAreaMatch = html.match(/<div class="logo-area"[^>]*>[\s\S]*?<\/div>/);
  const searchScope = logoAreaMatch ? logoAreaMatch[0] : html;

  const imgMatch = searchScope.match(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/);
  if (!imgMatch) {
    console.error('Could not find an embedded base64 JPEG in the logo-area of the source file.');
    process.exit(1);
  }

  const buffer = Buffer.from(imgMatch[1], 'base64');

  if (buffer.length < 100 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    console.error('Decoded data does not look like a valid JPEG (bad SOI marker).');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);

  console.log(`Wrote ${outputPath} (${buffer.length} bytes)`);
}

main();
