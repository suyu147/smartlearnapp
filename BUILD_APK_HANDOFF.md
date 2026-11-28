# 移动端 APK 打包交接文档

> 生成时间：2026-11-28
> 用途：项目目录改名为英文后，新会话读取本文件即可恢复上下文，继续完成 APK 打包。

---

## 一、目标

把 `mobile/` 目录下的 Expo 应用打包成可安装的 Android APK（release）。

技术栈：Expo SDK 54 / React Native 0.81.5 / Expo Router 6 / Hermes / 新架构（newArchEnabled=true），`mobile/android` 已通过 `expo prebuild` 生成。

---

## 二、当前进度

| 阶段 | 状态 |
|---|---|
| 环境准备（SDK / JDK / Gradle） | ✅ 完成 |
| Gradle 配置阶段 | ✅ 通过 |
| Kotlin / Java 编译 | ✅ 通过 |
| C++ 原生编译 | ❌ 失败：CMake 预编译头（PCH）无法处理中文路径 |
| 生成 APK | ⬜ 未完成 |

最后一次构建日志关键错误：

```text
fatal error: cannot open file
'E:/<D6><C7>学<B7><BD><D6><DB>app/.../src/main/cpp/ExpoHeader.pch':
unspecified system_category error
```

原因：绝对路径 `E:\智学方舟app\smartlearn-master` 含中文，CMake 生成的 PCH 头文件路径被按 GBK 写入，clang 读不到。

结论：**必须把整个项目移动到纯英文路径**（父目录 `智学方舟app` 也要改），例如 `E:\projects\smartlearn-master`。

---

## 三、已完成的环境配置（与项目目录无关，改名后仍有效）

1. **cmdline-tools**：`F:\androidsdk\cmdline-tools\latest\`（版本 22.0）
   - 注意：最初被解压到了 `cmdline-tools\` 根目录，已把 `bin`、`lib`、`NOTICE.txt`、`source.properties` 移入 `latest\`。
2. **Android SDK 组件**（已安装）：
   - `platforms;android-36`
   - `ndk;27.1.12297006`
   - `build-tools;35.0.0`（`react-native-safe-area-context` 需要）
   - 环境变量 `ANDROID_HOME=F:\androidsdk`
3. **JDK 17**：`C:\Users\lenovo\jdks\jdk-17.0.2`（华为云镜像下载的 OpenJDK 17.0.2）
   - Expo 的 Gradle 插件强制要求 JDK 17，机器自带的 JDK 18/11 不满足。
4. **Gradle 8.14.3**：已缓存到 `C:\Users\lenovo\.gradle\wrapper\dists\gradle-8.14.3-bin\`（腾讯云镜像手动下载）。

---

## 四、已修改的项目文件（改名后会一起保留，不要回滚）

### 1. `mobile/package.json`

新增显式依赖，避免 npm 把 `expo-font` 提升成不兼容的 58.x：

```json
"expo-font": "~14.0.12",
```

背景：`@expo/vector-icons` 的 peer 依赖是 `expo-font >=14.0.4`，npm 曾安装 `expo-font@58.0.12` 到根目录；其 `expo-module.config.json` 的 `publication` 缺 `version` 字段，导致 Gradle 报错：

> Field 'version' is required ... at path: $.modules[6].projects[0].publication

### 2. `mobile/android/gradle.properties`

文件末尾新增：

```properties
# 项目路径包含中文，跳过 AGP 的 ASCII 路径检查
android.overridePathCheck=true

