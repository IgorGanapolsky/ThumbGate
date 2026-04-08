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
  const resolvedPath =
    normalizeNullableText(filePath) ||
    normalizeNullableText(env.THUMBGATE_BUILD_METADATA_PATH) ||
    DEFAULT_BUILD_METADATA_PATH;
  const envBuildSha = normalizeNullableText(env[BUILD_SHA_ENV_KEY]);
  const envGeneratedAt = normalizeNullableText(env[BUILD_GENERATED_AT_ENV_KEY]);

  if (envBuildSha || envGeneratedAt) {
    return {
      path: resolvedPath,
      buildSha: envBuildSha,
      generatedAt: envGeneratedAt,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    return {
      path: resolvedPath,
      buildSha: normalizeNullableText(parsed.buildSha),
      generatedAt: normalizeNullableText(parsed.generatedAt),
    };
  } catch {
    return {
      path: resolvedPath,
      buildSha: null,
      generatedAt: null,
    };
  }
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
