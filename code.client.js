/**
 * 语音输入插件（DSH Web GUI client 插件）
 *
 * 平台：Client（浏览器端）
 * 挂载点：conversation.input.right（composer 工具行右端，发送按钮左侧）
 * 依赖：浏览器 Web Speech API，或可选的 SiliconFlow / Volcengine ASR
 *
 * 部署方式：通过 Cordis 动态插件工具 cordis_define / cordis_run 运行，
 * 详见同目录 README.md。本文件即 cordis_define 的 code.client 载荷。
 *
 * 注意（遵循 cordis-plugin-development SKILL.md 规范）：
 * - 纯 JavaScript 函数体，返回 Cordis Plugin 对象，无 JSX / TS / import；
 * - Client React 代码必须用 React.createElement(...)；
 * - 用 ctx.get('slots') 读取可选服务并处理缺失；
 * - 所有贡献在 stop/update 时由 Cordis 生命周期自动回收。
 */

return {
  apply(ctx) {
    // slots 是可选服务：先 get 再判空，不要用 ctx.slots（需声明 inject）
    const slots = ctx.get('slots')
    if (slots === undefined) return

    // 等到 conversation.input.right 插槽声明后注册组件
    slots.inject('conversation.input.right', () => slots.register(
      { name: 'conversation.input.right', id: 'voice-input' },
      (props) => {
        // props 来自：会话标准工具包（inputActions / useInput / sessionId）
        //           + owner InputZone（session / input 点态快照）
        const { inputActions, input } = props

        const [listening, setListening] = React.useState(false)
        const [unsupported, setUnsupported] = React.useState(false)
        const [level, setLevel] = React.useState(0)
        const [phase, setPhase] = React.useState(0)
        const [soundActive, setSoundActive] = React.useState(false)
        const [lang, setLang] = React.useState('zh-CN')
        const [settingsOpen, setSettingsOpen] = React.useState(false)
        const [engine, setEngine] = React.useState(() => {
          const g = getGlobal()
          try {
            return (g && g.localStorage && g.localStorage.getItem('dsh-voice-engine')) || 'browser'
          } catch (error) {
            return 'browser'
          }
        })
        const [cloudModel, setCloudModel] = React.useState(() => {
          const g = getGlobal()
          try {
            return (g && g.localStorage && g.localStorage.getItem('dsh-voice-cloud-model')) || 'FunAudioLLM/SenseVoiceSmall'
          } catch (error) {
            return 'FunAudioLLM/SenseVoiceSmall'
          }
        })
        const [cloudApiKey, setCloudApiKey] = React.useState(() => {
          const g = getGlobal()
          try {
            return (g && g.sessionStorage && g.sessionStorage.getItem('dsh-voice-siliconflow-key')) || ''
          } catch (error) {
            return ''
          }
        })
        const [volcAuthMode, setVolcAuthMode] = React.useState(() => {
          const g = getGlobal()
          try {
            return (g && g.localStorage && g.localStorage.getItem('dsh-voice-volc-auth-mode')) || 'api-key'
          } catch (error) {
            return 'api-key'
          }
        })
        const [volcService, setVolcService] = React.useState(() => {
          const g = getGlobal()
          try {
            return (g && g.localStorage && g.localStorage.getItem('dsh-voice-volc-service')) || 'recording-v2'
          } catch (error) {
            return 'recording-v2'
          }
        })
        const [volcApiKey, setVolcApiKey] = React.useState(() => {
          const g = getGlobal()
          try {
            return (g && g.sessionStorage && g.sessionStorage.getItem('dsh-voice-volc-api-key')) || ''
          } catch (error) {
            return ''
          }
        })
        const [volcAppId, setVolcAppId] = React.useState(() => {
          const g = getGlobal()
          try {
            return (g && g.sessionStorage && g.sessionStorage.getItem('dsh-voice-volc-app-id')) || ''
          } catch (error) {
            return ''
          }
        })
        const [volcAccessToken, setVolcAccessToken] = React.useState(() => {
          const g = getGlobal()
          try {
            return (g && g.sessionStorage && g.sessionStorage.getItem('dsh-voice-volc-access-token')) || ''
          } catch (error) {
            return ''
          }
        })
        const [cloudBusy, setCloudBusy] = React.useState(false)
        const [cloudError, setCloudError] = React.useState('')
        const recRef = React.useRef(null)
        const langRef = React.useRef('zh-CN')
        const draftRef = React.useRef((input && input.draft) || '')
        const activeRef = React.useRef(false)
        const restartTimerRef = React.useRef(null)
        const baseDraftRef = React.useRef('')
        const carriedFinalRef = React.useRef('')
        const sessionFinalRef = React.useRef('')
        const interimRef = React.useRef('')
        const suppressedSpeechLengthRef = React.useRef(0)
        const lastWrittenDraftRef = React.useRef(null)
        const meterRef = React.useRef(null)
        const visualRef = React.useRef(null)
        const mediaRecorderRef = React.useRef(null)
        const cloudChunksRef = React.useRef([])
        const cloudStreamRef = React.useRef(null)
        const wavRecorderRef = React.useRef(null)

        React.useEffect(() => {
          const nextDraft = (input && input.draft) || ''
          draftRef.current = nextDraft

          if (!activeRef.current || engine !== 'browser') return
          if (lastWrittenDraftRef.current !== null && nextDraft === lastWrittenDraftRef.current) {
            lastWrittenDraftRef.current = null
            return
          }

          // Any composer edit made while dictating becomes authoritative. Suppress all
          // speech already seen so a later final result cannot resurrect deleted text.
          baseDraftRef.current = nextDraft
          suppressedSpeechLengthRef.current = getRecognizedSpeech().length
          lastWrittenDraftRef.current = null
        }, [input && input.draft])

        React.useEffect(() => {
          langRef.current = lang
          if (recRef.current) recRef.current.lang = lang
        }, [lang])

        function getGlobal() {
          return typeof window !== 'undefined'
            ? window
            : (typeof globalThis !== 'undefined' ? globalThis : null)
        }

        function clearRestartTimer() {
          const g = getGlobal()
          if (restartTimerRef.current && g && typeof g.clearTimeout === 'function') {
            g.clearTimeout(restartTimerRef.current)
          }
          restartTimerRef.current = null
        }

        function getRecognizedSpeech() {
          return carriedFinalRef.current + sessionFinalRef.current + interimRef.current
        }

        function writeTranscript() {
          const recognized = getRecognizedSpeech()
          const spoken = recognized.slice(Math.min(suppressedSpeechLengthRef.current, recognized.length))
          const current = baseDraftRef.current || ''
          const next = current
            ? (spoken ? current + spoken : current)
            : spoken
          lastWrittenDraftRef.current = next
          inputActions.setDraft(next)
          draftRef.current = next
        }

        function stopMeter() {
          const g = getGlobal()
          const meter = meterRef.current
          meterRef.current = null
          setLevel(0)
          if (!meter) return
          if (meter.raf && g && typeof g.cancelAnimationFrame === 'function') {
            g.cancelAnimationFrame(meter.raf)
          }
          if (meter.stream && meter.ownsStream) {
            meter.stream.getTracks().forEach((track) => track.stop())
          }
          if (meter.audioContext && typeof meter.audioContext.close === 'function') {
            meter.audioContext.close().catch(() => undefined)
          }
        }

        function stopVisualPulse() {
          const g = getGlobal()
          const visual = visualRef.current
          visualRef.current = null
          setPhase(0)
          setSoundActive(false)
          if (!visual || !g) return
          if (visual.kind === 'raf' && typeof g.cancelAnimationFrame === 'function') {
            g.cancelAnimationFrame(visual.id)
          } else if (visual.kind === 'timeout' && typeof g.clearTimeout === 'function') {
            g.clearTimeout(visual.id)
          }
        }

        function startVisualPulse() {
          const g = getGlobal()
          if (visualRef.current) return
          const visual = { id: null, kind: 'raf', step: 0 }
          visualRef.current = visual

          function tick() {
            if (!activeRef.current || visualRef.current !== visual) return
            visual.step = (visual.step + 1) % 100000
            setPhase(visual.step)
            if (g && typeof g.requestAnimationFrame === 'function') {
              visual.kind = 'raf'
              visual.id = g.requestAnimationFrame(tick)
            } else if (g && typeof g.setTimeout === 'function') {
              visual.kind = 'timeout'
              visual.id = g.setTimeout(tick, 80)
            }
          }

          tick()
        }

        async function startMeter(existingStream, ownsStream = true) {
          const g = getGlobal()
          const mediaDevices = g && g.navigator && g.navigator.mediaDevices
          const AudioCtor = g && (g.AudioContext || g.webkitAudioContext)
          if (!mediaDevices || !AudioCtor || meterRef.current) return
          try {
            const stream = existingStream || await mediaDevices.getUserMedia({ audio: true })
            if (!activeRef.current) {
              if (ownsStream) stream.getTracks().forEach((track) => track.stop())
              return
            }
            const audioContext = new AudioCtor()
            const source = audioContext.createMediaStreamSource(stream)
            const analyser = audioContext.createAnalyser()
            analyser.fftSize = 256
            source.connect(analyser)
            const data = new Uint8Array(analyser.frequencyBinCount)
            const meter = { stream, ownsStream, audioContext, analyser, data, raf: null }
            meterRef.current = meter

            function tick() {
              if (!activeRef.current || meterRef.current !== meter) return
              analyser.getByteTimeDomainData(data)
              let sum = 0
              for (let i = 0; i < data.length; i++) {
                const centered = (data[i] - 128) / 128
                sum += centered * centered
              }
              const rms = Math.sqrt(sum / data.length)
              setLevel(Math.max(0.06, Math.min(1, rms * 18)))
              if (g && typeof g.requestAnimationFrame === 'function') {
                meter.raf = g.requestAnimationFrame(tick)
              }
            }

            tick()
          } catch (error) {
            console.log('[voice-input] meter unavailable:', error && error.message ? error.message : error)
          }
        }

        function stopCloudStream() {
          const stream = cloudStreamRef.current
          cloudStreamRef.current = null
          if (stream) stream.getTracks().forEach((track) => track.stop())
        }

        function appendCloudTranscript(text) {
          const clean = (text || '').trim()
          if (!clean) return
          const current = draftRef.current || ''
          const needsSpace = current
            && !/\s$/.test(current)
            && langRef.current !== 'zh-CN'
          const next = current + (needsSpace ? ' ' : '') + clean
          inputActions.setDraft(next)
          draftRef.current = next
        }

        function encodeWavBase64(chunks, sourceRate) {
          let totalLength = 0
          chunks.forEach((chunk) => { totalLength += chunk.length })
          const merged = new Float32Array(totalLength)
          let offset = 0
          chunks.forEach((chunk) => {
            merged.set(chunk, offset)
            offset += chunk.length
          })

          const targetRate = 16000
          const ratio = sourceRate / targetRate
          const outputLength = Math.max(1, Math.round(merged.length / ratio))
          const samples = new Float32Array(outputLength)
          for (let i = 0; i < outputLength; i++) {
            const position = i * ratio
            const left = Math.floor(position)
            const right = Math.min(left + 1, merged.length - 1)
            const mix = position - left
            samples[i] = (merged[left] || 0) * (1 - mix) + (merged[right] || 0) * mix
          }

          const buffer = new ArrayBuffer(44 + samples.length * 2)
          const view = new DataView(buffer)
          function writeAscii(at, text) {
            for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i))
          }
          writeAscii(0, 'RIFF')
          view.setUint32(4, 36 + samples.length * 2, true)
          writeAscii(8, 'WAVE')
          writeAscii(12, 'fmt ')
          view.setUint32(16, 16, true)
          view.setUint16(20, 1, true)
          view.setUint16(22, 1, true)
          view.setUint32(24, targetRate, true)
          view.setUint32(28, targetRate * 2, true)
          view.setUint16(32, 2, true)
          view.setUint16(34, 16, true)
          writeAscii(36, 'data')
          view.setUint32(40, samples.length * 2, true)
          for (let i = 0; i < samples.length; i++) {
            const sample = Math.max(-1, Math.min(1, samples[i]))
            view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
          }

          const bytes = new Uint8Array(buffer)
          let binary = ''
          const blockSize = 0x8000
          for (let i = 0; i < bytes.length; i += blockSize) {
            binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + blockSize, bytes.length)))
          }
          return btoa(binary)
        }

        function startWavRecorder(stream) {
          const g = getGlobal()
          const AudioCtor = g && (g.AudioContext || g.webkitAudioContext)
          if (!AudioCtor) throw new Error('当前浏览器不支持 WAV 录音')
          const audioContext = new AudioCtor()
          const source = audioContext.createMediaStreamSource(stream)
          const processor = audioContext.createScriptProcessor(4096, 1, 1)
          const silentGain = audioContext.createGain()
          silentGain.gain.value = 0
          const chunks = []
          processor.onaudioprocess = (event) => {
            if (!activeRef.current) return
            const channel = event.inputBuffer.getChannelData(0)
            chunks.push(new Float32Array(channel))
          }
          source.connect(processor)
          processor.connect(silentGain)
          silentGain.connect(audioContext.destination)
          if (audioContext.state === 'suspended') audioContext.resume().catch(() => undefined)
          wavRecorderRef.current = { audioContext, source, processor, silentGain, chunks }
        }

        function finishWavRecorder(encode) {
          const recorder = wavRecorderRef.current
          wavRecorderRef.current = null
          if (!recorder) return ''
          recorder.processor.onaudioprocess = null
          recorder.source.disconnect()
          recorder.processor.disconnect()
          recorder.silentGain.disconnect()
          const result = encode
            ? encodeWavBase64(recorder.chunks, recorder.audioContext.sampleRate)
            : ''
          recorder.audioContext.close().catch(() => undefined)
          return result
        }

        async function transcribeCloudAudio(blob) {
          if (!blob || blob.size === 0) throw new Error('没有录到可转写的音频')
          if (!cloudApiKey.trim()) throw new Error('请先在语音设置中填写 SiliconFlow API Key')

          const form = new FormData()
          form.append('file', blob, 'dsh-voice-input.webm')
          form.append('model', cloudModel)
          const response = await fetch('https://api.siliconflow.cn/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${cloudApiKey.trim()}` },
            body: form,
          })
          if (!response.ok) {
            let detail = ''
            try {
              const body = await response.json()
              detail = body && (body.message || body.error)
                ? `：${body.message || body.error}`
                : ''
            } catch (error) {
              detail = ''
            }
            throw new Error(`云端转写失败（HTTP ${response.status}）${detail}`)
          }
          const result = await response.json()
          if (!result || typeof result.text !== 'string') {
            throw new Error('云端转写没有返回文本')
          }
          appendCloudTranscript(result.text)
        }

        async function transcribeVolcengineAudio(audioBase64) {
          const result = await host.call('transcribe-volcengine', {
            audioBase64,
            authMode: volcAuthMode,
            service: volcService,
            apiKey: volcApiKey.trim(),
            appId: volcAppId.trim(),
            accessToken: volcAccessToken.trim(),
            language: langRef.current,
          })
          if (!result || result.ok !== true) {
            const detail = result && result.message ? `：${result.message}` : ''
            const status = result && result.statusCode ? `（${result.statusCode}）` : ''
            throw new Error(`火山引擎转写失败${status}${detail}`)
          }
          if (typeof result.text !== 'string' || !result.text.trim()) {
            throw new Error('火山引擎没有返回识别文本')
          }
          appendCloudTranscript(result.text)
        }

        async function startVolcengineRecording() {
          const g = getGlobal()
          const mediaDevices = g && g.navigator && g.navigator.mediaDevices
          if (!mediaDevices) {
            setUnsupported(true)
            return
          }
          const missingNewKey = volcAuthMode === 'api-key' && !volcApiKey.trim()
          const missingLegacyKey = volcAuthMode === 'legacy'
            && (!volcAppId.trim() || !volcAccessToken.trim())
          if (missingNewKey || missingLegacyKey) {
            setCloudError(volcAuthMode === 'api-key'
              ? '请先填写火山引擎 API Key'
              : '请先填写火山引擎 App ID 和 Access Token')
            setSettingsOpen(true)
            return
          }

          try {
            setCloudError('')
            const stream = await mediaDevices.getUserMedia({ audio: true })
            cloudStreamRef.current = stream
            activeRef.current = true
            startWavRecorder(stream)
            startVisualPulse()
            startMeter(stream, false)
            setListening(true)
          } catch (error) {
            activeRef.current = false
            finishWavRecorder(false)
            stopCloudStream()
            stopMeter()
            stopVisualPulse()
            setListening(false)
            setCloudError(error && error.message ? error.message : '无法开始火山引擎录音')
          }
        }

        async function stopVolcengineRecording() {
          activeRef.current = false
          stopMeter()
          stopVisualPulse()
          setListening(false)
          try {
            const audioBase64 = finishWavRecorder(true)
            stopCloudStream()
            if (!audioBase64) throw new Error('没有录到可转写的音频')
            setCloudBusy(true)
            await transcribeVolcengineAudio(audioBase64)
          } catch (error) {
            setCloudError(error && error.message ? error.message : '火山引擎转写失败')
          } finally {
            stopCloudStream()
            setCloudBusy(false)
          }
        }

        async function startCloudRecording() {
          if (engine === 'volcengine') {
            await startVolcengineRecording()
            return
          }
          const g = getGlobal()
          const mediaDevices = g && g.navigator && g.navigator.mediaDevices
          const MediaRecorderCtor = g && g.MediaRecorder
          if (!mediaDevices || !MediaRecorderCtor) {
            setUnsupported(true)
            return
          }
          if (!cloudApiKey.trim()) {
            setCloudError('请先填写 SiliconFlow API Key')
            setSettingsOpen(true)
            return
          }

          try {
            setCloudError('')
            const stream = await mediaDevices.getUserMedia({ audio: true })
            const preferredMimeType = MediaRecorderCtor.isTypeSupported
              && MediaRecorderCtor.isTypeSupported('audio/webm;codecs=opus')
              ? 'audio/webm;codecs=opus'
              : ''
            const recorder = preferredMimeType
              ? new MediaRecorderCtor(stream, { mimeType: preferredMimeType })
              : new MediaRecorderCtor(stream)
            const mimeType = recorder.mimeType || preferredMimeType || 'audio/webm'
            cloudStreamRef.current = stream
            cloudChunksRef.current = []
            mediaRecorderRef.current = recorder
            recorder.ondataavailable = (event) => {
              if (event && event.data && event.data.size > 0) cloudChunksRef.current.push(event.data)
            }
            recorder.onerror = (event) => {
              const error = event && event.error
              setCloudError(error && error.message ? error.message : '云端录音失败')
            }
            recorder.onstop = async () => {
              const chunks = cloudChunksRef.current
              cloudChunksRef.current = []
              mediaRecorderRef.current = null
              stopCloudStream()
              const blob = new Blob(chunks, { type: mimeType })
              setCloudBusy(true)
              try {
                await transcribeCloudAudio(blob)
              } catch (error) {
                setCloudError(error && error.message ? error.message : '云端转写失败')
              } finally {
                setCloudBusy(false)
              }
            }

            activeRef.current = true
            startVisualPulse()
            startMeter(stream, false)
            recorder.start(1000)
            setListening(true)
          } catch (error) {
            activeRef.current = false
            stopCloudStream()
            stopMeter()
            stopVisualPulse()
            setListening(false)
            setCloudError(error && error.message ? error.message : '无法开始云端录音')
          }
        }

        function stopCloudRecording() {
          if (engine === 'volcengine') {
            stopVolcengineRecording()
            return
          }
          activeRef.current = false
          stopMeter()
          stopVisualPulse()
          setListening(false)
          const recorder = mediaRecorderRef.current
          if (recorder && recorder.state !== 'inactive') {
            recorder.stop()
          } else {
            stopCloudStream()
          }
        }

        // 懒创建识别器（单例，随插件生命周期销毁）
        function ensureRecognition() {
          if (recRef.current) return recRef.current
          const g = getGlobal()
          const Ctor = g && (g.SpeechRecognition || g.webkitSpeechRecognition)
          if (!Ctor) return null
          const rec = new Ctor()
          rec.lang = lang             // 手动切换中文 / English
          rec.interimResults = true   // 实时写入临时识别结果，减少“等一句话结束”的顿感
          rec.continuous = true       // 请求持续识别；浏览器仍可能因静音自动结束，所以 onend 会重启
          rec.maxAlternatives = 1

          rec.onresult = (event) => {
            let finalText = ''
            let interimText = ''
            for (let i = 0; i < event.results.length; i++) {
              const result = event.results[i]
              const text = result && result[0] && result[0].transcript
                ? result[0].transcript
                : ''
              if (result && result.isFinal) {
                finalText += text
              } else {
                interimText += text
              }
            }
            sessionFinalRef.current = finalText
            interimRef.current = interimText
            writeTranscript()
          }
          rec.onsoundstart = () => {
            setSoundActive(true)
            setLevel((current) => Math.max(current, 0.34))
          }
          rec.onsoundend = () => setSoundActive(false)
          rec.onspeechstart = () => {
            setSoundActive(true)
            setLevel((current) => Math.max(current, 0.42))
          }
          rec.onspeechend = () => setSoundActive(false)
          rec.onend = () => {
            if (!activeRef.current) {
              setListening(false)
              return
            }
            carriedFinalRef.current += sessionFinalRef.current
            sessionFinalRef.current = ''
            interimRef.current = ''
            const delay = 180
            clearRestartTimer()
            restartTimerRef.current = g && typeof g.setTimeout === 'function'
              ? g.setTimeout(() => {
                restartTimerRef.current = null
                if (!activeRef.current) return
                try {
                  rec.start()
                  setListening(true)
                } catch (error) {
                  console.log('[voice-input] restart failed:', error)
                }
              }, delay)
              : null
          }
          rec.onerror = (event) => {
            const error = event && event.error
            console.log('[voice-input] recognition error:', error)
            if (error === 'not-allowed' || error === 'service-not-allowed') {
              activeRef.current = false
              clearRestartTimer()
              stopMeter()
              setListening(false)
            }
          }
          recRef.current = rec
          return rec
        }

        function toggleBrowserRecognition() {
          const rec = ensureRecognition()
          if (!rec) {
            setUnsupported(true)
            return
          }
          if (listening) {
            activeRef.current = false
            clearRestartTimer()
            stopMeter()
            stopVisualPulse()
            rec.stop()
            setListening(false)
          } else {
            try {
              activeRef.current = true
              baseDraftRef.current = draftRef.current || ''
              carriedFinalRef.current = ''
              sessionFinalRef.current = ''
              interimRef.current = ''
              suppressedSpeechLengthRef.current = 0
              lastWrittenDraftRef.current = null
              startVisualPulse()
              startMeter()
              rec.start()
              setListening(true)
            } catch (error) {
              // 浏览器可能在上一次未完全结束时拒绝 start
              console.log('[voice-input] start failed:', error)
              activeRef.current = false
              stopMeter()
              stopVisualPulse()
              setListening(false)
            }
          }
        }

        function toggle() {
          if (engine === 'siliconflow' || engine === 'volcengine') {
            if (listening) stopCloudRecording()
            else startCloudRecording()
            return
          }
          toggleBrowserRecognition()
        }

        function switchLanguage() {
          const next = lang === 'zh-CN' ? 'en-US' : 'zh-CN'
          langRef.current = next
          setLang(next)
          if (recRef.current) recRef.current.lang = next
          if (activeRef.current && recRef.current) {
            clearRestartTimer()
            try {
              recRef.current.stop()
            } catch (error) {
              console.log('[voice-input] language restart failed:', error)
            }
          }
        }

        function saveSettings() {
          const g = getGlobal()
          try {
            if (g && g.localStorage) {
              g.localStorage.setItem('dsh-voice-engine', engine)
              g.localStorage.setItem('dsh-voice-cloud-model', cloudModel)
              g.localStorage.setItem('dsh-voice-volc-auth-mode', volcAuthMode)
              g.localStorage.setItem('dsh-voice-volc-service', volcService)
            }
            if (g && g.sessionStorage) {
              if (cloudApiKey.trim()) {
                g.sessionStorage.setItem('dsh-voice-siliconflow-key', cloudApiKey.trim())
              } else {
                g.sessionStorage.removeItem('dsh-voice-siliconflow-key')
              }
              if (volcApiKey.trim()) {
                g.sessionStorage.setItem('dsh-voice-volc-api-key', volcApiKey.trim())
              } else {
                g.sessionStorage.removeItem('dsh-voice-volc-api-key')
              }
              if (volcAppId.trim()) {
                g.sessionStorage.setItem('dsh-voice-volc-app-id', volcAppId.trim())
              } else {
                g.sessionStorage.removeItem('dsh-voice-volc-app-id')
              }
              if (volcAccessToken.trim()) {
                g.sessionStorage.setItem('dsh-voice-volc-access-token', volcAccessToken.trim())
              } else {
                g.sessionStorage.removeItem('dsh-voice-volc-access-token')
              }
            }
          } catch (error) {
            setCloudError('浏览器拒绝保存语音设置')
            return
          }
          setCloudError('')
          setUnsupported(false)
          setSettingsOpen(false)
        }

        function cancelSettings() {
          const g = getGlobal()
          try {
            if (g && g.localStorage) {
              setEngine(g.localStorage.getItem('dsh-voice-engine') || 'browser')
              setCloudModel(g.localStorage.getItem('dsh-voice-cloud-model') || 'FunAudioLLM/SenseVoiceSmall')
              setVolcAuthMode(g.localStorage.getItem('dsh-voice-volc-auth-mode') || 'api-key')
              setVolcService(g.localStorage.getItem('dsh-voice-volc-service') || 'recording-v2')
            }
            if (g && g.sessionStorage) {
              setCloudApiKey(g.sessionStorage.getItem('dsh-voice-siliconflow-key') || '')
              setVolcApiKey(g.sessionStorage.getItem('dsh-voice-volc-api-key') || '')
              setVolcAppId(g.sessionStorage.getItem('dsh-voice-volc-app-id') || '')
              setVolcAccessToken(g.sessionStorage.getItem('dsh-voice-volc-access-token') || '')
            }
          } catch (error) {
            // Keep the current in-memory values if browser storage is unavailable.
          }
          setCloudError('')
          setSettingsOpen(false)
        }

        // 插件卸载时中止进行中的识别
        React.useEffect(() => () => {
          activeRef.current = false
          clearRestartTimer()
          stopMeter()
          stopVisualPulse()
          const recorder = mediaRecorderRef.current
          if (recorder && recorder.state !== 'inactive') {
            recorder.onstop = null
            recorder.stop()
          }
          finishWavRecorder(false)
          stopCloudStream()
          if (recRef.current && typeof recRef.current.abort === 'function') {
            recRef.current.abort()
          }
        }, [])

        const visualLevel = listening
          ? Math.max(level, soundActive ? 0.36 : 0.1)
          : 0
        const barSeeds = [0.52, 0.86, 0.68, 1, 0.58]
        const bars = barSeeds.map((seed, index) => {
          const wave = (Math.sin((phase * 0.38) + (index * 1.25)) + 1) / 2
          return Math.max(3, Math.round(4 + 10 * visualLevel * (0.45 + wave * seed)))
        })
        const iconProps = {
          width: 16,
          height: 16,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        }
        const micIcon = React.createElement(
          'svg',
          iconProps,
          React.createElement('path', { d: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z' }),
          React.createElement('path', { d: 'M19 10v1a7 7 0 0 1-14 0v-1' }),
          React.createElement('path', { d: 'M12 18v3' }),
          React.createElement('path', { d: 'M8 21h8' }),
        )
        const stopIcon = React.createElement(
          'svg',
          iconProps,
          React.createElement('rect', { x: 7, y: 7, width: 10, height: 10, rx: 1.5 }),
        )
        const settingsIcon = React.createElement(
          'svg',
          iconProps,
          React.createElement('circle', { cx: 12, cy: 12, r: 3 }),
          React.createElement('path', { d: 'M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7.6Z' }),
        )
        const langLabel = lang === 'zh-CN' ? '中' : 'EN'
        const nextLangLabel = lang === 'zh-CN' ? 'English' : '中文'

        const settingsPanel = settingsOpen
          ? React.createElement(
            'div',
            {
              role: 'presentation',
              onMouseDown: (event) => {
                if (event.target === event.currentTarget) cancelSettings()
              },
              style: {
                position: 'fixed',
                inset: 0,
                zIndex: 10000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 20,
                background: 'rgba(17, 24, 39, 0.28)',
              },
            },
            React.createElement(
              'div',
              {
                role: 'dialog',
                'aria-modal': 'true',
                'aria-label': '语音输入设置',
                style: {
                  width: 'min(380px, calc(100vw - 32px))',
                  padding: 18,
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  background: '#ffffff',
                  color: '#20242a',
                  boxShadow: '0 18px 50px rgba(17, 24, 39, 0.18)',
                  fontFamily: 'inherit',
                },
              },
              React.createElement(
                'div',
                { style: { marginBottom: 14, fontSize: 16, fontWeight: 650 } },
                '语音输入设置',
              ),
              React.createElement(
                'div',
                {
                  style: {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 4,
                    padding: 4,
                    marginBottom: 16,
                    borderRadius: 7,
                    background: '#f3f4f6',
                  },
                },
                ...[
                  ['browser', '浏览器实时'],
                  ['siliconflow', '硅基流动'],
                  ['volcengine', '火山 ASR'],
                ].map(([value, label]) => React.createElement(
                  'button',
                  {
                    key: value,
                    type: 'button',
                    onClick: () => setEngine(value),
                    style: {
                      height: 32,
                      border: value === engine ? '1px solid #d1d5db' : '1px solid transparent',
                      borderRadius: 5,
                      background: value === engine ? '#ffffff' : 'transparent',
                      color: value === engine ? '#20242a' : '#6b7280',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: value === engine ? 600 : 500,
                    },
                  },
                  label,
                )),
              ),
              engine === 'siliconflow'
                ? React.createElement(
                  React.Fragment,
                  null,
                  React.createElement(
                    'label',
                    { style: { display: 'block', marginBottom: 12, fontSize: 12, color: '#5f6670' } },
                    '识别模型',
                    React.createElement(
                      'select',
                      {
                        value: cloudModel,
                        onChange: (event) => setCloudModel(event.target.value),
                        style: {
                          display: 'block',
                          width: '100%',
                          height: 36,
                          marginTop: 6,
                          padding: '0 10px',
                          border: '1px solid #d7dbe0',
                          borderRadius: 6,
                          background: '#ffffff',
                          color: '#20242a',
                          fontSize: 13,
                        },
                      },
                      React.createElement('option', { value: 'FunAudioLLM/SenseVoiceSmall' }, 'SenseVoiceSmall（推荐）'),
                      React.createElement('option', { value: 'TeleAI/TeleSpeechASR' }, 'TeleSpeechASR'),
                    ),
                  ),
                  React.createElement(
                    'label',
                    { style: { display: 'block', marginBottom: 8, fontSize: 12, color: '#5f6670' } },
                    'SiliconFlow API Key',
                    React.createElement('input', {
                      type: 'password',
                      value: cloudApiKey,
                      autoComplete: 'off',
                      placeholder: 'sk-...',
                      onChange: (event) => setCloudApiKey(event.target.value),
                      style: {
                        boxSizing: 'border-box',
                        display: 'block',
                        width: '100%',
                        height: 36,
                        marginTop: 6,
                        padding: '0 10px',
                        border: '1px solid #d7dbe0',
                        borderRadius: 6,
                        color: '#20242a',
                        fontSize: 13,
                      },
                    }),
                  ),
                  React.createElement(
                    'div',
                    { style: { fontSize: 11, lineHeight: 1.5, color: '#7b818a' } },
                    'Key 只保存在当前浏览器标签页。建议使用单独创建并设置额度的 Key。',
                  ),
                )
                : engine === 'volcengine'
                  ? React.createElement(
                    React.Fragment,
                    null,
                    React.createElement(
                      'label',
                      { style: { display: 'block', marginBottom: 12, fontSize: 12, color: '#5f6670' } },
                      '识别服务',
                      React.createElement(
                        'select',
                        {
                          value: volcService,
                          onChange: (event) => setVolcService(event.target.value),
                          style: {
                            display: 'block',
                            width: '100%',
                            height: 36,
                            marginTop: 6,
                            padding: '0 10px',
                            border: '1px solid #d7dbe0',
                            borderRadius: 6,
                            background: '#ffffff',
                            color: '#20242a',
                            fontSize: 13,
                          },
                        },
                        React.createElement('option', { value: 'streaming' }, 'Doubao-流式语音识别 · 4.5 元/小时'),
                        React.createElement('option', { value: 'recording-v1' }, 'Doubao-录音文件识别 · 2.3 元/小时'),
                        React.createElement('option', { value: 'recording-v2' }, 'Doubao-录音文件识别 2.0 · 0.8 元/小时'),
                      ),
                    ),
                    React.createElement(
                      'div',
                      {
                        style: {
                          margin: '-5px 0 12px',
                          padding: '8px 10px',
                          borderLeft: '2px solid #d1d5db',
                          background: '#f9fafb',
                          color: '#6b7280',
                          fontSize: 11,
                          lineHeight: 1.5,
                        },
                      },
                      volcService === 'streaming'
                        ? 'WebSocket 流式接口（volc.seedasr.sauc.duration）。当前 DSH 桥接在停止录音后提交整段音频。'
                        : volcService === 'recording-v1'
                          ? '录音文件模型 1.0（volc.bigasr.auc），提交任务后轮询结果。'
                          : '录音文件模型 2.0（volc.seedasr.auc），提交任务后轮询结果。',
                    ),
                    React.createElement(
                      'div',
                      {
                        style: {
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: 4,
                          padding: 4,
                          marginBottom: 12,
                          borderRadius: 7,
                          background: '#f3f4f6',
                        },
                      },
                      ...[
                        ['api-key', '新版 API Key'],
                        ['legacy', '旧版 App + Token'],
                      ].map(([value, label]) => React.createElement(
                        'button',
                        {
                          key: value,
                          type: 'button',
                          onClick: () => setVolcAuthMode(value),
                          style: {
                            height: 30,
                            border: value === volcAuthMode ? '1px solid #d1d5db' : '1px solid transparent',
                            borderRadius: 5,
                            background: value === volcAuthMode ? '#ffffff' : 'transparent',
                            color: value === volcAuthMode ? '#20242a' : '#6b7280',
                            cursor: 'pointer',
                            fontSize: 12,
                            fontWeight: value === volcAuthMode ? 600 : 500,
                          },
                        },
                        label,
                      )),
                    ),
                    volcAuthMode === 'api-key'
                      ? React.createElement(
                        'label',
                        { style: { display: 'block', marginBottom: 8, fontSize: 12, color: '#5f6670' } },
                        '火山引擎 API Key',
                        React.createElement('input', {
                          type: 'password',
                          value: volcApiKey,
                          autoComplete: 'off',
                          placeholder: '在火山引擎控制台复制 API Key',
                          onChange: (event) => setVolcApiKey(event.target.value),
                          style: {
                            boxSizing: 'border-box', display: 'block', width: '100%', height: 36,
                            marginTop: 6, padding: '0 10px', border: '1px solid #d7dbe0',
                            borderRadius: 6, color: '#20242a', fontSize: 13,
                          },
                        }),
                      )
                      : React.createElement(
                        React.Fragment,
                        null,
                        React.createElement(
                          'label',
                          { style: { display: 'block', marginBottom: 10, fontSize: 12, color: '#5f6670' } },
                          'App ID',
                          React.createElement('input', {
                            type: 'text', value: volcAppId, autoComplete: 'off',
                            onChange: (event) => setVolcAppId(event.target.value),
                            style: {
                              boxSizing: 'border-box', display: 'block', width: '100%', height: 36,
                              marginTop: 6, padding: '0 10px', border: '1px solid #d7dbe0',
                              borderRadius: 6, color: '#20242a', fontSize: 13,
                            },
                          }),
                        ),
                        React.createElement(
                          'label',
                          { style: { display: 'block', marginBottom: 8, fontSize: 12, color: '#5f6670' } },
                          'Access Token',
                          React.createElement('input', {
                            type: 'password', value: volcAccessToken, autoComplete: 'off',
                            onChange: (event) => setVolcAccessToken(event.target.value),
                            style: {
                              boxSizing: 'border-box', display: 'block', width: '100%', height: 36,
                              marginTop: 6, padding: '0 10px', border: '1px solid #d7dbe0',
                              borderRadius: 6, color: '#20242a', fontSize: 13,
                            },
                          }),
                        ),
                      ),
                    React.createElement(
                      'div',
                      { style: { fontSize: 11, lineHeight: 1.5, color: '#7b818a' } },
                      '凭证仅保存在当前标签页，并经本机 DSH Host 代理发送；插件不会写入磁盘。',
                    ),
                  )
                  : React.createElement(
                    'div',
                    { style: { fontSize: 12, lineHeight: 1.6, color: '#6b7280' } },
                    '实时显示识别文本，可在说话时直接编辑。',
                  ),
              cloudError
                ? React.createElement(
                  'div',
                  { style: { marginTop: 10, fontSize: 12, lineHeight: 1.5, color: '#c24141' } },
                  cloudError,
                )
                : null,
              React.createElement(
                'div',
                { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 } },
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    onClick: cancelSettings,
                    style: {
                      height: 34,
                      padding: '0 13px',
                      border: '1px solid #d7dbe0',
                      borderRadius: 6,
                      background: '#ffffff',
                      color: '#4b5563',
                      cursor: 'pointer',
                    },
                  },
                  '取消',
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    onClick: saveSettings,
                    style: {
                      height: 34,
                      padding: '0 14px',
                      border: '1px solid #20242a',
                      borderRadius: 6,
                      background: '#20242a',
                      color: '#ffffff',
                      cursor: 'pointer',
                      fontWeight: 600,
                    },
                  },
                  '保存',
                ),
              ),
            ),
          )
          : null

        return React.createElement(
          'span',
          {
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            },
          },
          React.createElement(
            'button',
            {
              type: 'button',
              title: listening
                ? `停止语音输入（${lang === 'zh-CN' ? '中文' : 'English'}）`
                : cloudBusy
                  ? engine === 'volcengine' ? '火山 ASR 转写中' : '云端转写中'
                : unsupported
                  ? engine === 'siliconflow' || engine === 'volcengine'
                    ? '当前浏览器不支持录音（需 Chrome / Edge）'
                    : '当前浏览器不支持语音识别（需 Chrome / Edge）'
                  : engine === 'siliconflow' || engine === 'volcengine'
                    ? engine === 'volcengine' ? '火山引擎高准确率语音输入' : '云端高准确率语音输入'
                    : `语音输入（${lang === 'zh-CN' ? '中文' : 'English'}）`,
              onClick: toggle,
              'aria-label': listening ? '停止语音输入' : '开始语音输入',
              disabled: unsupported || cloudBusy,
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: listening ? 'flex-start' : 'center',
                width: listening ? 92 : 28,
                height: 28,
                padding: listening ? '0 7px' : 0,
                border: '1px solid transparent',
                borderRadius: listening ? 999 : 6,
                background: listening ? 'rgba(220, 38, 38, 0.12)' : 'transparent',
                color: listening ? '#dc2626' : '#858b93',
                cursor: unsupported || cloudBusy ? 'not-allowed' : 'pointer',
                opacity: unsupported || cloudBusy ? 0.5 : 1,
                lineHeight: 1,
                gap: 6,
                transition: 'width 120ms ease, background 120ms ease, border-radius 120ms ease, color 120ms ease',
              },
            },
            listening ? stopIcon : micIcon,
            listening
              ? React.createElement(
                'span',
                {
                  'aria-hidden': 'true',
                  style: {
                    position: 'relative',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                    width: 52,
                    height: 18,
                    overflow: 'hidden',
                    borderRadius: 999,
                    background: 'rgba(220, 38, 38, 0.18)',
                  },
                },
                ...bars.map((height, index) => React.createElement(
                  'span',
                  {
                    key: `bar-${index}`,
                    style: {
                      display: 'inline-block',
                      width: 4,
                      height,
                      borderRadius: 999,
                      background: '#dc2626',
                      opacity: soundActive || level > 0.12 ? 1 : 0.72,
                      transition: 'height 70ms linear, opacity 120ms ease',
                    },
                  },
                )),
              )
              : null,
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              title: `切换到${nextLangLabel}`,
              onClick: switchLanguage,
              'aria-label': `切换到${nextLangLabel}`,
              disabled: listening || cloudBusy,
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 28,
                padding: 0,
                border: '1px solid transparent',
                borderRadius: 6,
                background: 'transparent',
                color: '#858b93',
                cursor: listening || cloudBusy ? 'not-allowed' : 'pointer',
                opacity: listening || cloudBusy ? 0.5 : 1,
                fontSize: 11,
                fontWeight: 600,
                lineHeight: 1,
              },
            },
            langLabel,
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              title: cloudError ? `语音设置：${cloudError}` : '语音设置',
              onClick: () => setSettingsOpen(true),
              'aria-label': '语音设置',
              disabled: listening || cloudBusy,
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                padding: 0,
                border: '1px solid transparent',
                borderRadius: 6,
                background: engine === 'siliconflow' || engine === 'volcengine'
                  ? 'rgba(82, 88, 99, 0.1)'
                  : 'transparent',
                color: cloudError ? '#dc2626' : '#858b93',
                cursor: listening || cloudBusy ? 'not-allowed' : 'pointer',
                opacity: listening || cloudBusy ? 0.5 : 1,
              },
            },
            settingsIcon,
          ),
          cloudBusy
            ? React.createElement(
              'span',
              { style: { fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' } },
              '转写中',
            )
            : null,
          settingsPanel,
        )
      },
    ))
  },
}
