// One-time utility: pulls the FB Construction logo out of the sibling
// deckbuilder project (embedded there as a base64 JPEG) and saves it as a
// PNG for this project's docx/PDF generators to embed.
//
// PNG, not JPEG: the installed `docx` library (8.5.0) hardcodes a `.png`
// extension for every embedded image regardless of the actual bytes given
// to ImageRun (see generator/buildProposal.js). Handing it real JPEG bytes
// under a .png name produces a file Word flags as corrupted, so the source
// image is re-encoded to genuine PNG here, once, ahead of time.
//
// Usage: node scripts/extract-logo.js [pathToDeckbuilderIndexHtml] [--force]

const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const forceOverwrite = process.argv.includes('--force');
const sourceArg = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'));
const sourcePath = sourceArg
  ? path.resolve(sourceArg)
  : path.resolve(__dirname, '..', '..', 'deckbuilder', 'index.html');

const outputPath = path.resolve(__dirname, '..', 'assets', 'logo_rgb.png');

async function main() {
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

  const image = await Jimp.read(buffer);
  const pngBuffer = await image.getBuffer('image/png');

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, pngBuffer);

  console.log(`Wrote ${outputPath} (${pngBuffer.length} bytes, ${image.width}x${image.height})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
