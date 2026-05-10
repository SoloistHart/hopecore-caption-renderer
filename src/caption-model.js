export const DEFAULT_FPS = 30;
export const DEFAULT_WIDTH = 1080;
export const DEFAULT_HEIGHT = 1920;
export const DEFAULT_CAPTION_PRESET = 'bold uppercase rainbow word-by-word';
export const DEFAULT_FONT_FAMILY = '\'Comic Sans MS\', \'Chalkboard SE\', \'Marker Felt\', \'Arial Black\', sans-serif';

const DEFAULT_COLORS = [
  '#FF7BD5',
  '#D6FF53',
  '#1FD6FF',
  '#FF535D',
  '#C8B5FF',
  '#FFA34A',
];

const SOFT_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'i',
  'if',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'the',
  'to',
]);

const HERO_WORDS = new Set([
  'always',
  'eyes',
  'gives',
  'in',
  'lemons',
  'life',
  'people\'s',
  'squeeze',
  'stop',
  'when',
  'why',
  'you',
]);

const SIZE_JITTER = [0.16, -0.05, 0.1, 0.24, 0.03, -0.08, 0.14, 0.2];
const ROTATION_JITTER = [-4, 3, -2, 5, 0, -3, 2, -1];
const X_JITTER = [-4, 0, 5, -2, 3, -3, 2, 0];
const Y_JITTER = [0, -3, 2, -1, 3, -2, 1, 0];

function clampNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampRange(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function getEstimatedSubjectSide(width, height) {
  return Math.round(Math.min(width * 0.78, height * 0.42));
}

function getCharacterWidthFactor(character) {
  const glyph = String(character ?? '').toUpperCase();

  if ('.,:;!|'.includes(glyph)) {
    return 0.18;
  }

  if ('\'`'.includes(glyph)) {
    return 0.16;
  }

  if ('IJLT1'.includes(glyph)) {
    return 0.34;
  }

  if ('FREKPSVXYZ2345679'.includes(glyph)) {
    return 0.58;
  }

  if ('ABDHNU'.includes(glyph)) {
    return 0.64;
  }

  if ('CGOQ08'.includes(glyph)) {
    return 0.7;
  }

  if ('MW@#%&'.includes(glyph)) {
    return 0.86;
  }

  return 0.62;
}

function estimateWordWidth(word, layout, lineScale = 1) {
  const text = normalizeText(word?.text ?? '').toUpperCase();
  const fontSize = layout.fontSize * lineScale * (word?.sizeBoost || 1);
  const glyphUnits = [...text].reduce((sum, character) => sum + getCharacterWidthFactor(character), 0);
  const letterSpacingPx = fontSize * -0.03 * Math.max(text.length - 1, 0);
  const strokePadding = layout.outlinePx * 4.6;

  return Math.max(0, (glyphUnits * fontSize) + letterSpacingPx + strokePadding);
}

function estimateLineWidth(line, layout, lineScale = 1) {
  if (!line.length) {
    return 0;
  }

  const wordsWidth = line.reduce((sum, word) => sum + estimateWordWidth(word, layout, lineScale), 0);
  const gapsWidth = layout.wordGapPx * Math.max(line.length - 1, 0);

  return wordsWidth + gapsWidth;
}

function estimateLineHeight(line, layout, lineScale = 1) {
  if (!line.length) {
    return 0;
  }

  const tallestWord = Math.max(
    ...line.map((word) => layout.fontSize * lineScale * (word?.sizeBoost || 1)),
  );

  return (tallestWord * 0.9) + (layout.outlinePx * 2.6);
}

function estimateBlockHeight(lines, layout, lineScales) {
  if (!lines.length) {
    return 0;
  }

  return lines.reduce((sum, line, lineIndex) => (
    sum + estimateLineHeight(line, layout, lineScales[lineIndex] ?? 1)
  ), 0) + (layout.lineGapPx * Math.max(lines.length - 1, 0));
}

function estimateBlockMaxWidth(lines, layout, lineScales) {
  return lines.reduce((maxWidth, line, lineIndex) => (
    Math.max(maxWidth, estimateLineWidth(line, layout, lineScales[lineIndex] ?? 1))
  ), 0);
}

function getSafeLineWidth(layout, lineIndex, lineCount) {
  const topCornerPenalty = layout.section === 'talking_avatar' && lineIndex === 0 ? 0.84 : 0.9;
  const lowerLinePenalty = lineCount >= 3 && lineIndex === lineCount - 1 ? 0.94 : 1;

  return layout.maxBlockWidth * topCornerPenalty * lowerLinePenalty;
}

function getWordVisual(word, section, groupIndex, wordIndex) {
  const patternIndex = (groupIndex + wordIndex) % SIZE_JITTER.length;
  const normalized = normalizeText(word.text).toLowerCase().replace(/[^a-z']/g, '');
  const isSoftWord = SOFT_WORDS.has(normalized);
  const isHeroWord = HERO_WORDS.has(normalized);
  const shortWordBoost = !isSoftWord && normalized.length > 0 && normalized.length <= 4 ? 0.08 : 0;
  const longWordPenalty = normalized.length >= 10 ? 0.12 : normalized.length >= 8 ? 0.08 : 0;
  const heroBoost = isHeroWord && normalized.length <= 5 ? (section === 'black_screen' ? 0.08 : 0.06) : 0;

  return {
    color: DEFAULT_COLORS[patternIndex % DEFAULT_COLORS.length],
    rotateDeg: 0,
    xOffset: 0,
    yOffset: 0,
    sizeBoost: clampRange(
      1 + (SIZE_JITTER[patternIndex] * 0.22) + shortWordBoost + heroBoost - longWordPenalty - (isSoftWord ? 0.08 : 0),
      0.84,
      section === 'black_screen' ? 1.14 : 1.1,
    ),
  };
}

function normalizeTimedWords(timedWords, timingSplit) {
  const talkingAvatarEnd = clampNumber(timingSplit?.talking_avatar_end, 0);

  return (Array.isArray(timedWords) ? timedWords : [])
    .map((word, index) => {
      const text = normalizeText(word?.text ?? word?.word ?? '');
      const start = clampNumber(word?.start, 0);
      const fallbackEnd = start + 0.18;
      const end = Math.max(start + 0.04, clampNumber(word?.end, fallbackEnd));

      return {
        index: clampNumber(word?.index, index),
        text,
        start,
        end,
        section: start < talkingAvatarEnd ? 'talking_avatar' : 'black_screen',
      };
    })
    .filter((word) => word.text.length > 0)
    .sort((left, right) => left.start - right.start || left.index - right.index);
}

function createPhraseGroups(words, section) {
  const sectionWords = words.filter((word) => word.section === section);
  const groups = [];
  let current = [];

  for (const word of sectionWords) {
    current.push(word);

    const combinedText = current.map((item) => item.text).join(' ');
    const hitPunctuation = /[.!?,]$/.test(word.text);
    const hitSize = current.length >= (section === 'black_screen' ? 5 : 5);
    const hitLength = combinedText.length >= (section === 'black_screen' ? 28 : 25);

    if (hitPunctuation || hitSize || hitLength) {
      groups.push(current);
      current = [];
    }
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups.map((group, groupIndex) => {
    const groupEnd = clampNumber(group[group.length - 1]?.end, group[0]?.start ?? 0);
    const holdEnd = groupEnd + (section === 'black_screen' ? 0.28 : 0.18);

    return {
      groupIndex,
      section,
      start: clampNumber(group[0]?.start, 0),
      end: groupEnd,
      holdEnd,
      words: group.map((word, wordIndex) => {
        const nextStart = clampNumber(group[wordIndex + 1]?.start, holdEnd);

        return {
          ...word,
          revealEnd: Math.max(word.end, nextStart),
          ...getWordVisual(word, section, groupIndex, wordIndex),
        };
      }),
    };
  });
}

function getSectionLayout(section, width, height, groupIndex = 0) {
  const isLandscapeLike = width / Math.max(height, 1) >= 0.8;
  const subjectSide = getEstimatedSubjectSide(width, height);

  if (section === 'black_screen') {
    return {
      section,
      verticalAlign: 'center',
      blockAlign: 'center',
      widthPercent: 0.86,
      leftPercent: 0.07,
      rightPercent: 0.07,
      topPercent: 0.22,
      maxCharsPerLine: isLandscapeLike ? 14 : 12,
      maxWordsPerLine: 2,
      maxLines: 3,
      fontSize: isLandscapeLike ? 66 : 94,
      outlinePx: isLandscapeLike ? 7 : 9,
      wordGapPx: isLandscapeLike ? 12 : 14,
      lineGapPx: isLandscapeLike ? 8 : 10,
      activeScale: 1,
      maxBlockWidth: Math.round(subjectSide * 0.86),
      maxBlockHeight: Math.round(subjectSide * 0.6),
      lineOffsetPattern: [0, 0, 0],
    };
  }

  return {
    section,
    verticalAlign: 'top',
    blockAlign: 'start',
    widthPercent: 0.86,
    leftPercent: 0.07,
    rightPercent: 0.07,
    topPercent: groupIndex % 3 === 1 ? 0.11 : 0.08,
    maxCharsPerLine: isLandscapeLike ? 13 : 11,
    maxWordsPerLine: 2,
    maxLines: 3,
    fontSize: isLandscapeLike ? 68 : 88,
    outlinePx: isLandscapeLike ? 7 : 9,
    wordGapPx: 12,
    lineGapPx: isLandscapeLike ? 10 : 12,
    activeScale: 1,
    maxBlockWidth: Math.round(subjectSide * 0.86),
    maxBlockHeight: Math.round(subjectSide * 0.56),
    lineOffsetPattern: [0, 0, 0],
  };
}

function sliceByCounts(words, counts) {
  const lines = [];
  let cursor = 0;

  for (const count of counts) {
    if (cursor >= words.length) {
      break;
    }

    lines.push(words.slice(cursor, cursor + count));
    cursor += count;
  }

  if (cursor < words.length) {
    lines.push(words.slice(cursor));
  }

  return lines.filter((line) => line.length > 0);
}

function getTemplateCounts(words, section) {
  const count = words.length;
  const lengths = words.map((word) => word.text.length);
  const longestLength = Math.max(...lengths);
  const longestIndex = lengths.indexOf(longestLength);

  if (count <= 1) {
    return [count];
  }

  if (count === 2) {
    if (section === 'talking_avatar' && lengths.every((length) => length <= 4)) {
      return [1, 1];
    }

    return longestLength >= 8 ? [1, 1] : [2];
  }

  if (count === 3) {
    if (longestLength >= 8) {
      return longestIndex === 0 ? [1, 2] : [2, 1];
    }

    if (lengths[0] <= 4) {
      return [1, 2];
    }

    return [2, 1];
  }

  if (count === 4) {
    if (longestLength >= 10) {
      if (longestIndex <= 1) {
        return [1, 1, 2];
      }

      return [2, 1, 1];
    }

    return section === 'talking_avatar' ? [1, 2, 1] : [2, 1, 1];
  }

  if (count === 5) {
    if (section === 'talking_avatar') {
      if (longestLength >= 9) {
        return longestIndex <= 1 ? [1, 2, 2] : [2, 1, 2];
      }

      return [1, 2, 2];
    }

    return [2, 1, 2];
  }

  return section === 'talking_avatar' ? [1, 2, 2, count - 5] : [2, 1, 2, count - 5];
}

function buildInitialLines(words, layout) {
  const templateLines = sliceByCounts(words, getTemplateCounts(words, layout.section));

  return templateLines.filter((line) => line.length > 0);
}

function getPreferredLineScale(line, section, lineIndex, lineCount) {
  if (line.length === 1) {
    const length = line[0].text.length;
    const isTopHeroLine = lineIndex === 0 && lineCount > 1;

    if (length <= 2) {
      return section === 'talking_avatar'
        ? (isTopHeroLine ? 1.44 : 1.3)
        : (isTopHeroLine ? 1.34 : 1.22);
    }

    if (length <= 4) {
      return section === 'talking_avatar'
        ? (isTopHeroLine ? 1.3 : 1.18)
        : (isTopHeroLine ? 1.2 : 1.12);
    }

    if (length <= 6) {
      return isTopHeroLine ? 1.08 : 0.98;
    }

    if (length <= 8) {
      return 0.9;
    }

    return 0.82;
  }

  if (line.length === 2) {
    const longest = Math.max(...line.map((word) => word.text.length));
    const allShort = line.every((word) => word.text.length <= 4);

    if (allShort && lineIndex > 0) {
      return 1.02;
    }

    return longest >= 8 ? 0.82 : longest >= 6 ? 0.88 : 0.94;
  }

  return 0.8;
}

function squeezeOversizedLines(lines, layout) {
  const working = lines.map((line) => [...line]);
  let changed = true;

  while (changed) {
    changed = false;

    for (let lineIndex = 0; lineIndex < working.length; lineIndex += 1) {
      const line = working[lineIndex];

      if (line.length <= 1) {
        continue;
      }

      const preferredScale = getPreferredLineScale(line, layout.section, lineIndex, working.length);
      const safeWidth = getSafeLineWidth(layout, lineIndex, working.length);
      const fitScale = safeWidth / Math.max(estimateLineWidth(line, layout, 1), 1);

      if (Math.min(preferredScale, fitScale) < 0.8) {
        const movedWord = line.pop();

        if (!movedWord) {
          continue;
        }

        if (working[lineIndex + 1]) {
          working[lineIndex + 1].unshift(movedWord);
        } else {
          working.push([movedWord]);
        }

        changed = true;
        break;
      }
    }
  }

  return working.filter((line) => line.length > 0);
}

function getFittedLineScales(lines, layout) {
  const baseScales = lines.map((line, lineIndex) => {
    const preferredScale = getPreferredLineScale(line, layout.section, lineIndex, lines.length);
    const safeWidth = getSafeLineWidth(layout, lineIndex, lines.length);
    const fitScale = safeWidth / Math.max(estimateLineWidth(line, layout, 1), 1);

    return clampRange(Math.min(preferredScale, fitScale), 0.66, preferredScale);
  });

  const widthAllowance = lines.reduce((minScale, line, lineIndex) => {
    const safeWidth = getSafeLineWidth(layout, lineIndex, lines.length);
    const currentWidth = estimateLineWidth(line, layout, baseScales[lineIndex]);

    return Math.min(minScale, safeWidth / Math.max(currentWidth, 1));
  }, Number.POSITIVE_INFINITY);

  const currentBlockWidth = estimateBlockMaxWidth(lines, layout, baseScales);
  const currentBlockHeight = estimateBlockHeight(lines, layout, baseScales);
  const desiredWidth = layout.maxBlockWidth * (layout.section === 'talking_avatar' ? 0.9 : 0.87);
  const desiredHeight = layout.maxBlockHeight * (layout.section === 'talking_avatar' ? 0.9 : 0.86);
  const desiredFillScale = Math.min(
    desiredWidth / Math.max(currentBlockWidth, 1),
    desiredHeight / Math.max(currentBlockHeight, 1),
  );
  const heightAllowance = layout.maxBlockHeight / Math.max(currentBlockHeight, 1);
  const fillScale = clampRange(
    Math.min(widthAllowance, heightAllowance, Math.max(1, desiredFillScale)),
    1,
    layout.section === 'talking_avatar' ? 1.28 : 1.2,
  );

  return baseScales.map((scale) => clampRange(scale * fillScale, 0.66, 1.58));
}

function layoutWordsInLines(group, layout) {
  const initialLines = buildInitialLines(group.words, layout);
  const lines = squeezeOversizedLines(initialLines, layout);

  return {
    lines,
    lineScales: getFittedLineScales(lines, layout),
  };
}

function decorateGroup(group, width, height) {
  const layout = getSectionLayout(group.section, width, height, group.groupIndex);
  const { lines, lineScales } = layoutWordsInLines(group, layout);

  return {
    ...group,
    layout,
    lines,
    lineScales,
  };
}

export function resolveDurations(payload) {
  const talkingAvatarEndSeconds = clampNumber(payload?.timing_split?.talking_avatar_end, 0);
  const blackScreenEndSeconds = clampNumber(payload?.timing_split?.black_screen_end, 0);
  const totalDurationSeconds = blackScreenEndSeconds;

  if (!talkingAvatarEndSeconds || !blackScreenEndSeconds || blackScreenEndSeconds <= talkingAvatarEndSeconds) {
    throw new Error('Invalid timing_split payload. Expected talking_avatar_end and black_screen_end.');
  }

  return {
    talkingAvatarEndSeconds,
    blackScreenEndSeconds,
    totalDurationSeconds,
    blackScreenDurationSeconds: blackScreenEndSeconds - talkingAvatarEndSeconds,
  };
}

export function buildCaptionGroups({ timedWords, timingSplit, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT }) {
  const normalizedWords = normalizeTimedWords(timedWords, timingSplit);
  const talkingGroups = createPhraseGroups(normalizedWords, 'talking_avatar');
  const blackGroups = createPhraseGroups(normalizedWords, 'black_screen');

  return [...talkingGroups, ...blackGroups].map((group) => decorateGroup(group, width, height));
}

export function buildCompositionProps({
  jobId,
  talkingAvatarVideoSrc,
  voiceAudioSrc,
  timedWords,
  timingSplit,
  captionStylePreset = DEFAULT_CAPTION_PRESET,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  fps = DEFAULT_FPS,
  fontFamily = DEFAULT_FONT_FAMILY,
}) {
  const duration = resolveDurations({ timing_split: timingSplit });
  const safeWidth = clampNumber(width, DEFAULT_WIDTH);
  const safeHeight = clampNumber(height, DEFAULT_HEIGHT);
  const safeFps = clampNumber(fps, DEFAULT_FPS);

  return {
    jobId: normalizeText(jobId) || 'hopecore-act1-act2',
    talkingAvatarVideoSrc,
    voiceAudioSrc,
    captionStylePreset,
    width: safeWidth,
    height: safeHeight,
    fps: safeFps,
    fontFamily,
    talkingAvatarEndSeconds: duration.talkingAvatarEndSeconds,
    blackScreenEndSeconds: duration.blackScreenEndSeconds,
    totalDurationSeconds: duration.totalDurationSeconds,
    captionGroups: buildCaptionGroups({
      timedWords,
      timingSplit,
      width: safeWidth,
      height: safeHeight,
    }),
  };
}

export function getSectionForTime(currentTimeSeconds, talkingAvatarEndSeconds) {
  return currentTimeSeconds < talkingAvatarEndSeconds ? 'talking_avatar' : 'black_screen';
}

export function getCaptionSnapshot({ captionGroups, currentTimeSeconds, section }) {
  const activeGroup = captionGroups.find((group) => (
    group.section === section
    && currentTimeSeconds >= group.start
    && currentTimeSeconds < group.holdEnd
  ));

  if (!activeGroup) {
    return null;
  }

  let activeWordIndex = -1;
  for (const word of activeGroup.words) {
    if (currentTimeSeconds >= word.start) {
      activeWordIndex = word.index;
    }
  }

  return {
    ...activeGroup,
    activeWordIndex,
  };
}
