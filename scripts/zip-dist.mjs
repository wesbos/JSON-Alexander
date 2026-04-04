import { createWriteStream } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yazl from "yazl";

const { ZipFile } = yazl;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const distDir = resolve(projectRoot, "dist");
const outputFile = resolve(projectRoot, "json-alexander.zip");

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  const distStats = await stat(distDir).catch(() => null);

  if (!distStats?.isDirectory()) {
    throw new Error("dist folder not found. Run the build first.");
  }

  const files = await listFiles(distDir);

  if (files.length === 0) {
    throw new Error("dist folder is empty. Run the build first.");
  }

  await rm(outputFile, { force: true });

  const zipFile = new ZipFile();

  for (const file of files) {
    zipFile.addFile(file, relative(distDir, file).replace(/\\/g, "/"));
  }

  await new Promise((resolvePromise, rejectPromise) => {
    zipFile.outputStream
      .pipe(createWriteStream(outputFile))
      .on("close", resolvePromise)
      .on("error", rejectPromise);

    zipFile.end();
  });

  console.log(`Created ${relative(projectRoot, outputFile)}`);
}

await main();
