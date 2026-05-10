import { createWriteStream, promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  DEFAULT_FPS,
  buildCompositionProps,
  resolveDurations,
} from './caption-model.js';

function getEventPayload() {
  if (process.env.RENDER_PAYLOAD_JSON) {
    return JSON.parse(process.env.RENDER_PAYLOAD_JSON);
  }

  if (process.env.GITHUB_EVENT_PATH) {
    return fs.readFile(process.env.GITHUB_EVENT_PATH, 'utf8').then((content) => JSON.parse(content));
  }

  throw new Error('No render payload found. Set RENDER_PAYLOAD_JSON or GITHUB_EVENT_PATH.');
}

function extractClientPayload(eventPayload) {
  return eventPayload?.client_payload || eventPayload;
}

function unwrapPayloadShape(value) {
  if (Array.isArray(value)) {
    return unwrapPayloadShape(value[0]);
  }

  if (value?.json && typeof value.json === 'object') {
    return unwrapPayloadShape(value.json);
  }

  return value;
}

function normalizePayload(clientPayload) {
  const unwrappedPayload = unwrapPayloadShape(clientPayload);

  if (unwrappedPayload?.payload && typeof unwrappedPayload.payload === 'object') {
    return {
      ...unwrappedPayload.payload,
      job_id: unwrappedPayload.job_id,
      callback_url: unwrappedPayload.callback_url,
      callback_secret: unwrappedPayload.callback_secret,
      upload_url: unwrappedPayload.upload_url,
    };
  }

  return unwrappedPayload;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? '').trim());
}

function resolveLocalInputPath(value) {
  const source = String(value ?? '').trim();
  if (/^file:\/\//i.test(source)) {
    return fileURLToPath(source);
  }

  return path.isAbsolute(source)
    ? source
    : path.resolve(process.cwd(), source);
}

async function stageInputFile(source, filePath) {
  if (isHttpUrl(source)) {
    const response = await fetch(source);
    if (!response.ok || !response.body) {
      throw new Error(`Download failed for ${source} with status ${response.status}`);
    }

    await pipeline(response.body, createWriteStream(filePath));
    return;
  }

  const localSourcePath = resolveLocalInputPath(source);
  await fs.copyFile(localSourcePath, filePath);
}

