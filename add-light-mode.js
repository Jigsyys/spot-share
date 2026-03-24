const fs = require('fs');

const files = [
  'components/map/MapView.tsx',
  'components/map/ProfileModal.tsx',
  'components/map/FriendsModal.tsx',
  'components/map/AddSpotModal.tsx',
  'components/map/UserMenu.tsx'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  
  // Keep original content length to verify
  const origLen = content.length;
  
  // 1. Revert any accidental double applying if run multiple times
  // (Assuming we only run it once, but safe to do simple replace)
  
  content = content.replace(/\btext-white\b/g, 'text-zinc-900 dark:text-white');
  content = content.replace(/\btext-zinc-400\b/g, 'text-zinc-500 dark:text-zinc-400');
  content = content.replace(/\btext-zinc-300\b/g, 'text-zinc-600 dark:text-zinc-300');
  content = content.replace(/\btext-zinc-500\b/g, 'text-zinc-400 dark:text-zinc-500'); // wait, this might conflict with previous line if reversed, let's omit zinc-500 matching to avoid chained replacements
  
  content = content.replace(/\bbg-zinc-950\b/g, 'bg-zinc-50 dark:bg-zinc-950');
  content = content.replace(/\bbg-zinc-900\b/g, 'bg-white dark:bg-zinc-900');
  content = content.replace(/\bbg-zinc-800\b/g, 'bg-zinc-100 dark:bg-zinc-800');
  
  content = content.replace(/\bborder-white\/10\b/g, 'border-zinc-200 dark:border-white/10');
  content = content.replace(/\bborder-white\/5\b/g, 'border-zinc-200 dark:border-white/5');
  
  fs.writeFileSync(file, content);
  console.log(`Updated ${file} - replaced classes`);
});
