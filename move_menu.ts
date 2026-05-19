import fs from 'fs';

const content = fs.readFileSync('src/App.tsx', 'utf-8');
const lines = content.split('\n');

// Find the Floating Action Menu start and end
let startIndex = -1;
let endIndex = -1;
let timelineSpaceStart = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('Floating Action Menu attached to bottom or overlay')) {
    startIndex = i;
  }
  if (lines[i].includes(' Timeline Content Flex Container ')) {
    endIndex = i;
  }
  if (lines[i].includes('Empty state instruction inside timeline')) {
    timelineSpaceStart = i; // this is near the end of timeline space
  }
}

const menuLines = lines.slice(startIndex, endIndex);

// Now we need to remove menuLines from their original position
const newLines = [
  ...lines.slice(0, startIndex),
  ...lines.slice(endIndex)
];

// Re-find the end of renderEditor in the new lines array
let renderEditorEndIndex = -1;
for (let i = newLines.length - 1; i >= 0; i--) {
  if (newLines[i] === '  const renderEditor = () => (') {
    // find the end of this renderEditor
    break;
  }
}

// Another safer way to find the end of renderEditor: 
// Search for "  );" just before "  return (" which is main App return
let insertIndex = -1;
for (let i = 0; i < newLines.length; i++) {
  if (newLines[i] === '  return (' && newLines[i+1]?.includes('min-h-screen bg-[#121212]')) {
    // The previous line should be ");", and the line before that should be "  </div>"
    insertIndex = i - 1; 
  }
}

if (startIndex > -1 && endIndex > -1 && insertIndex > -1) {
    const finalLines = [
        ...newLines.slice(0, insertIndex),
        ...menuLines,
        ...newLines.slice(insertIndex)
    ];
    fs.writeFileSync('src/App.tsx', finalLines.join('\n'));
    console.log('Successfully moved the floating action menu!');
} else {
    console.log('Failed:', {startIndex, endIndex, insertIndex});
}
