import React from 'react';
import { Composition } from 'remotion';
import {
  DEFAULT_FPS,
  DEFAULT_FONT_FAMILY,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
} from './caption-model.js';
import { HopecoreAct1Act2 } from './HopecoreAct1Act2.jsx';

const defaultProps = {
  jobId: 'hopecore-act1-act2',
  talkingAvatarVideoSrc: '',
  voiceAudioSrc: '',
  captionStylePreset: 'bold uppercase rainbow word-by-word',
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  fps: DEFAULT_FPS,
  fontFamily: DEFAULT_FONT_FAMILY,
  talkingAvatarEndSeconds: 4,
  blackScreenEndSeconds: 8,
  totalDurationSeconds: 8,
  captionGroups: [],
};

const calculateMetadata = async ({ props }) => {
  const fps = Number(props.fps || DEFAULT_FPS);
  const width = Number(props.width || DEFAULT_WIDTH);
  const height = Number(props.height || DEFAULT_HEIGHT);
  const totalDurationSeconds = Number(props.totalDurationSeconds || props.blackScreenEndSeconds || 8);

  return {
    fps,
    width,
    height,
    durationInFrames: Math.max(1, Math.ceil(totalDurationSeconds * fps) + 2),
    defaultOutName: `${props.jobId || 'hopecore-act1-act2'}.mp4`,
  };
};

export const Root = () => {
  return (
    <Composition
      id="HopecoreAct1Act2"
      component={HopecoreAct1Act2}
      durationInFrames={242}
      fps={DEFAULT_FPS}
      width={DEFAULT_WIDTH}
      height={DEFAULT_HEIGHT}
      defaultProps={defaultProps}
      calculateMetadata={calculateMetadata}
    />
  );
};
