# 智学方舟 Android App

## 开发调试

1. 在 Next.js 服务端配置 `AUTH_MODE=multi`、PostgreSQL 和默认 AI 模型。
2. 将 `.env.example` 复制为 `.env`。把 `EXPO_PUBLIC_API_URL` 设置为手机能访问的 Next.js 根地址，例如 `https://smartlearn.example.com`。
3. 在 `mobile` 目录依次运行 `npm ci` 和 `npm start`。用兼容 Expo SDK 54 的 Android Expo Go 扫码。已连接模拟器或 USB 调试设备时，可以运行 `npm run android`。

用网页账号登录后，在「学习」里输入目标生成第一节。提交随堂练习后可继续下一节。网页端同账号的资源库会显示这些资源，标记为「来自学习路径」。

标准 PPTX 通过系统分享打开，教学视频通过系统浏览器打开。

## Android 打包

配置 JDK 17、Android SDK Platform 36、Build Tools 36.0.0 和 NDK 27.1.12297006。使用目标服务器的 `EXPO_PUBLIC_API_URL` 配置执行以下命令。

```powershell
npx expo prebuild --platform android
Set-Location android
java -cp './gradle/wrapper/gradle-wrapper.jar' org.gradle.wrapper.GradleWrapperMain assembleRelease
```

本地试装包位于 `android/app/build/outputs/apk/release/app-release.apk`。正式分发前使用项目的发布密钥对 APK 签名。
