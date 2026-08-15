# DSH Voice Input Plugin

[中文说明](README.zh-CN.md)

A client-side Cordis plugin for DeepSeek Harness (DSH) that adds continuous voice dictation to the DSH Web UI composer.

## Features

- Continuous voice dictation for the DSH composer.
- Manual Chinese / English recognition switch (`zh-CN` / `en-US`).
- Live interim transcript updates in the draft input.
- User edits remain authoritative during live dictation; deleted or corrected text is not restored by a later final recognition event.
- Auto-restart after browser-imposed silence endings.
- Five-bar animated voice activity indicator.
- DSH-style inline SVG microphone and stop icons, no emoji UI.
- Optional high-accuracy cloud transcription through SiliconFlow.
- Client-only implementation with no plugin backend.

## Requirements

- DeepSeek Harness / DSH with Cordis dynamic plugin support.
- A DSH `cordis` / creator-mode session for installation.
- Chrome or Edge. The plugin uses the browser Web Speech API:
  - `SpeechRecognition` / `webkitSpeechRecognition`
  - `navigator.mediaDevices.getUserMedia`
  - `AudioContext` / `webkitAudioContext`

Firefox and Safari do not currently support the Web Speech recognition API used here.

The optional cloud mode additionally uses `MediaRecorder` and the SiliconFlow
`/v1/audio/transcriptions` endpoint.

## Install In DSH

Open a DSH creator-mode session, then:

1. Inspect the target slot:

   ```text
   cordis_inspect: what = client, name = conversation.input.right
   ```

2. Define the plugin with `code.client` set to the full contents of `code.client.js`:

   ```text
   cordis_define:
     name: voice-input
     purpose: Add continuous voice dictation to the DSH composer.
     code:
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
- Open the settings button to switch between `Browser realtime` and `Cloud high accuracy`.
- Cloud mode requires a SiliconFlow API key and supports `FunAudioLLM/SenseVoiceSmall` and `TeleAI/TeleSpeechASR`.
- While listening, the button expands and shows five animated red voice bars.
- Text is written into the current composer draft; send it normally when ready.

The API key is stored only in the current tab's `sessionStorage`. It is never
written into this repository or the plugin source. Because this remains a
browser-side integration, use a separate key with a spending limit and do not
share that key with other users.

## Known Limits

- Web Speech API behavior depends on the browser and network.
- The browser decides silence timeout and segment length. The plugin restarts after an `end` event, but it cannot make one browser recognition session infinite.
- Browser mode preserves the recognition service's raw text and does not add heuristic punctuation. Use cloud mode when semantic punctuation and higher transcription accuracy matter.
- Cloud mode returns text after recording stops; it does not provide the live interim preview available in browser mode.
- A browser-side API key can be accessed by other scripts running on the same DSH origin. Use a limited, dedicated key.
- Chrome may route recognition through Google services; Edge may route through Microsoft/Azure services.
- The voice meter uses `getUserMedia`; if the browser denies that path, recognition may still work while the meter falls back to SpeechRecognition sound/speech events.

## License

MIT
