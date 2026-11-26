// settings.gradle.kts — one asset-pack module per city area or content family.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "neon-coast"
include(":app")
include(":pack_city_02")   // fast-follow
include(":pack_audio")     // on-demand
