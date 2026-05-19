import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');
const lines = content.split('\n');

const startIndex = 1840;
const endIndex = 2347;

const chunk = lines.slice(startIndex, endIndex + 1);

// the chunk currently ends with "  </motion.div>;" because of prettier formatting an expression as a statement.
// We should remove the trailing ";" from the last line (actually line 2347)
if (chunk[chunk.length - 1].trim().endsWith(';')) {
    chunk[chunk.length - 1] = chunk[chunk.length - 1].replace(';', '');
}

// We need to wrap it in a react check or just a fragment since it returns JSX, but wait, it should only render when currentScreen === 'editor'. So we do:
chunk.unshift('      {currentScreen === "editor" && (');
chunk.push('      )}');

// Find the return of App
let insertIndex = -1;
for (let i = startIndex; i < lines.length; i++) {
   if (lines[i] === '  return (' && lines[i+1]?.includes('min-h-screen bg-[#121212]')) {
      // Find the Dynamic Render...
      for(let j = i; j < i + 20; j++) {
         if (lines[j]?.includes('currentScreen === "home" ? renderHome() : renderEditor()')) {
             insertIndex = j + 1; // insert right below this line
             break;
         }
      }
      break;
   }
}

if (insertIndex > -1) {
    const newLines = [
        ...lines.slice(0, startIndex),
        ...lines.slice(endIndex + 1, insertIndex),
        ...chunk,
        ...lines.slice(insertIndex)
    ];
    fs.writeFileSync('src/App.tsx', newLines.join('\n'));
    console.log('Fixed floating action menu position!');
} else {
    console.log('Failed to find insert point.');
}
