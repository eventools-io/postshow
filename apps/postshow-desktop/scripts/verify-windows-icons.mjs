import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit';

const [iconPath, ...executablePaths] = process.argv.slice(2);
if (!iconPath || executablePaths.length === 0) {
  throw new Error('usage: verify-windows-icons <generated.ico> <application.exe> [...]');
}

function itemBytes(item) {
  return Buffer.from(item.isRaw() ? item.bin : item.generate());
}

function signature(item, declared = {}) {
  // ICO encodes 256px as zero in its one-byte width/height fields. Prefer a
  // positive declaration, otherwise use the decoded image dimensions.
  const encodedWidth = declared.width ?? item.width ?? item.bitmapInfo?.width;
  const encodedHeight = declared.height ?? item.height ?? item.bitmapInfo?.height;
  const width = encodedWidth === 0 ? 256 : encodedWidth;
  const height = encodedHeight === 0 ? 256 : encodedHeight;
  const bitCount = declared.bitCount ?? item.bitCount ?? item.bitmapInfo?.bitCount;
  return [
    Number(width),
    Number(height),
    Number(bitCount),
    createHash('sha256').update(itemBytes(item)).digest('hex'),
  ].join(':');
}

const iconFile = Data.IconFile.from(readFileSync(iconPath));
const expected = iconFile.icons.map((entry) => signature(entry.data, entry)).sort();
if (expected.length < 5 || !expected.some((entry) => entry.startsWith('256:256:'))) {
  throw new Error(`${iconPath} does not contain the required multi-resolution Windows icon`);
}

for (const executablePath of executablePaths) {
  const executable = NtExecutable.from(readFileSync(executablePath), { ignoreCert: true });
  const resources = NtExecutableResource.from(executable);
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  const matched = groups.some((group) => {
    const items = group.getIconItemsFromEntries(resources.entries);
    const actual = items.map((item, index) => signature(item, group.icons[index])).sort();
    return (
      actual.length === expected.length && actual.every((value, index) => value === expected[index])
    );
  });
  if (!matched) {
    throw new Error(`${executablePath} does not embed the exact generated Postshow icon set`);
  }
  process.stdout.write(`verified embedded Windows icon: ${executablePath}\n`);
}
