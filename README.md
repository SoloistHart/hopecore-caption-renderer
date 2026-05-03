# Caption Renderer

This folder is a standalone renderer service for the Hopecore workflow.

Purpose:

- build `Act 1 + Act 2` as a single captioned clip
- keep the stylized captions outside Creatomate
- stay portable so this folder can later be moved into its own public repo

## What This Service Owns

The renderer handles:

- trimming the talking avatar clip to `talking_avatar_end`
- creating the black-screen punchline segment
- applying word-timed stylized captions via `.ass`
- exporting one combined file: `act1_act2_captioned.mp4`

Creatomate should handle only:

- Act 3 montage
- final sequence assembly
- music/template polish

## Expected Payload

The worker expects a GitHub `repository_dispatch` style payload in `client_payload`.

Example:

```json
{
  "job_id": "row_123_caption_v1",
  "talking_avatar_video_url": "https://example.com/talking-avatar.mp4",
  "voice_audio_url": "https://example.com/voice.mp3",
  "timed_words": [
    { "text": "INSTEAD", "start": 0.1, "end": 0.6 },
    { "text": "I", "start": 0.62, "end": 0.7 },
    { "text": "TRY", "start": 0.72, "end": 0.95 },
    { "text": "TO", "start": 0.98, "end": 1.1 },
    { "text": "FEEL", "start": 1.12, "end": 1.42 }
  ],
  "timing_split": {
    "talking_avatar_end": 3.8,
    "black_screen_end": 8.2
  },
  "caption_style_preset": "bold uppercase rainbow word-by-word",
  "callback_url": "https://example.com/webhook",
  "callback_secret": "shared-secret",
  "upload_url": "https://example.com/presigned-put-url"
}
```

`upload_url` is optional for development, but required for automation if you want the renderer to return a public file URL.

## GitHub Actions Shape

Recommended trigger:

- `repository_dispatch`
- event type: `render-hopecore-caption`

An example workflow file is in [examples/github-actions-render-caption.yml](./examples/github-actions-render-caption.yml).

## Development Notes

- This worker uses only Node built-ins and expects `ffmpeg` to be installed in the runtime.
- GitHub-hosted Ubuntu runners already include `ffmpeg`.
- The `.ass` generator is in [src/build-ass.js](./src/build-ass.js).
- The render pipeline entry point is in [src/render-job.js](./src/render-job.js).

## Current Output Strategy

This first version optimizes for low cost and GitHub Actions friendliness:

- captions are burned into the `Act 1 + Act 2` clip
- no transparent alpha overlay yet

That keeps runtime, storage, and file handling simpler.

## Later Upgrade Path

If needed later, the same timing/style logic can be reused to output:

- transparent caption overlay video
- alternate caption presets
- separate Act 1 / Act 2 render targets