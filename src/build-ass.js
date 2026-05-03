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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .trim();
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

  return words.map((word) => ({
    ...word,
    section: Number(word.start) < talkEnd ? 'talking_avatar' : 'black_screen',
  }));
}

function createPhraseGroups(words, section) {
  const sectionWords = words.filter((word) => word.section === section && sanitizeText(word.text));
  const groups = [];
  let current = [];

  for (const word of sectionWords) {
    current.push(word);

    const combinedText = current.map((item) => sanitizeText(item.text)).join(' ');
    const hitPunctuation = /[.!?,]$/.test(sanitizeText(word.text));
    const hitSize = current.length >= (section === 'black_screen' ? 4 : 3);
    const hitLength = combinedText.length >= (section === 'black_screen' ? 22 : 18);

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

function pickEmphasisIndex(group) {
  let emphasisIndex = 0;
  let longest = -1;

  group.forEach((word, index) => {
    const length = sanitizeText(word.text).length;
    if (length > longest) {
      longest = length;
      emphasisIndex = index;
    }
  });

  return emphasisIndex;
}

function buildTalkingAvatarOverrides(groupIndex, wordIndex, emphasisIndex, colorIndex) {
  const baseY = 1390;
  const lineHeight = 118;
  const perWordX = [540, 540, 540];
  const perWordY = [baseY, baseY + lineHeight, baseY + (lineHeight * 2)];
  const fontSize = wordIndex === emphasisIndex ? 128 : 88;
  const rotation = wordIndex === emphasisIndex ? 0 : (wordIndex % 2 === 0 ? -2 : 2);
  const color = DEFAULT_COLORS[(groupIndex + colorIndex) % DEFAULT_COLORS.length];

  return `\\an5\\pos(${perWordX[wordIndex] ?? 540},${perWordY[wordIndex] ?? (baseY + (wordIndex * lineHeight))})\\fs${fontSize}\\bord16\\shad0\\frz${rotation}\\1c${color}`;
}

function buildBlackScreenOverrides(groupIndex, wordIndex, emphasisIndex, colorIndex) {
  const baseY = 760;
  const lineHeight = 140;
  const perWordX = [540, 540, 540, 540];
  const perWordY = [baseY, baseY + lineHeight, baseY + (lineHeight * 2), baseY + (lineHeight * 3)];
  const fontSize = wordIndex === emphasisIndex ? 176 : 112;
  const rotation = wordIndex === emphasisIndex ? 0 : (wordIndex % 2 === 0 ? -3 : 3);
  const color = DEFAULT_COLORS[(groupIndex + colorIndex) % DEFAULT_COLORS.length];

  return `\\an5\\pos(${perWordX[wordIndex] ?? 540},${perWordY[wordIndex] ?? (baseY + (wordIndex * lineHeight))})\\fs${fontSize}\\bord18\\shad0\\frz${rotation}\\1c${color}`;
}

function buildDialogueLines(groups, section) {
  const lines = [];

  groups.forEach((group, groupIndex) => {
    const emphasisIndex = pickEmphasisIndex(group);
    const groupStart = Number(group[0]?.start || 0);
    const groupEnd = Number(group[group.length - 1]?.end || groupStart + 0.4);
    const holdEnd = groupEnd + (section === 'black_screen' ? 0.2 : 0.12);

    group.forEach((word, wordIndex) => {
      const text = sanitizeText(word.text).toUpperCase();
      const overrides = section === 'black_screen'
        ? buildBlackScreenOverrides(groupIndex, wordIndex, emphasisIndex, wordIndex)
        : buildTalkingAvatarOverrides(groupIndex, wordIndex, emphasisIndex, wordIndex);

      const start = clamp(groupStart, 0, holdEnd);
      const end = clamp(holdEnd, start + 0.08, holdEnd);

      lines.push(`Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Main,,0,0,0,,{${overrides}}${text}`);
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
Style: Main,${fontName},120,&H0037F3FF,&H0037F3FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,18,0,5,32,32,180,1
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