function requireField(payload, field) {
  if (!payload[field]) {
    throw new Error(`Missing required payload field: ${field}`);
  }

  return payload[field];
}
function sanitizePathPart(value) {
  return String(value ?? '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'render';
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function resolvePreviewConfig(payload) {
  const previewEnabled = isTruthy(process.env.RENDER_PREVIEW) || payload?.preview === true;
  if (!previewEnabled) {
    return null;
  }

  const configuredDir = String(payload?.preview_output_dir || process.env.PREVIEW_OUTPUT_DIR || 'preview-out').trim();
  const baseDir = path.isAbsolute(configuredDir)
    ? configuredDir
    : path.resolve(process.cwd(), configuredDir);

  return {
    baseDir,
    runDirName: `${sanitizePathPart(payload?.job_id)}-${Date.now()}`,
  };
}

function normalizeB2Endpoint(value) {
  if (!value) {
    return '';
  }

  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function deriveB2Region(endpoint) {
  const hostname = endpoint.replace(/^https?:\/\//i, '').split('/')[0];
  const match = hostname.match(/^s3[.-]([a-z0-9-]+)\./i);
  return match?.[1] || 'us-east-1';
}

function resolveB2StorageConfig() {
  const bucket = process.env.B2_BUCKET?.trim();
  const endpoint = normalizeB2Endpoint(process.env.B2_ENDPOINT?.trim());
  const keyId = process.env.B2_KEY_ID?.trim();
  const applicationKey = process.env.B2_APPLICATION_KEY?.trim();

  if (!bucket || !endpoint || !keyId || !applicationKey) {
    return null;
  }

  const configuredPrefix = process.env.B2_KEY_PREFIX?.trim() || 'renders/';
  const keyPrefix = configuredPrefix.endsWith('/') ? configuredPrefix : `${configuredPrefix}/`;
  const ttlSeconds = Number(process.env.B2_DOWNLOAD_URL_TTL_SECONDS || 86400);

  return {
    bucket,
    endpoint,
    region: process.env.B2_REGION?.trim() || deriveB2Region(endpoint),
    keyId,
    applicationKey,
    keyPrefix,
    downloadUrlTtlSeconds: Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? Math.floor(ttlSeconds) : 86400,
  };
}

async function uploadResultToPresignedUrl(uploadUrl, outputPath) {
  if (!uploadUrl) {
    return null;
  }

  const fileBuffer = await fs.readFile(outputPath);
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
    },
    body: fileBuffer,
  });

  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}`);
  }

  return uploadUrl.split('?')[0];
}

async function uploadResultToBackblaze({ outputPath, jobId }) {
  const storage = resolveB2StorageConfig();
  if (!storage) {
    return null;
  }

  const objectKey = `${storage.keyPrefix}${sanitizePathPart(jobId)}-${Date.now()}.mp4`;
  const fileBuffer = await fs.readFile(outputPath);
  const client = new S3Client({
    region: storage.region,
    endpoint: storage.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: storage.keyId,
      secretAccessKey: storage.applicationKey,
    },
  });

  await client.send(new PutObjectCommand({
    Bucket: storage.bucket,
    Key: objectKey,
    Body: fileBuffer,
    ContentType: 'video/mp4',
  }));

  return getSignedUrl(client, new GetObjectCommand({
    Bucket: storage.bucket,
    Key: objectKey,
  }), {
    expiresIn: storage.downloadUrlTtlSeconds,
  });
}

async function uploadResult({ uploadUrl, outputPath, jobId }) {
  const presignedUrl = await uploadResultToPresignedUrl(uploadUrl, outputPath);
  if (presignedUrl) {
    return presignedUrl;
  }

  const backblazeUrl = await uploadResultToBackblaze({ outputPath, jobId });
  if (backblazeUrl) {
    return backblazeUrl;
  }

  throw new Error('No upload target configured. Provide client_payload.upload_url or set B2_* environment variables.');
}

async function savePreviewArtifacts({
  previewConfig,
  payload,
  outputPath,
  renderProps,
}) {
  const runDir = path.join(previewConfig.baseDir, previewConfig.runDirName);
  await fs.mkdir(runDir, { recursive: true });

  await Promise.all([
    fs.copyFile(outputPath, path.join(runDir, 'act1-act2-captioned.mp4')),
    fs.writeFile(path.join(runDir, 'payload.json'), JSON.stringify(payload, null, 2), 'utf8'),
    fs.writeFile(path.join(runDir, 'render-props.json'), JSON.stringify(renderProps, null, 2), 'utf8'),
  ]);

  return {
    runDir,
    finalVideoPath: path.join(runDir, 'act1-act2-captioned.mp4'),
    renderPropsPath: path.join(runDir, 'render-props.json'),
  };
}

async function postCallback({ callbackUrl, callbackSecret, body }) {
  if (!callbackUrl) {
    return;
  }

  const response = await fetch(callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(callbackSecret ? { 'x-renderer-secret': callbackSecret } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Callback failed with status ${response.status}`);
  }
}

async function startStaticServer(rootDir) {
  const contentTypes = new Map([
    ['.json', 'application/json; charset=utf-8'],
    ['.mp3', 'audio/mpeg'],
    ['.mp4', 'video/mp4'],
    ['.wav', 'audio/wav'],
  ]);

  const server = http.createServer(async (request, response) => {
    try {
      const requestPath = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
      const normalizedPath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
      const relativePath = normalizedPath.replace(/^[/\\]+/, '');
      const filePath = path.join(rootDir, relativePath);
      const resolvedRoot = path.resolve(rootDir);
      const resolvedFile = path.resolve(filePath);

      if (!resolvedFile.startsWith(resolvedRoot)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }

      const file = await fs.readFile(resolvedFile);
      const totalSize = file.byteLength;
      const contentType = contentTypes.get(path.extname(resolvedFile).toLowerCase()) || 'application/octet-stream';
      const rangeHeader = request.headers.range;

      if (rangeHeader) {
        const [startText, endText] = rangeHeader.replace(/bytes=/i, '').split('-');
        const start = Math.max(0, Number(startText || 0));
        const end = endText ? Math.min(totalSize - 1, Number(endText)) : totalSize - 1;

        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= totalSize) {
          response.writeHead(416, {
            'Access-Control-Allow-Origin': '*',
            'Content-Range': `bytes */${totalSize}`,
          });
          response.end();
          return;
        }

        response.writeHead(206, {
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
          'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Content-Type': contentType,
        });
        response.end(file.subarray(start, end + 1));
        return;
      }

      response.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Content-Length': totalSize,
        'Content-Type': contentType,
      });
      response.end(file);
    } catch (error) {
      response.writeHead(404, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      response.end(error instanceof Error ? error.message : 'Not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind preview media server.');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    }),
  };
}

