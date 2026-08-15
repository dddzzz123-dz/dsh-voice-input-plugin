# DSH 语音输入插件

[English README](README.md)

这是一个用于 DeepSeek Harness（DSH）Web UI 的客户端 Cordis 插件。它会在对话输入框旁边增加语音输入按钮，让你可以连续语音转文字，并把识别结果写入当前输入草稿。

## 功能

- 支持连续语音输入，适合长段口述。
- 支持手动切换中文 / 英文识别（`zh-CN` / `en-US`）。
- 支持实时临时识别结果，边说边写入输入框草稿。
- 浏览器因为停顿自动结束识别后，插件会尽量自动重启。
- 使用五段式动态音量条显示当前收音状态。
- 使用接近 DSH 界面风格的内联 SVG 麦克风和停止图标，不使用 emoji。
- 纯客户端实现，不需要后端服务，也不需要 API key。

## 环境要求

- DeepSeek Harness / DSH，并且当前环境支持 Cordis 动态插件。
- 一个 DSH `cordis` / 创造模式会话，用来安装插件。
- Chrome 或 Edge 浏览器。插件依赖浏览器 Web Speech API：
  - `SpeechRecognition` / `webkitSpeechRecognition`
  - `navigator.mediaDevices.getUserMedia`
  - `AudioContext` / `webkitAudioContext`

Firefox 和 Safari 目前不支持本插件使用的 Web Speech 语音识别能力。

## 在 DSH 中安装

打开一个 DSH 创造模式会话，然后执行：

1. 检查输入框右侧插槽：

   ```text
   cordis_inspect: what = client, name = conversation.input.right
   ```

2. 定义插件，把 `code.client` 设置为 `code.client.js` 的完整内容：

   ```text
   cordis_define:
     name: voice-input
     purpose: Add continuous voice dictation to the DSH composer.
     code:
       client: <完整 code.client.js 内容>
   ```

3. 运行返回的插件 / package：

   ```text
   cordis_run: <返回的 plugin/package id>
   ```

插件会下发到已打开的 DSH Web UI 页面。如果按钮没有立刻出现，可以刷新 Web UI。

## 使用方法

- 点击麦克风按钮开始收音。
- 再次点击按钮停止收音。
- 点击 `中` / `EN` 按钮手动切换识别语言。
- 收音时按钮会展开，并显示五段红色动态音量条。
- 识别出的文字会写入当前输入框草稿，确认后正常发送即可。

## 已知限制

- Web Speech API 的表现取决于浏览器和网络环境。
- 浏览器会自行决定静音超时和单段识别长度。插件会在 `end` 事件后尝试重启，但不能把单次浏览器识别会话变成真正无限。
- Chrome 可能会把语音识别请求交给 Google 服务；Edge 可能会交给 Microsoft / Azure 服务。
- 音量条依赖 `getUserMedia`。如果浏览器拒绝麦克风音量采集，语音识别仍可能工作，但音量条会退回到 SpeechRecognition 的 sound/speech 事件反馈。

## 许可证

MIT
