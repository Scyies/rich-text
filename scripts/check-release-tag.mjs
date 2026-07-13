import { readFile } from "node:fs/promises";

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const refType = process.env.GITHUB_REF_TYPE;
const refName = process.env.GITHUB_REF_NAME;
if (refType === "tag" && refName !== `v${version}`) {
  console.error(`Release tag ${refName} does not match package version v${version}`);
  process.exit(1);
}
console.log(refType === "tag" ? `Release tag matches v${version}.` : "No release tag to validate.");
