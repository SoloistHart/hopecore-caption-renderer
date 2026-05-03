import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { buildAssFromWords } from './build-ass.js';

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

function normalizePayload(clientPayload) {
  if (clientPayload?.payload && typeof clientPayload.payload === 'object') {
    return {
      ...clientPayload.payload,
      job_id: clientPayload.job_id,
      callback_url: clientPayload.callback_url,
      callback_secret: clientPayload.callback_secret,
      upload_url: clientPayload.upload_url,
    };
  }

  return clientPayload;
}

async function downloadFile(url, filePath) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${url} with status ${response.status}`);
  }

  await pipeline(response.body, createWriteStream(filePath));
}

async function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} exited with code ${code}\n${stderr || stdout}`));
    });
  });
}

function requireField(payload, field) {
  if (!payload[field]) {
    throw new Error(`Missing required payload field: ${field}`);
  }

  return payload[field];
}

function resolveDurations(payload) {
  const talkingAvatarEnd = Number(payload?.timing_split?.talking_avatar_end || 0);
  const blackScreenEnd = Number(payload?.timing_split?.black_screen_end || 0);
  const blackScreenDuration = Math.max(0, blackScreenEnd - talkingAvatarEnd);

  if (!talkingAvatarEnd || !blackScreenEnd || blackScreenDuration <= 0) {
    throw new Error('Invalid timing_split payload. Expected talking_avatar_end and black_screen_end.');
  }

  return {
    talkingAvatarEnd,
    blackScreenEnd,
    blackScreenDuration,
  };
}

function escapeFilterPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:');
}

function sanitizePathPart(value) {
  return String(value ?? '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'render';
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

async function main() {
  const eventPayload = await getEventPayload();
  const payload = normalizePayload(extractClientPayload(eventPayload));

  const jobId = requireField(payload, 'job_id');
  const talkingAvatarVideoUrl = requireField(payload, 'talking_avatar_video_url');
  const voiceAudioUrl = requireField(payload, 'voice_audio_url');
  const timedWords = requireField(payload, 'timed_words');
  const { talkingAvatarEnd, blackScreenDuration } = resolveDurations(payload);

  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'caption-renderer-'));
  const baseVideoPath = path.join(workingDir, 'talking-avatar.mp4');
  const voiceAudioPath = path.join(workingDir, 'voice-audio.mp3');
  const assPath = path.join(workingDir, 'subtitles.ass');
  const act1Path = path.join(workingDir, 'act1.mp4');
  const act2Path = path.join(workingDir, 'act2.mp4');
  const concatListPath = path.join(workingDir, 'concat.txt');
  const combinedPath = path.join(workingDir, 'act1-act2.mp4');
  const outputPath = path.join(workingDir, 'act1-act2-captioned.mp4');

  try {
    await downloadFile(talkingAvatarVideoUrl, baseVideoPath);
    await downloadFile(voiceAudioUrl, voiceAudioPath);

    const assContent = buildAssFromWords({
      timedWords,
      timingSplit: payload.timing_split,
      fontName: payload.font_name || 'Arial Black',
      width: Number(payload.width || 1080),
      height: Number(payload.height || 1920),
    });

    await fs.writeFile(assPath, assContent, 'utf8');

    await runCommand('ffmpeg', [
      '-y',
      '-i', baseVideoPath,
      '-i', voiceAudioPath,
      '-t', String(talkingAvatarEnd),
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-shortest',
      act1Path,
    ], workingDir);

    await runCommand('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=black:s=${payload.width || 1080}x${payload.height || 1920}:d=${blackScreenDuration}:r=30`,
      '-ss', String(talkingAvatarEnd),
      '-t', String(blackScreenDuration),
      '-i', voiceAudioPath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-shortest',
      act2Path,
    ], workingDir);

    await fs.writeFile(concatListPath, `file '${act1Path.replace(/'/g, "'\\''")}''\nfile '${act2Path.replace(/'/g, "'\\''")}''\n`.replace(/''\n/g, "'\n"), 'utf8');

    await runCommand('ffmpeg', [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c', 'copy',
      combinedPath,
    ], workingDir);

    await runCommand('ffmpeg', [
      '-y',
      '-i', combinedPath,
      '-vf', `ass=${escapeFilterPath(assPath)}`,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
      outputPath,
    ], workingDir);

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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});