import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');
const lines = content.split('\n');

// the chunk is inside {currentScreen === "editor" && ( ... )} but it's currently invalid.
// Let's just find {currentScreen === "editor" && ( and add `<>` and `</>`
let errorIndex1 = -1;
let errorIndex2 = -1;

for (let i = 0; i < lines.length; i++) {
   if (lines[i] === '      {currentScreen === "editor" && (') {
      errorIndex1 = i;
   }
   // it ends when we find `      )}` shortly after `</motion.div>`
   if (errorIndex1 !== -1 && lines[i] === '      )}' && lines[i-1]?.includes('</motion.div>')) {
      errorIndex2 = i;
      break;
   }
}

if (errorIndex1 > -1 && errorIndex2 > -1) {
    lines.splice(errorIndex1 + 1, 0, '      <>');
    // adjust errorIndex2 because we inserted 1 element
    lines.splice(errorIndex2 + 1, 0, '      </>');
    fs.writeFileSync('src/App.tsx', lines.join('\n'));
    console.log('Fixed syntax!');
} else {
    console.log('Failed to find it.', errorIndex1, errorIndex2);
}