async function main() {
  const eventPayload = await getEventPayload();
  const payload = normalizePayload(extractClientPayload(eventPayload));
  const previewConfig = resolvePreviewConfig(payload);

  const jobId = requireField(payload, 'job_id');
  const talkingAvatarVideoUrl = requireField(payload, 'talking_avatar_video_url');
  const voiceAudioUrl = requireField(payload, 'voice_audio_url');
  const timedWords = requireField(payload, 'timed_words');
  resolveDurations(payload);

  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'caption-renderer-'));
  const baseVideoPath = path.join(workingDir, 'talking-avatar.mp4');
  const voiceAudioPath = path.join(workingDir, 'voice-audio.mp3');
  const outputPath = path.join(workingDir, 'act1-act2-captioned.mp4');
  const entryPoint = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.jsx');

  try {
    await stageInputFile(talkingAvatarVideoUrl, baseVideoPath);
    await stageInputFile(voiceAudioUrl, voiceAudioPath);
    const mediaServer = await startStaticServer(workingDir);

    try {
      const inputProps = buildCompositionProps({
        jobId,
        talkingAvatarVideoSrc: `${mediaServer.origin}/${path.basename(baseVideoPath)}`,
        voiceAudioSrc: `${mediaServer.origin}/${path.basename(voiceAudioPath)}`,
        timedWords,
        timingSplit: payload.timing_split,
        captionStylePreset: payload.caption_style_preset,
        width: Number(payload.width || 1080),
        height: Number(payload.height || 1920),
        fps: Number(payload.fps || DEFAULT_FPS),
        fontFamily: payload.font_family || 'Arial Black, Impact, Helvetica Neue, Arial, sans-serif',
      });

      const bundleLocation = await bundle({
        entryPoint,
        onProgress: ({ progress }) => {
          if (typeof progress === 'number' && Number.isFinite(progress)) {
            console.log(`Bundling Remotion composition: ${Math.round(progress * 100)}%`);
          }
        },
      });
      const composition = await selectComposition({
        id: 'HopecoreAct1Act2',
        serveUrl: bundleLocation,
        inputProps,
      });

      await renderMedia({
        composition,
        serveUrl: bundleLocation,
        codec: 'h264',
        outputLocation: outputPath,
        inputProps,
        pixelFormat: 'yuv420p',
        imageFormat: 'jpeg',
        onProgress: ({ progress }) => {
          console.log(`Rendering video: ${Math.round(progress * 100)}%`);
        },
      });

      if (previewConfig) {
        const previewInfo = await savePreviewArtifacts({
          previewConfig,
          payload,
          outputPath,
          renderProps: inputProps,
        });

        console.log(`Preview artifacts saved to ${previewInfo.runDir}`);
        console.log(`Preview video: ${previewInfo.finalVideoPath}`);
        console.log(`Render props: ${previewInfo.renderPropsPath}`);
        return;
      }

      const publicUrl = await uploadResult({
        uploadUrl: payload.upload_url,
        outputPath,
        jobId,
      });

      await postCallback({
        callbackUrl: payload.callback_url,
        callbackSecret: payload.callback_secret,
        body: {
          job_id: jobId,
          status: 'completed',
          act1_act2_captioned_url: publicUrl,
        },
      });
    } finally {
      await mediaServer.close();
    }
  } catch (error) {
    await postCallback({
      callbackUrl: payload.callback_url,
      callbackSecret: payload.callback_secret,
      body: {
        job_id: jobId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      },
    }).catch(() => undefined);

    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
