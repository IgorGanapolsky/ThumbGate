plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.3.0"
    id("org.jetbrains.intellij.platform")
}

group = "ai.thumbgate"
version = "1.16.22"

kotlin {
    jvmToolchain(17)
}

intellijPlatform {
    pluginConfiguration {
        name = "ThumbGate"
        ideaVersion {
            sinceBuild = "243"
        }
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2024.3")
        bundledPlugin("com.intellij.java")
    }
}
