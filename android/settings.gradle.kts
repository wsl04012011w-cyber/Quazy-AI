pluginManagement {
    includeBuild("../node_modules/@react-native/gradle-plugin")
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("com.facebook.react.settings")
}

extensions.configure<com.facebook.react.ReactSettingsExtension> {
    autolinkLibrariesFromCommand()
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_PROJECT)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "QuazyAI"
include(":app")
includeBuild("../node_modules/@react-native/gradle-plugin")
