# Play Asset Delivery snippets

Copy these into an Android project and rename the pack to match the manifest:

- `settings.gradle.kts` — include one module per pack.
- `build.gradle.kts` — the `com.android.asset-pack` plugin, pack name and delivery type.
- `AndroidManifest.xml` — a pack module has no code.
- `gradle.properties` — signing and bundle settings that affect size and delivery.

Content lives in `<pack>/src/main/assets/<area>/…`. Verify with:

```bash
./gradlew bundleRelease
bundletool build-apks --bundle=app/build/outputs/bundle/release/app-release.aab --output=city.apks
bundletool get-size total --apks=city.apks --dimensions=SDK,ABI
```

Then check the project's content manifest with `scripts/check_ship_budgets.py`.
