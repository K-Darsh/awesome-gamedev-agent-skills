// pack_city_02/build.gradle.kts — copy next to each pack's src/ folder.
// The plugin ships with the Android Gradle Plugin; no extra dependency is required.
plugins {
    id("com.android.asset-pack")
}

assetPack {
    packName.set("pack_city_02")
    // install-time | fast-follow | on-demand
    dynamicDelivery {
        deliveryType.set("fast-follow")
    }
}
