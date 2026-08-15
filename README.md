# DSH Voice Input Plugin

[中文说明](README.zh-CN.md)

A client-side Cordis plugin for DeepSeek Harness (DSH) that adds continuous voice dictation to the DSH Web UI composer.

## Features

- Continuous voice dictation for the DSH composer.
- Manual Chinese / English recognition switch (`zh-CN` / `en-US`).
- Lightweight automatic punctuation for finalized recognition segments.
- Live interim transcript updates in the draft input.
- Auto-restart after browser-imposed silence endings.
- Five-bar animated voice activity indicator.
- DSH-style inline SVG microphone and stop icons, no emoji UI.
- Client-only implementation: no backend service, no API key.

## Requirements

- DeepSeek Harness / DSH with Cordis dynamic plugin support.
- A DSH `cordis` / creator-mode session for installation.
- Chrome or Edge. The plugin uses the browser Web Speech API:
  - `SpeechRecognition` / `webkitSpeechRecognition`
  - `navigator.mediaDevices.getUserMedia`
  - `AudioContext` / `webkitAudioContext`

Firefox and Safari do not currently support the Web Speech recognition API used here.

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
- Use the `。` / `.` button to turn automatic punctuation on or off.
- While listening, the button expands and shows five animated red voice bars.
- Text is written into the current composer draft; send it normally when ready.

## Known Limits

- Web Speech API behavior depends on the browser and network.
- The browser decides silence timeout and segment length. The plugin restarts after an `end` event, but it cannot make one browser recognition session infinite.
- Automatic punctuation is intentionally conservative: it appends only sentence-ending punctuation to finalized segments and does not infer commas or semantic punctuation.
- Chrome may route recognition through Google services; Edge may route through Microsoft/Azure services.
- The voice meter uses `getUserMedia`; if the browser denies that path, recognition may still work while the meter falls back to SpeechRecognition sound/speech events.

## License

MIT
