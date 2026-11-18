// Gera os ícones do PWA (PNG) a partir de um SVG desenhado aqui mesmo.
// Uso: node scripts/make-icon.mjs
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'client', 'public');

const pip = (cx, cy, r = 17) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#20303a"/>`;

// Metade superior: 6 pontos (2 colunas × 3 linhas)
const topPips = [136, 176, 216].flatMap((y) => [216, 296].map((x) => pip(x, y)));
// Metade inferior: 3 pontos em diagonal
const bottomPips = [[216, 300], [256, 340], [296, 380]].map(([x, y]) => pip(x, y));

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="felt" cx="50%" cy="38%" r="78%">
      <stop offset="0" stop-color="#139366"/>
      <stop offset="0.58" stop-color="#0a5a3d"/>
      <stop offset="1" stop-color="#052718"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fbeaa8"/>
      <stop offset="0.5" stop-color="#f2c14e"/>
      <stop offset="1" stop-color="#d99f22"/>
    </linearGradient>
    <linearGradient id="ivory" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.55" stop-color="#fdfbf3"/>
      <stop offset="1" stop-color="#e9e2cf"/>
    </linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000000" flood-opacity="0.45"/>
    </filter>
  </defs>

  <!-- fundo arredondado -->
  <rect width="512" height="512" rx="104" fill="url(#felt)"/>

  <!-- moldura dourada -->
  <rect x="20" y="20" width="472" height="472" rx="88" fill="none"
        stroke="url(#gold)" stroke-width="16"/>

  <!-- peça de dominó -->
  <g transform="rotate(-9 256 256)" filter="url(#shadow)">
    <rect x="174" y="88" width="164" height="336" rx="26"
          fill="url(#ivory)" stroke="#cfc7b0" stroke-width="6"/>
    <line x1="182" y1="256" x2="330" y2="256" stroke="#c9c2ad" stroke-width="7"/>
    ${topPips.join('\n    ')}
    ${bottomPips.join('\n    ')}
  </g>
</svg>`;

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];

for (const { file, size } of targets) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, file));
  console.log(`✅ ${file} (${size}×${size})`);
}
