const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("expo/config-plugins");

// The Gradle wrapper downloads Gradle itself on a first build. Pinning the zip's SHA-256 makes
// it refuse a download that isn't the real one. Prebuild writes gradle-wrapper.properties fresh,
// so the sum is added here. A new Gradle version needs its sum from
// https://gradle.org/release-checksums/ (the "Binary-only (-bin) ZIP" line) added below.

const CHECKSUMS = {
  "gradle-9.4.1-bin.zip": "2ab2958f2a1e51120c326cad6f385153bb11ee93b3c216c5fccebfdfbb7ec6cb",
};

module.exports = function withGradleChecksum(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, "gradle", "wrapper", "gradle-wrapper.properties");
      const props = fs.readFileSync(file, "utf8");
      const zip = props.match(/^distributionUrl=.*\/([^/\s]+)$/m)?.[1];
      const sum = zip && CHECKSUMS[zip];
      if (!sum) throw new Error(`with-gradle-checksum: no SHA-256 for ${zip ?? "the wrapper's Gradle"}. Add it to plugins/with-gradle-checksum.js.`);
      const line = `distributionSha256Sum=${sum}`;
      const next = /^distributionSha256Sum=.*$/m.test(props) ? props.replace(/^distributionSha256Sum=.*$/m, line) : `${props.trimEnd()}\n${line}\n`;
      fs.writeFileSync(file, next);
      return cfg;
    },
  ]);
};
