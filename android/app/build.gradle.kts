plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.facebook.react")
}
react {
    // Gradle's rootProject is the repository root (not an /android folder).
    // Point RNGP explicitly at the React Native project root and its packages.
    root.set(layout.projectDirectory.dir(".."))
    reactNativeDir.set(layout.projectDirectory.dir("../node_modules/react-native"))
    codegenDir.set(layout.projectDirectory.dir("../node_modules/@react-native/codegen"))
    cliFile.set(layout.projectDirectory.file("../node_modules/react-native/cli.js"))
    // This app registers its own QuazyPackage directly in QuazyApplication.
    debuggableVariants = emptyList()
}
android {
    namespace = "com.quazy.ai"
    compileSdk = 36
    ndkVersion = "27.2.12479018"
    defaultConfig {
        applicationId = "com.quazy.ai"
        minSdk = 28
        targetSdk = 36
        versionCode = 2
        versionName = "0.2.0"
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
            isMinifyEnabled = false
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
