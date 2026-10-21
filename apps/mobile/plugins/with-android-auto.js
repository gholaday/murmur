const fs = require("fs");
const path = require("path");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

// Lists Murmur as a media app in Android Auto. expo-audio's playback service is patched into a
// MediaLibraryService (patches/expo-audio@58.0.9.patch); Auto finds it through these intent
// filters, needs it exported to bind to it, and reads automotive_app_desc to know it's a media app.

const SERVICE = "expo.modules.audio.service.AudioControlsService";
const ACTIONS = [
  "androidx.media3.session.MediaSessionService",
  "androidx.media3.session.MediaLibraryService",
  "android.media.browse.MediaBrowserService",
];
const DESC_XML = `<?xml version="1.0" encoding="utf-8"?>
<automotiveApp>
  <uses name="media" />
</automotiveApp>
`;

function withAutoManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.service = app.service ?? [];
    let service = app.service.find((s) => s.$?.["android:name"] === SERVICE);
    if (!service) {
      service = { $: { "android:name": SERVICE, "android:foregroundServiceType": "mediaPlayback" } };
      app.service.push(service);
    }
    service.$["android:exported"] = "true";
    service["intent-filter"] = [{ action: ACTIONS.map((name) => ({ $: { "android:name": name } })) }];

    app["meta-data"] = (app["meta-data"] ?? []).filter((m) => m.$?.["android:name"] !== "com.google.android.gms.car.application");
    app["meta-data"].push({ $: { "android:name": "com.google.android.gms.car.application", "android:resource": "@xml/automotive_app_desc" } });
    return cfg;
  });
}

function withAutoDescription(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "automotive_app_desc.xml"), DESC_XML);
      return cfg;
    },
  ]);
}

module.exports = function withAndroidAuto(config) {
  return withAutoDescription(withAutoManifest(config));
};
