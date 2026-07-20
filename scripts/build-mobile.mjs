import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const files = [
  'index.html',
  'style.css',
  'premium-theme.css',
  'experience.css',
  'member-plans.css',
  'progress.css',
  'script.js',
  'experience.js',
  'member-plans.js',
  'progress.js',
  'qrcode.js',
  'supabase-config.js',
  'supabase.min.js',
  'manifest.webmanifest',
  'pexels-arturo-eg-22214041-6628962.jpg',
  'pexels-warrecreates-32233887.jpg',
  'assets',
  'icons'
];

await rm('www', { recursive: true, force: true });
await mkdir('www', { recursive: true });

for (const source of files) {
  if (!existsSync(source)) throw new Error(`Missing mobile asset: ${source}`);
  await cp(source, `www/${source}`, { recursive: true });
}

console.log('Mobile web assets prepared in www/.');
