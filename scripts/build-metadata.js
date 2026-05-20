const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BUILD_METADATA_PATH = path.join(PROJECT_ROOT, 'config', 'build-metadata.json');
const BUILD_SHA_ENV_KEY = 'THUMBGATE_BUILD_SHA';
const BUILD_GENERATED_AT_ENV_KEY = 'THUMBGATE_BUILD_GENERATED_AT';

function normalizeNullableText(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveBuildMetadata({ env = process.env, filePath } = {}) {
  // Precedence: immutable JSON file (baked into Docker image at build time, so it
  // ALWAYS matches the deployed code) wins over runtime env vars. Env vars are
  // mutable Railway/host config that can drift — they shadowed the freshly-stamped
  // SHA in prod on 2026-05-20 and made /health lie about the deployed commit.
  // Fall back to env vars only when the file is missing or its values are null,
  // and require an explicit SHA env var (not just a stray GENERATED_AT) before
  // trusting the env branch.
  const resolvedPath =
    normalizeNullableText(filePath) ||
    normalizeNullableText(env.THUMBGATE_BUILD_METADATA_PATH) ||
    DEFAULT_BUILD_METADATA_PATH;
  const envBuildSha = normalizeNullableText(env[BUILD_SHA_ENV_KEY]);
  const envGeneratedAt = normalizeNullableText(env[BUILD_GENERATED_AT_ENV_KEY]);

  let fileBuildSha = null;
  let fileGeneratedAt = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    fileBuildSha = normalizeNullableText(parsed.buildSha);
    fileGeneratedAt = normalizeNullableText(parsed.generatedAt);
  } catch {
    // file missing or unreadable — fall through to env branch
  }

  if (fileBuildSha) {
    return {
      path: resolvedPath,
      buildSha: fileBuildSha,
      generatedAt: fileGeneratedAt || envGeneratedAt,
    };
  }

  // No SHA in the file — fall back to env only if an explicit SHA is set.
  // (Previously a bare GENERATED_AT with no SHA could short-circuit and return
  // { buildSha: null }, losing both signals; now we require the SHA.)
  if (envBuildSha) {
    return {
      path: resolvedPath,
      buildSha: envBuildSha,
      generatedAt: envGeneratedAt,
    };
  }

  return {
    path: resolvedPath,
    buildSha: null,
    generatedAt: fileGeneratedAt || envGeneratedAt,
  };
}

function writeBuildMetadataFile({ sha, outputPath, generatedAt = new Date().toISOString() }) {
  const buildSha = normalizeNullableText(sha);
  if (!buildSha) {
    throw new Error('A non-empty build SHA is required.');
  }

  const targetPath = normalizeNullableText(outputPath) || DEFAULT_BUILD_METADATA_PATH;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const payload = {
    buildSha,
    generatedAt,
  };
  fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`);
  return {
    path: targetPath,
    ...payload,
  };
}

function parseArgs(argv) {
  const options = {
    sha: null,
    outputPath: null,
    generatedAt: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--sha') {
      options.sha = argv[index + 1] || null;
      index += 1;
      continue;
    }
    if (arg === '--output') {
      options.outputPath = argv[index + 1] || null;
      index += 1;
      continue;
    }
    if (arg === '--generated-at') {
      options.generatedAt = argv[index + 1] || null;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

if (require.main === module) {
  const { sha, outputPath, generatedAt } = parseArgs(process.argv.slice(2));
  const result = writeBuildMetadataFile({ sha, outputPath, generatedAt: generatedAt || undefined });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = {
  BUILD_GENERATED_AT_ENV_KEY,
  BUILD_SHA_ENV_KEY,
  DEFAULT_BUILD_METADATA_PATH,
  resolveBuildMetadata,
  writeBuildMetadataFile,
};
