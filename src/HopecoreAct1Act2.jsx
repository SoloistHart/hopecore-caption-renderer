import React from 'react';
import { Video } from '@remotion/media';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { getCaptionSnapshot, getSectionForTime } from './caption-model.js';

const backgroundStyle = {
  backgroundColor: '#000000',
  overflow: 'hidden',
};

function getSubjectFrame(width, height) {
  const side = Math.round(Math.min(width * 0.78, height * 0.42));
  const top = Math.round(height * 0.12);
  const left = Math.round((width - side) / 2);

  return {
    width: side,
    height: side,
    top,
    left,
    radius: Math.round(side * 0.12),
  };
}

function CaptionOverlay({
  captionGroups,
  currentTimeSeconds,
  talkingAvatarEndSeconds,
  fontFamily,
  subjectFrame,
}) {
  const section = getSectionForTime(currentTimeSeconds, talkingAvatarEndSeconds);
  const snapshot = getCaptionSnapshot({
    captionGroups,
    currentTimeSeconds,
    section,
  });

  if (!snapshot) {
    return null;
  }

  const layout = snapshot.layout;
  const overlayWidth = Math.min(layout.maxBlockWidth, Math.round(subjectFrame.width * layout.widthPercent));
  const isCenteredBlock = layout.blockAlign === 'center';

  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        left: subjectFrame.left,
        top: subjectFrame.top,
        width: subjectFrame.width,
        height: subjectFrame.height,
        overflow: 'hidden',
        borderRadius: subjectFrame.radius,
      }}
    >
      <AbsoluteFill
        style={{
          justifyContent: layout.verticalAlign === 'center' ? 'center' : 'flex-start',
          alignItems: isCenteredBlock ? 'center' : 'stretch',
          paddingTop: layout.verticalAlign === 'center' ? 0 : `${layout.topPercent * 100}%`,
          paddingLeft: `${(layout.leftPercent ?? ((1 - layout.widthPercent) / 2)) * 100}%`,
          paddingRight: `${(layout.rightPercent ?? ((1 - layout.widthPercent) / 2)) * 100}%`,
        }}
      >
        <div
          style={{
            width: overlayWidth,
            display: 'flex',
            flexDirection: 'column',
            alignItems: isCenteredBlock ? 'center' : 'flex-start',
            gap: layout.lineGapPx,
          }}
        >
          {snapshot.lines.map((line, lineIndex) => (
            <div
              key={`line-${snapshot.groupIndex}-${lineIndex}`}
              style={{
                display: 'flex',
                justifyContent: isCenteredBlock ? 'center' : 'flex-start',
                alignItems: 'center',
                gap: layout.wordGapPx,
                flexWrap: 'nowrap',
                transform: `translateX(${layout.lineOffsetPattern?.[lineIndex % layout.lineOffsetPattern.length] ?? 0}px)`,
              }}
            >
              {line.map((word) => {
                const isVisible = currentTimeSeconds >= word.start;
                const lineScale = snapshot.lineScales?.[lineIndex] ?? 1;

                return (
                  <span
                    key={`word-${word.index}`}
                    style={{
                      visibility: isVisible ? 'visible' : 'hidden',
                      display: 'inline-block',
                      whiteSpace: 'pre',
                      fontFamily,
                      fontWeight: 900,
                      fontSize: Math.round(layout.fontSize * lineScale * (word.sizeBoost || 1)),
                      lineHeight: 0.9,
                      textTransform: 'uppercase',
                      color: word.color,
                      WebkitTextStroke: `${layout.outlinePx}px #000000`,
                      paintOrder: 'stroke fill',
                      textShadow: '0 4px 0 rgba(0, 0, 0, 0.82), 0 8px 14px rgba(0, 0, 0, 0.25)',
                      letterSpacing: '-0.03em',
                      transform: `translate3d(${word.xOffset || 0}px, ${word.yOffset || 0}px, 0) rotate(${word.rotateDeg || 0}deg)`,
                    }}
                  >
                    {word.text.toUpperCase()}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

export const HopecoreAct1Act2 = ({
  talkingAvatarVideoSrc,
  voiceAudioSrc,
  captionGroups,
  talkingAvatarEndSeconds,
  fontFamily,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const currentTimeSeconds = frame / fps;
  const talkingAvatarDurationInFrames = Math.max(1, Math.ceil(talkingAvatarEndSeconds * fps));
  const subjectFrame = getSubjectFrame(width, height);

  return (
    <AbsoluteFill style={backgroundStyle}>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(circle at center, rgba(36, 36, 36, 0.22) 0%, rgba(8, 8, 8, 0.7) 44%, rgba(0, 0, 0, 1) 100%)',
        }}
      />
      <AbsoluteFill style={{ alignItems: 'center' }}>
        <div
          style={{
            position: 'absolute',
            left: subjectFrame.left,
            top: subjectFrame.top,
            width: subjectFrame.width,
            height: subjectFrame.height,
            borderRadius: subjectFrame.radius,
            overflow: 'hidden',
            backgroundColor: '#000000',
            boxShadow: '0 14px 40px rgba(0, 0, 0, 0.35)',
          }}
        >
          <Sequence from={0} durationInFrames={talkingAvatarDurationInFrames}>
            <Video
              src={talkingAvatarVideoSrc}
              muted
              objectFit="cover"
              style={{
                width: '100%',
                height: '100%',
                backgroundColor: '#000000',
                transform: 'scale(1.06)',
              }}
            />
          </Sequence>
        </div>
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            currentTimeSeconds >= talkingAvatarEndSeconds
              ? 'linear-gradient(180deg, rgba(8, 8, 8, 1) 0%, rgba(0, 0, 0, 1) 100%)'
              : 'transparent',
          opacity: currentTimeSeconds >= talkingAvatarEndSeconds ? 1 : 0,
        }}
      />
      <Audio src={voiceAudioSrc} />
      <CaptionOverlay
        captionGroups={captionGroups}
        currentTimeSeconds={currentTimeSeconds}
        talkingAvatarEndSeconds={talkingAvatarEndSeconds}
        fontFamily={fontFamily}
        subjectFrame={subjectFrame}
      />
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          boxShadow: 'inset 0 0 220px rgba(0, 0, 0, 0.38)',
        }}
      />
    </AbsoluteFill>
  );
};
