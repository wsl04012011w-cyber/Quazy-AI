plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.facebook.react")
}

val releaseStoreFile = providers.environmentVariable("QUAZY_RELEASE_STORE_FILE").orNull
val releaseStorePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").orNull
val releaseKeyAlias = providers.environmentVariable("ANDROID_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("ANDROID_KEY_PASSWORD").orNull
val hasPersistentReleaseKey = listOf(
    releaseStoreFile, releaseStorePassword, releaseKeyAlias, releaseKeyPassword
).all { !it.isNullOrBlank() }

react {
    // Gradle's rootProject is the repository root (not an /android folder).
    root.set(layout.projectDirectory.dir("../.."))
    reactNativeDir.set(layout.projectDirectory.dir("../../node_modules/react-native"))
    codegenDir.set(layout.projectDirectory.dir("../../node_modules/@react-native/codegen"))
    cliFile.set(layout.projectDirectory.file("../../node_modules/react-native/cli.js"))
    // The production APK bundles JS and does not need Metro DevSupport.
    debuggableVariants = emptyList()
}

android {
    namespace = "com.quazy.ai"
    compileSdk = 36
    ndkVersion = "27.2.12479018"

    signingConfigs {
        create("quazyRelease") {
            if (hasPersistentReleaseKey) {
                storeFile = file(requireNotNull(releaseStoreFile))
                storePassword = requireNotNull(releaseStorePassword)
                keyAlias = requireNotNull(releaseKeyAlias)
                keyPassword = requireNotNull(releaseKeyPassword)
            }
        }
    }

    defaultConfig {
        applicationId = "com.quazy.ai"
        minSdk = 28
        targetSdk = 36
        versionCode = providers.gradleProperty("quazyVersionCode").orNull?.toIntOrNull() ?: 3
        versionName = "0.3.0"
        ndk { abiFilters += listOf("arm64-v8a") }
        externalNativeBuild {
            cmake {
                cppFlags += listOf("-std=c++17")
                arguments += listOf("-DANDROID_STL=c++_shared")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isDebuggable = false
            isMinifyEnabled = false
            signingConfig = if (hasPersistentReleaseKey) {
                signingConfigs.getByName("quazyRelease")
            } else {
                // CI fallback: signed with the runner's temporary Android debug key.
                // Add the four GitHub Actions secrets to obtain a stable release identity.
                signingConfigs.getByName("debug")
            }
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.31.6"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
    packaging { jniLibs { useLegacyPackaging = true } }
}

dependencies {
    implementation("com.facebook.react:react-android")
    if (providers.gradleProperty("hermesEnabled").orNull == "true") {
        implementation("com.facebook.react:hermes-android")
    }
}
