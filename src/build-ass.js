const ASS_HEADER = `[Script Info]
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
`;

const DEFAULT_COLORS = [
  '&H0037F3FF',
  '&H00FF8CCB',
  '&H0034A3FF',
  '&H0000C8FF',
  '&H0068FF6A',
  '&H00A784FF',
];

function sanitizeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .trim();
}

function getWordText(word) {
  return sanitizeText(word?.text ?? word?.word ?? '');
}

function toAssTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const centiseconds = Math.floor((safe - Math.floor(safe)) * 100);

  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function splitBySection(words, timingSplit) {
  const talkEnd = Number(timingSplit?.talking_avatar_end || 0);

  return words.map((word, index) => ({
    ...word,
    index: Number.isFinite(Number(word?.index)) ? Number(word.index) : index,
    section: Number(word.start) < talkEnd ? 'talking_avatar' : 'black_screen',
  }));
}

function createPhraseGroups(words, section) {
  const sectionWords = words.filter((word) => word.section === section && getWordText(word));
  const groups = [];
  let current = [];

  for (const word of sectionWords) {
    current.push(word);

    const combinedText = current.map((item) => getWordText(item)).join(' ');
    const hitPunctuation = /[.!?,]$/.test(getWordText(word));
    const hitSize = current.length >= (section === 'black_screen' ? 5 : 4);
    const hitLength = combinedText.length >= (section === 'black_screen' ? 28 : 20);

    if (hitPunctuation || hitSize || hitLength) {
      groups.push(current);
      current = [];
    }
  }

  if (current.length) {
    groups.push(current);
  }

  return groups;
}

function getSectionLayout(section) {
  if (section === 'black_screen') {
    return {
      anchorX: 180,
      anchorY: 760,
      maxCharsPerLine: 14,
      maxWordsPerLine: 3,
      baseFontSize: 82,
      activeFontSize: 132,
      border: 14,
    };
  }

  return {
    anchorX: 260,
    anchorY: 520,
    maxCharsPerLine: 12,
    maxWordsPerLine: 3,
    baseFontSize: 66,
    activeFontSize: 118,
    border: 12,
  };
}

function wrapWords(words, { maxCharsPerLine, maxWordsPerLine }) {
  const lines = [];
  let currentLine = [];
  let currentLength = 0;

  for (const word of words) {
    const text = getWordText(word);
    const projectedLength = currentLine.length === 0 ? text.length : currentLength + 1 + text.length;

    if (
      currentLine.length > 0
      && (currentLine.length >= maxWordsPerLine || projectedLength > maxCharsPerLine)
    ) {
      lines.push(currentLine);
      currentLine = [];
      currentLength = 0;
    }

    currentLine.push(word);
    currentLength = currentLine.length === 1 ? text.length : currentLength + 1 + text.length;
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

function buildLineText({ lineWords, activeWordIndex, groupIndex, lineIndex, layout }) {
  return lineWords.map((word, wordIndex) => {
    const text = getWordText(word).toUpperCase();
    const isActive = word.index === activeWordIndex;
    const color = DEFAULT_COLORS[(groupIndex + lineIndex + wordIndex) % DEFAULT_COLORS.length];
    const fontSize = isActive ? layout.activeFontSize : layout.baseFontSize;

    return `{\\fs${fontSize}\\bord${layout.border}\\shad0\\1c${color}}${text}`;
  }).join(' ');
}

function buildStateText({ words, activeWordIndex, groupIndex, section }) {
  const layout = getSectionLayout(section);
  const lines = wrapWords(words, layout);
  const blockOverride = `\\an7\\pos(${layout.anchorX},${layout.anchorY})`;
  const text = lines.map((lineWords, lineIndex) => buildLineText({
    lineWords,
    activeWordIndex,
    groupIndex,
    lineIndex,
    layout,
  })).join('\\N');

  return `{${blockOverride}}${text}`;
}

function buildDialogueLines(groups, section) {
  const lines = [];

  groups.forEach((group, groupIndex) => {
    const groupEnd = Number(group[group.length - 1]?.end || group[0]?.start || 0.4);
    const holdEnd = groupEnd + (section === 'black_screen' ? 0.28 : 0.18);

    group.forEach((word, wordIndex) => {
      const start = Number(word.start || 0);
      const nextStart = Number(group[wordIndex + 1]?.start || holdEnd);
      const end = Math.max(start + 0.08, nextStart);
      const stateWords = group.slice(0, wordIndex + 1);
      const stateText = buildStateText({
        words: stateWords,
        activeWordIndex: word.index,
        groupIndex,
        section,
      });

      lines.push(`Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Main,,0,0,0,,${stateText}`);
    });
  });

  return lines;
}

export function buildAssFromWords({
  timedWords,
  timingSplit,
  width = 1080,
  height = 1920,
  fontName = 'Arial Black',
}) {
  const words = Array.isArray(timedWords) ? timedWords : [];
  const withSections = splitBySection(words, timingSplit);
  const talkingGroups = createPhraseGroups(withSections, 'talking_avatar');
  const blackGroups = createPhraseGroups(withSections, 'black_screen');

  const styles = `[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Main,${fontName},120,&H0037F3FF,&H0037F3FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,18,0,7,32,32,180,1
`;

  const events = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${buildDialogueLines(talkingGroups, 'talking_avatar').join('\n')}
${buildDialogueLines(blackGroups, 'black_screen').join('\n')}`.trim();

  return [
    ASS_HEADER,
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    '',
    styles.trim(),
    '',
    events,
    '',
  ].join('\n');
}