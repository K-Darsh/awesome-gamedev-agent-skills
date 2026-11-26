# Android Play Asset Delivery

Contents: the limits that decide scope · App Bundle rules and API level · Play Asset Delivery modes
· Gradle module and manifest · bundletool and local testing · background download UX · texture
compression splits · compliance checklist · the 9 GB question.

Verified 2026-11-26 against Play Console help and Android developer documentation. Numbers change;
re-check before an upload.

## The limits that decide scope

| Limit | Value |
|---|---|
| Base module (APK/AAB) | 200 MB compressed |
| Feature module | 200 MB |
| Single asset pack | 1.5 GB |
| Install-time asset packs, cumulative | 4 GB |
| Fast-follow + on-demand packs, cumulative | 4 GB (30 GB for Level Up / Android XR titles) |
| Asset packs per app | 100 |
| Legacy APK install limit | 100 MB (AAB is required above that) |
| Apps over 1 GB | minSdk 21 or higher |

So a standard release can ship 200 MB of code plus 4 GB installed packs plus 4 GB downloaded
packs: 8 GB in total, not 9 GB. Reaching 9 GB means enrolling in Play's Level Up program (30 GB of
downloadable packs) or cutting content. Check eligibility with the account team before designing
around it.

## App Bundle rules and API level

- Ship an `.aab`, not an APK. Play generates split APKs per device (ABI, density, language) and the
  reported download size is the split, not the bundle.
- New apps and updates on phones, tablets and foldables must target Android 16 (API 36) since
  2026-08-31. Existing apps must target API 35 to stay discoverable. Wear and Automotive require
  35; TV and XR require 34.
- Declare `android:exported` explicitly on every component with an intent filter.
- Provide 64-bit ABIs; arm64-v8a is the baseline for a 3D game. Keep armeabi-v7a only if the
  analytics say you must, and expect the texture/lighting budget to halve there.
- Sign with Play App Signing; keep the upload key out of the repo.

## Play Asset Delivery modes

| Mode | Installed | Use for |
|---|---|---|
| `install-time` | at install | core city tiles, UI fonts, first district, shared materials |
| `fast-follow` | automatically after install | second and third districts, common vehicles, radio defaults |
| `on-demand` | when the game asks | airports, airport vehicles, late-game interiors, 4K hero cars |

Practical split for a city game:

```text
base (code + UI + shaders + district 01)      ~120 MB
pack_city_02  fast-follow                      ~700 MB
pack_city_03  fast-follow                      ~700 MB
pack_vehicles fast-follow                      ~450 MB
pack_audio    on-demand (radio + barks)        ~300 MB
pack_airport  on-demand                        ~500 MB
```

Total download for a first session stays under about 2.5 GB, and the player can start while the
rest arrives.

## Gradle module and manifest

Use the `com.android.asset-pack` plugin and declare it in `settings.gradle.kts`:

```kotlin
// settings.gradle.kts
include(":app")
include(":pack_city_02")
```

```kotlin
// pack_city_02/build.gradle.kts
plugins { id("com.android.asset-pack") }
assetPack {
    packName.set("pack_city_02")
    dynamicDelivery { deliveryType.set("fast-follow") }
}
```

```xml
<!-- pack_city_02/src/main/AndroidManifest.xml -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.city.pack.city02">
    <application android:hasCode="false" />
</manifest>
```

Content lives in `pack_city_02/src/main/assets/city/02/…`. For Unity, put the same structure under
the module's assets and set the pack name in the Asset Pack settings; Unreal needs `ChunkDownload`
IDs (`0` install-time, `1` fast-follow, `2` on-demand) and a ChunkDownload manifest in the build.

See `assets/play-asset-delivery/` for copy-ready snippets of all four files.

## bundletool and local testing

```bash
# build the bundle
./gradlew bundleRelease

# generate a device-specific APK set and install it
bundletool build-apks --bundle=app/build/outputs/bundle/release/app-release.aab \
  --output=city.apks --ks=upload.jks --ks-key-alias=upload
bundletool install-apks --apks=city.apks

# check delivery modes and sizes without a device
bundletool get-size total --apks=city.apks --dimensions=SDK,ABI
```

Test the flows that fail in the field: first install with a 4G connection interrupted mid-pack, an
install completed later from a download-only network, and a return visit after an app update that
replaced a pack.

## Background download UX

- Ask for Wi-Fi consent before any pack over 200 MB on mobile data; Play shows a system dialog for
  large installs, but your own UI should still explain what is downloading and why.
- Use `AssetPackManager` (or Unity's `PlayAssetPackManager` wrapper) and show real progress, plus a
  "continue in the base city" button that drops the player into district 01.
- Handle `ASSET_PACK_ALREADY_EXIST`, `DOWNLOAD_CANCELLED`, `NETWORK_ERROR` and
  `INSUFFICIENT_STORAGE` explicitly, with a retry and a free-space check before starting.
- Verify pack presence on launch; a pack can be evicted by the system under storage pressure. Fall
  back to a valid location instead of a black screen.
- Never make a store purchase depend on a pack that is not installed yet.

## Texture compression splits

Ship ASTC for arm64 (the default on Play since 2021) and, only if measured necessary, ETC2 for older
devices. Use `textureCompression` splits in the bundle config:

```json
{ "compression": [{ "format": "ASTC", "textureCompression": [{ "glTextureCompression": "INDIVIDUAL" }] }] }
```

ASTC 4×4-6×6 for hero assets, 8×8 for props, power-of-two textures, mipmaps on, no read/write. A
compressed pack download is typically 35-55 % of the raw PNG/TGA source; measure it from the
Console report, not the asset folder.

## Compliance checklist

Before upload:

1. `targetSdk 36`, `minSdk 24` or higher, 64-bit ABI present, `android:exported` on all exported
   components, no cleartext traffic.
2. Content rating questionnaire reflects the actual content: crime, weapons, mild language, no
   sexual content, no real brands or licensed music, no simulated gambling.
3. Data safety form: local save data is stored on device; declare any analytics, crash reporting or
   cloud sync, and declare the account requirement (none for a single-player game).
4. No ads for loot boxes or paid cheats; no real-money gambling; no external links to purchases
   that bypass Play billing.
5. Permissions minimal: no `READ_EXTERNAL_STORAGE`, no location, no phone state. Vibration is
   optional.
6. Offline: the game starts and saves without a network. Any download is content, not a login.
7. Store listing: real screenshots from a device, a size note ("~1.8 GB, on-demand packs"), and no
   promise of 120 fps on devices that cannot hold it.
8. Privacy policy URL if any data leaves the device, including crash logs.

## The 9 GB question

If the request is a 9 GB game, answer it in one paragraph: the standard Play ceiling is 8 GB
(200 MB base + 4 GB install-time + 4 GB downloaded), a single pack caps at 1.5 GB, and 30 GB is
reserved for Level Up / Android XR titles. Then offer the three honest routes — enrol and verify
eligibility, ship a 4-6 GB slice with on-demand districts, or cut resolution and audio bitrate to
land under 8 GB — and put the chosen route in the budget manifest. Never tell a player or a client
that a 9 GB APK can be produced; APKs above 100 MB are not installable through Play at all.
