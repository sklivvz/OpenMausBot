import fs from "node:fs";
import path from "node:path";

export function loadHostConfig(file) {
  if (typeof file !== "string" || !path.isAbsolute(file))
    throw Error("configuration_path_invalid");
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  let bytes;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 65536 || stat.mode & 0o077)
      throw Error("configuration_file_invalid");
    bytes = Buffer.alloc(65537);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > 65536) throw Error("configuration_file_too_large");
    bytes = bytes.subarray(0, length);
  } finally {
    fs.closeSync(fd);
  }
  const config = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (!config || !Array.isArray(config.artifactRoots))
    throw Error("configuration_roots_invalid");
  const resolved = fs.realpathSync(file);
  for (const root of config.artifactRoots) {
    const directory = fs.realpathSync(root);
    if (resolved === directory || resolved.startsWith(directory + path.sep))
      throw Error("configuration_inside_artifacts");
  }
  return config;
}
