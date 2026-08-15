# DSH Voice Input Plugin

[中文说明](README.zh-CN.md)

A Cordis plugin for DeepSeek Harness (DSH) that adds continuous voice dictation and optional cloud ASR to the DSH Web UI composer.

## Features

- Continuous voice dictation for the DSH composer.
- Manual Chinese / English recognition switch (`zh-CN` / `en-US`).
- Live interim transcript updates in the draft input.
- User edits remain authoritative during live dictation; deleted or corrected text is not restored by a later final recognition event.
- Auto-restart after browser-imposed silence endings.
- Five-bar animated voice activity indicator.
- DSH-style inline SVG microphone and stop icons, no emoji UI.
- Optional high-accuracy cloud transcription through SiliconFlow.
- All three Volcengine console ASR products are selectable: streaming, recording-file 1.0, and recording-file 2.0.
- A package-private DSH Host proxy for Volcengine, avoiding browser CORS limitations and keeping credentials out of command lines and source files.

## Requirements

- DeepSeek Harness / DSH with Cordis dynamic plugin support.
- A DSH `cordis` / creator-mode session for installation.
- Chrome or Edge. The plugin uses the browser Web Speech API:
  - `SpeechRecognition` / `webkitSpeechRecognition`
  - `navigator.mediaDevices.getUserMedia`
  - `AudioContext` / `webkitAudioContext`

Firefox and Safari do not currently support the Web Speech recognition API used here.

SiliconFlow mode additionally uses `MediaRecorder` and its
`/v1/audio/transcriptions` endpoint. Volcengine mode uses `AudioContext` to
encode 16 kHz mono PCM WAV, plus the DSH Host `shell` service and local Node.js
to call the official flash recognition endpoint.

## Install In DSH

Open a DSH creator-mode session, then:

1. Inspect the target slot:

   ```text
   cordis_inspect: what = client, name = conversation.input.right
   ```

2. Define the plugin with both source files:

   ```text
   cordis_define:
     name: voice-input
     purpose: Add continuous voice dictation to the DSH composer.
     code:
       host: <full code.host.js>
       client: <full code.client.js>
   ```

3. Run the returned plugin/package:

   ```text
   cordis_run: <returned plugin/package id>
   ```

The client plugin is delivered to open DSH Web UI pages. Refresh the Web UI if the button does not appear immediately.

## Usage

- Click the microphone button to start listening.
- Click it again to stop.
- Use the `中` / `EN` button to switch recognition language.
- Open settings to switch among `Browser realtime`, `SiliconFlow`, and `Volcengine ASR`.
- Cloud mode requires a SiliconFlow API key and supports `FunAudioLLM/SenseVoiceSmall` and `TeleAI/TeleSpeechASR`.
- Volcengine mode accepts either a new-console API key or legacy App ID plus Access Token, and exposes these service choices:
  - `Doubao streaming ASR` (`volc.seedasr.sauc.duration`, displayed price: CNY 4.5/hour)
  - `Doubao recording-file ASR` (`volc.bigasr.auc`, displayed price: CNY 2.3/hour)
  - `Doubao recording-file ASR 2.0` (`volc.seedasr.auc`, displayed price: CNY 0.8/hour)
- While listening, the button expands and shows five animated red voice bars.
- Text is written into the current composer draft; send it normally when ready.

Credentials are stored only in the current tab's `sessionStorage`. They are
never written into this repository or the plugin source. Volcengine credentials
cross the package-private local Host RPC only for one request and are supplied
to the proxy child process through its temporary environment. Use dedicated
credentials with spending limits and do not share them.

## Known Limits

- Web Speech API behavior depends on the browser and network.
- The browser decides silence timeout and segment length. The plugin restarts after an `end` event, but it cannot make one browser recognition session infinite.
- Browser mode preserves the recognition service's raw text and does not add heuristic punctuation. Use cloud mode when semantic punctuation and higher transcription accuracy matter.
- Cloud modes return text after recording stops; they do not provide the live interim preview available in browser mode.
- The streaming option calls the official WebSocket protocol, but the current DSH JSON bridge submits the captured audio after recording stops; it does not yet show remote interim text while speaking.
- Recording-file 1.0 and 2.0 use the official submit/query polling flow. Keep one recording to about eight minutes or less in this plugin.
- A browser-side API key can be accessed by other scripts running on the same DSH origin. Use a limited, dedicated key.
- Chrome may route recognition through Google services; Edge may route through Microsoft/Azure services.
- The voice meter uses `getUserMedia`; if the browser denies that path, recognition may still work while the meter falls back to SpeechRecognition sound/speech events.

## License

MIT

## Provider Documentation

- [Volcengine BigModel streaming recognition API](https://www.volcengine.com/docs/6561/1354869?lang=zh)
- [Volcengine ASR product](https://www.volcengine.com/product/asr)
