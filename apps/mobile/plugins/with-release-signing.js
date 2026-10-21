const { withAppBuildGradle } = require("expo/config-plugins");

// Signs release builds with Murmur's own key when MURMUR_KEYSTORE points at it, as the
// release workflow does from its secrets. Every update has to be signed with that same key,
// or Android refuses to install it over the app. Without the variable, release builds keep
// the debug key, so local builds work with no setup.
//   MURMUR_KEYSTORE           path to the .jks file
//   MURMUR_KEYSTORE_PASSWORD  its password
//   MURMUR_KEY_ALIAS          the key's alias
//   MURMUR_KEY_PASSWORD       the key's password

const MARKER = "// murmur: release signing";

const SIGNING = `        ${MARKER}
        release {
            if (System.getenv("MURMUR_KEYSTORE")) {
                storeFile file(System.getenv("MURMUR_KEYSTORE"))
                storePassword System.getenv("MURMUR_KEYSTORE_PASSWORD")
                keyAlias System.getenv("MURMUR_KEY_ALIAS")
                keyPassword System.getenv("MURMUR_KEY_PASSWORD")
            }
        }
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;
    const configs = "signingConfigs {\n";
    const release = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!gradle.includes(configs) || !release.test(gradle)) {
      throw new Error("with-release-signing: app/build.gradle no longer has the expected signing setup");
    }
    gradle = gradle.replace(configs, `${configs}${SIGNING}`);
    gradle = gradle.replace(
      release,
      '$1signingConfig System.getenv("MURMUR_KEYSTORE") ? signingConfigs.release : signingConfigs.debug',
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
