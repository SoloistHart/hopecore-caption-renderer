# Caption Renderer

This folder is a standalone renderer service for the Hopecore workflow.

Purpose:

- build `Act 1 + Act 2` as a single captioned clip
- keep the stylized captions outside Creatomate
- stay portable so this folder can later be moved into its own public repo
- render from the same n8n payload contract using Remotion instead of burned `.ass` subtitles

## What This Service Owns

The renderer handles:

- trimming the talking avatar clip to `talking_avatar_end`
- creating the black-screen punchline segment
- applying word-timed stylized captions in a Remotion composition
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
  "callback_url": "https://example.com/webhook",
  "callback_secret": "shared-secret",
  "upload_url": "https://example.com/presigned-put-url",
  "payload": {
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
    "caption_style_preset": "bold uppercase rainbow word-by-word"
  },
}
```

`upload_url` is optional for development, but required for automation if you want the renderer to return a public file URL.

The nesting under `payload` is intentional so the GitHub `repository_dispatch` request stays under the 10 top-level property limit.

## GitHub Actions Shape

Recommended trigger:

- `repository_dispatch`
- event type: `render-hopecore-caption`

In this monorepo, the live production workflow should live at `.github/workflows/render-caption.yml`.

The extraction-ready standalone template for when `services/caption-renderer` becomes its own repo lives at [.github/workflows/render-caption.yml](./.github/workflows/render-caption.yml).

The older example workflow file remains at [examples/github-actions-render-caption.yml](./examples/github-actions-render-caption.yml), but it should be treated as reference only unless kept in sync.

If `upload_url` is empty, the production workflow can still run in smoke-test mode and call the n8n callback with a placeholder URL. That lets you validate the dispatch and callback plumbing before storage is wired.

If you configure Backblaze B2 secrets in GitHub Actions, `upload_url` can stay empty and the worker will upload directly to B2 instead of using smoke-test mode.

## Production Requirements

Current factory path:

- n8n dispatches `repository_dispatch` with event type `render-hopecore-caption`
- GitHub Actions runs the renderer from `services/caption-renderer`
- the Remotion worker builds and renders `Act 1 + Act 2`
- the finished MP4 is uploaded by presigned `upload_url` or by Backblaze B2 credentials
- the worker posts a callback containing `act1_act2_captioned_url`

Important production notes:

- The monorepo workflow must run with `services/caption-renderer` as the working directory because the repo root does not contain a `package.json`.
- Rendering is now owned by Remotion and the Node worker in `src/render-job.js`, not by a custom FFmpeg subtitle pipeline.
- FFmpeg may still be used internally by Remotion on the runner, but the repo no longer depends on handwritten FFmpeg caption scripts for this stage.
- If the repo is later split and `services/caption-renderer` becomes the root of a new repo, use the standalone template at `services/caption-renderer/.github/workflows/render-caption.yml`.

## Development Notes

- This worker uses a Node entrypoint plus a Remotion composition.
- GitHub-hosted Ubuntu runners can render this without a custom FFmpeg subtitle pipeline.
- Direct Backblaze uploads use the AWS S3-compatible SDK because B2 exposes an S3-compatible endpoint.
- The shared caption grouping/layout helpers are in [src/caption-model.js](./src/caption-model.js).
- The Remotion composition entry lives in [src/index.jsx](./src/index.jsx), [src/Root.jsx](./src/Root.jsx), and [src/HopecoreAct1Act2.jsx](./src/HopecoreAct1Act2.jsx).
- The worker entry point is in [src/render-job.js](./src/render-job.js).

## Local Preview Mode

You can test caption styling locally without running the full hopecore workflow.

Use the sample payload at [examples/sample-payload.json](./examples/sample-payload.json) and replace the placeholder media URLs with real fetchable URLs.

For fully local iteration, you can also point `talking_avatar_video_url` and `voice_audio_url` at local files instead of remote URLs. Relative paths resolve from the `services/caption-renderer` folder.

Recommended test formats for the fastest path:

- talking avatar: `mp4`
- voice audio: `mp3`

Other audio/video formats may work if FFmpeg can read them, but `mp4` + `mp3` is the expected low-friction setup.

Example local input paths:

- `preview-inputs/talking-avatar.mp4`
- `preview-inputs/voice.mp3`
- or `file:///C:/path/to/talking-avatar.mp4`

The worker supports:

- `RENDER_PREVIEW=1` to skip upload and callback
- optional `PREVIEW_OUTPUT_DIR` to choose where preview files are stored
- optional payload fields `preview: true` and `preview_output_dir`

Fastest Windows command:

```powershell
npm run preview
```

That runs [preview.ps1](./preview.ps1), which automatically:

- uses `examples/sample-payload.json`
- enables preview mode
- writes output into `preview-out`
- installs dependencies first if needed

PowerShell example:

```powershell
Set-Location "c:\Users\SPM\Documents\Save files here\Vibe Coded Apps\n8n-hapday-workflows\services\caption-renderer"
npm install
$env:GITHUB_EVENT_PATH = "$PWD\examples\sample-payload.json"
$env:RENDER_PREVIEW = "1"
$env:PREVIEW_OUTPUT_DIR = "$PWD\preview-out"
npm run render
```

Each preview run writes a timestamped folder containing:

- `act1-act2-captioned.mp4`
- `payload.json`
- `render-props.json`

This is the fastest loop for adjusting caption layout, timing, font sizing, positioning, and color behavior in the Remotion composition and caption model helpers.

## Backblaze B2 Setup

To upload rendered clips directly from GitHub Actions to a private Backblaze B2 bucket, add these repository secrets:

- `B2_BUCKET`
- `B2_ENDPOINT`
- `B2_KEY_ID`
- `B2_APPLICATION_KEY`
- optional: `B2_REGION`
- optional: `B2_KEY_PREFIX` (defaults to `renders/`)
- optional: `B2_DOWNLOAD_URL_TTL_SECONDS` (defaults to `86400`)

With those secrets set, the worker uploads the finished MP4 to Backblaze and returns a signed download URL in the callback payload.

## Current Output Strategy

This first version optimizes for low cost and GitHub Actions friendliness:

- captions are burned into the `Act 1 + Act 2` clip
- layout is driven by a React/Remotion composition instead of FFmpeg `.ass` overlays
- no transparent alpha overlay yet

That keeps runtime, storage, and file handling simpler.

## Later Upgrade Path

If needed later, the same timing/style logic can be reused to output:

- transparent caption overlay video
- alternate caption presets
- separate Act 1 / Act 2 render targets
