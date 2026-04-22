#!/usr/bin/env node
// generate-favicons.js — rasterise app-icon-ink.svg → favicon pack
//
// Run:  npm run favicons
// Deps: npm install --save-dev sharp png-to-ico
//
// Output to frontend/public/logo/:
//   favicon-16.png  favicon-32.png  favicon-64.png
//   favicon-96.png  favicon-180.png favicon-192.png  favicon-512.png
//   favicon.ico  (16+32+48 multi-resolution)

const path = require('path');
const fs   = require('fs');
const sharp    = require('sharp');
const pngToIco = require('png-to-ico');

const SRC  = path.resolve(__dirname, '../public/logo/app-icon-ink.svg');
const DEST = path.resolve(__dirname, '../public/logo');

const SIZES = [16, 32, 48, 64, 96, 180, 192, 512];

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Source SVG not found: ${SRC}`);
    process.exit(1);
  }

  console.log('Generating PNG favicons from', path.basename(SRC));

  for (const size of SIZES) {
    const out = path.join(DEST, `favicon-${size}.png`);
    await sharp(SRC)
      .resize(size, size)
      .png()
      .toFile(out);
    console.log(`  ${size}×${size} → ${path.basename(out)}`);
  }

  // Generate multi-resolution .ico (16 + 32 + 48)
  const icoSources = [16, 32, 48].map(s => path.join(DEST, `favicon-${s}.png`));
  const icoOut     = path.join(DEST, 'favicon.ico');
  const icoBuf     = await pngToIco(icoSources);
  fs.writeFileSync(icoOut, icoBuf);
  console.log(`  ICO (16+32+48) → favicon.ico`);

  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
