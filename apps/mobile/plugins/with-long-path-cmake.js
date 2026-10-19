const { withProjectBuildGradle } = require("expo/config-plugins");

// pnpm's long folder names put native libraries' CMake build files past Windows' 260
// character limit. The Android SDK's default CMake (3.22) ships a ninja that can't open
// such paths, so the build loops ("build.ninja still dirty after 100 tries"). CMake 3.31's
// ninja handles long paths (Windows long paths must be enabled). Install it into the SDK
// first: sdkmanager "cmake;3.31.6". Only Windows needs this, so other machines (EAS's
// Linux builders included) keep the default CMake.

const CMAKE_VERSION = "3.31.6";
const MARKER = "// murmur: CMake with long path support";

const SNIPPET = `${MARKER}
subprojects { sub ->
  ["com.android.library", "com.android.application"].each { id ->
    sub.plugins.withId(id) {
      sub.android.externalNativeBuild.cmake.version = "${CMAKE_VERSION}"
    }
  }
}`;

module.exports = function withLongPathCmake(config) {
  if (process.platform !== "win32") return config;
  return withProjectBuildGradle(config, (cfg) => {
    const gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;
    // Before the React Native root plugin, which configures the libraries as soon as it's applied.
    const anchor = 'apply plugin: "expo-root-project"';
    cfg.modResults.contents = gradle.includes(anchor) ? gradle.replace(anchor, `${SNIPPET}\n\n${anchor}`) : `${gradle}\n${SNIPPET}\n`;
    return cfg;
  });
};
