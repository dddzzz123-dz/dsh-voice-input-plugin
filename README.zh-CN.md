# DSH 语音输入插件

[English README](README.md)

这是一个用于 DeepSeek Harness（DSH）Web UI 的 Cordis 插件。它会在对话输入框旁边增加语音输入按钮，支持浏览器实时识别和可选的云端高准确率 ASR，并把结果写入当前输入草稿。

## 功能

- 支持连续语音输入，适合长段口述。
- 支持手动切换中文 / 英文识别（`zh-CN` / `en-US`）。
- 支持实时临时识别结果，边说边写入输入框草稿。
- 录音过程中手动删除或修改的文字以用户编辑为准，最终识别事件不会把旧文字重新填回来。
- 浏览器因为停顿自动结束识别后，插件会尽量自动重启。
- 使用五段式动态音量条显示当前收音状态。
- 使用接近 DSH 界面风格的内联 SVG 麦克风和停止图标，不使用 emoji。
- 可选接入 SiliconFlow 高准确率云端语音转写。
- 火山引擎控制台中的三种 ASR 服务都可选择：流式语音识别、录音文件识别 1.0、录音文件识别 2.0。
- 火山模式通过 DSH Host 私有 RPC 和本地代理调用，绕过浏览器 CORS 限制，凭证不会出现在命令行或源码中。

## 环境要求

- DeepSeek Harness / DSH，并且当前环境支持 Cordis 动态插件。
- 一个 DSH `cordis` / 创造模式会话，用来安装插件。
- Chrome 或 Edge 浏览器。插件依赖浏览器 Web Speech API：
  - `SpeechRecognition` / `webkitSpeechRecognition`
  - `navigator.mediaDevices.getUserMedia`
  - `AudioContext` / `webkitAudioContext`

Firefox 和 Safari 目前不支持本插件使用的 Web Speech 语音识别能力。

SiliconFlow 模式还需要浏览器支持 `MediaRecorder`，并会调用其
`/v1/audio/transcriptions` 接口。火山模式通过 `AudioContext` 编码 16 kHz
单声道 PCM WAV，并要求 DSH Host 提供 `shell` 服务和本地 Node.js。

## 在 DSH 中安装

### Web Profile 持久安装（推荐）

当前实际使用的版本分成 Host 插件和浏览器 Client 包：

```text
host.mjs                  Host 路由与火山引擎代理
pkg/package.json          DSH 本地 Client 包清单
pkg/lib/client.js         输入框界面
pkg/lib/index.js          包入口
```

1. 把本仓库放在一个不会变动的目录。
2. 把 `pkg/` 复制到 Web Profile 的包目录：

   ```text
   <DSH_HOME>/profiles/web/node_modules/@local/dsh-voice-input
   ```

3. 在 `<DSH_HOME>/profiles/web/cordis.patch.yml` 中加入 Host 和 Client：

   ```yaml
   - insert:
       - id: voice-input-host
         name: 'file:///语音插件绝对路径/host.mjs'
       - id: voice-input-client
         name: '@local/dsh-voice-input'
   ```

4. 重启 DSH Web，再刷新浏览器页面。

Windows 上，DSH 的 ACL 沙箱要求启动时的 `TEMP`、`TMP` 位于工作区之外。
例如可以使用 `D:\DSHTemp`，不要使用工作区内部的 `.tmp`。否则云端转写
会在代理进程启动之前失败。

### 创造模式临时安装（旧方式）

打开一个 DSH 创造模式会话，然后执行：

1. 检查输入框右侧插槽：

   ```text
   cordis_inspect: what = client, name = conversation.input.right
   ```

2. 定义插件，同时提供 Host 和 Client 两份代码：

   ```text
   cordis_define:
     name: voice-input
     purpose: Add continuous voice dictation to the DSH composer.
     code:
       host: <完整 code.host.js 内容>
       client: <完整 code.client.js 内容>
   ```

3. 运行返回的插件 / package：

   ```text
   cordis_run: <返回的 plugin/package id>
   ```

创造模式插件会下发到已打开的 DSH Web UI 页面，但不建议作为长期持久部署。
如果按钮没有立刻出现，可以刷新 Web UI。

## 使用方法

- 点击麦克风按钮开始收音。
- 再次点击按钮停止收音。
- 点击 `中` / `EN` 按钮手动切换识别语言。
- 点击设置按钮，可在“浏览器实时”、“硅基流动”和“火山 ASR”之间切换。
- 云端模式需要填写 SiliconFlow API Key，可选择 `FunAudioLLM/SenseVoiceSmall` 或 `TeleAI/TeleSpeechASR`。
- 火山模式可填写新版控制台 API Key，或旧版 App ID + Access Token，并提供以下服务选项：
  - `Doubao-流式语音识别`：`volc.seedasr.sauc.duration`，界面标价 4.5 元/小时。
  - `Doubao-录音文件识别`：`volc.bigasr.auc`，界面标价 2.3 元/小时。
  - `Doubao-录音文件识别 2.0`：`volc.seedasr.auc`，界面标价 0.8 元/小时。
- 收音时按钮会展开，并显示五段红色动态音量条。
- 识别出的文字会写入当前输入框草稿，确认后正常发送即可。

凭证只保存在当前标签页的 `sessionStorage`，不会写进源码或 GitHub。
火山凭证只在单次请求时通过插件包内私有 Host RPC 传递，再经子进程临时环境变量使用，
不会写入磁盘或命令行。建议使用单独创建且设置额度限制的凭证，不要与他人共享。

## 已知限制

- Web Speech API 的表现取决于浏览器和网络环境。
- 浏览器会自行决定静音超时和单段识别长度。插件会在 `end` 事件后尝试重启，但不能把单次浏览器识别会话变成真正无限。
- 浏览器实时模式保留识别服务返回的原始文本，不再添加启发式标点。需要语义标点和更高准确率时请使用云端模式。
- 云端模式会在停止录音后返回整段文字，不提供浏览器实时模式那样的临时文本预览。
- 流式选项调用官方 WebSocket 协议，但当前 DSH JSON 桥会在停止录音后提交已捕获的整段音频，暂时不会在说话过程中显示远端临时结果。
- 录音文件 1.0 和 2.0 使用官方 submit/query 轮询流程；插件内建议单段录音不超过约 8 分钟。
- 同一 DSH 页面来源中的其他脚本理论上可以访问浏览器端 Key，因此请使用独立且有限额的 Key。
- Chrome 可能会把语音识别请求交给 Google 服务；Edge 可能会交给 Microsoft / Azure 服务。
- 音量条依赖 `getUserMedia`。如果浏览器拒绝麦克风音量采集，语音识别仍可能工作，但音量条会退回到 SpeechRecognition 的 sound/speech 事件反馈。

## 许可证

MIT

## 服务文档

- [火山引擎大模型流式语音识别 API](https://www.volcengine.com/docs/6561/1354869?lang=zh)
- [火山引擎 ASR 产品页](https://www.volcengine.com/product/asr)