# 在 Gradle 进程内编译 Kotlin，避免 Kotlin 守护进程写入受限目录
kotlin.compiler.execution.strategy=in-process
```

- 第 1 项解决：`Your project path contains non-ASCII characters`
- 第 2 项解决：Agent 沙箱拦截 `C:\Users\lenovo\AppData\Local\kotlin\daemon`；改用英文路径后此项可保留，也可删除。

### 3. `mobile/android/gradlew.bat` 第 77 行

删除 `-classpath "%CLASSPATH%"`，因为脚本把 `CLASSPATH` 置空，导致 Java 报：

> Error: -classpath requires class path specification

修改后：

```bat
"%JAVA_EXE%" %DEFAULT_JVM_OPTS% %JAVA_OPTS% %GRADLE_OPTS% "-Dorg.gradle.appname=%APP_BASE_NAME%" -jar "%APP_HOME%\gradle\wrapper\gradle-wrapper.jar" %*
```

---

## 五、改名后的必做步骤

1. 关闭 IDE、终端、所有 Java 进程：

```powershell
cd <旧路径>\mobile\android
.\gradlew.bat --stop
```

2. 迁移目录，例如：

```
E:\智学方舟app\smartlearn-master  →  E:\projects\smartlearn-master
```

3. **删除嵌入旧绝对路径的原生构建缓存**（必须，`node_modules` 不用重装）：

- `mobile\android\.gradle`
- `mobile\android\build`
- `mobile\android\app\.cxx`
- `mobile\node_modules\expo-modules-core\android\.cxx`
- 其他 `mobile\node_modules\*\android\.cxx`
- 其他 `mobile\node_modules\*\android\build`（可选，保险起见）

```powershell
Get-ChildItem -Path .\mobile\node_modules -Recurse -Directory -Filter ".cxx" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
Remove-Item -Recurse -Force .\mobile\android\.gradle, .\mobile\android\build, .\mobile\android\app\.cxx -ErrorAction SilentlyContinue
```

4. 在新路径下重新打开项目，执行构建：

```powershell
cd <新路径>\mobile\android
$env:JAVA_HOME="C:\Users\lenovo\jdks\jdk-17.0.2"
$env:GRADLE_OPTS="-Dfile.encoding=UTF-8"
.\gradlew.bat assembleRelease
```

> `-Dfile.encoding=UTF-8` 必须保留：JDK 17 在中文 Windows 下默认 GBK，会把 `settings.gradle` 中 node 输出的 UTF-8 路径解码错，报“Included build ... does not exist”。

5. APK 产物：

```
mobile\android\app\build\outputs\apk\release\app-release.apk
```

---

## 六、打包相关注意事项

1. **签名**：`mobile/android/app/build.gradle` 的 release 复用了 `debug.keystore`（`signingConfig signingConfigs.debug`）。产出的 APK 可自测安装，但不适合正式分发；正式发布需生成自己的 keystore 并配置 `signingConfigs.release`。
2. **API 地址**：`mobile/.env` 当前为
   ```
   EXPO_PUBLIC_API_URL=http://10.27.63.247:3000
   ```
   这是局域网地址，只有手机与服务器同网段才能登录。对外分发前需改为公网可达的 https 地址并重新打包。
3. **包体积**：`mobile/android/gradle.properties` 中 `reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64`，四种 ABI 全打。只给真机用时可在命令后加 `-PreactNativeArchitectures=arm64-v8a` 减小体积。
4. **Agent 沙箱限制**：Agent 执行命令时无法写入 `F:\androidsdk`、`C:\Users\lenovo\jdks`、`C:\Users\lenovo\AppData\Local\kotlin` 等目录，因此这类安装/构建要么由用户在本地终端执行，要么在 Trae 设置中把路径加入 `resourceAuthorization.filesystem.readWrite`。

---

## 七、本次会话的其他讨论（与打包无关，供追溯）

1. **学习路径阶段化**：用户希望把现有“节点式学习路径”改造成图片中的“阶段 → 任务”两级结构（阶段状态：已完成 / 进行中 / 未解锁；任务进度百分比；阶段完成自动解锁下一阶段）。
   - 图片原型对应 `mobile-app.html` 中的静态硬编码（约 871–907 行）。
   - 真实业务在 `components/learning-path/`、`lib/types/learning-path.ts`、`lib/store/learning-path.ts`、`prisma/schema.prisma` 的 `LearningPath`。
   - 结论：需要新增 Phase 聚合层与阶段级解锁门控，尚未开始改造。

2. **React 重复 key 报错**（`Encountered two children with the same key ... 章节id`）：
   - 根因：`lib/learning-graph/helpers/resource-generators.ts` 第 96 行给模型的 JSON 示例使用占位符 `"id":"章节id"`，模型照抄导致多个 section 的 id 相同。
   - 渲染侧 `mobile/src/ResourceView.tsx` 第 64 行用 `key={section.id}`，`components/resources/document-viewer.tsx` 第 194 行同样有隐患。
   - 建议（未实施）：服务端解析后重排 id、修改提示词示例、渲染侧兜底使用 index。

---

## 八、新会话恢复方式

在新目录打开项目后，对 AI 说：

> 请阅读 `BUILD_APK_HANDOFF.md`，按第五节的步骤继续打包 APK。
