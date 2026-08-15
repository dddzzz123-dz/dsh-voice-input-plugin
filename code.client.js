/**
 * 语音输入插件（DSH Web GUI client 插件）
 *
 * 平台：Client（浏览器端）
 * 挂载点：conversation.input.right（composer 工具行右端，发送按钮左侧）
 * 依赖：浏览器 Web Speech API（SpeechRecognition / webkitSpeechRecognition）
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
        const recRef = React.useRef(null)
        const draftRef = React.useRef((input && input.draft) || '')
        const activeRef = React.useRef(false)
        const restartTimerRef = React.useRef(null)
        const baseDraftRef = React.useRef('')
        const carriedFinalRef = React.useRef('')
        const sessionFinalRef = React.useRef('')
        const interimRef = React.useRef('')
        const meterRef = React.useRef(null)
        const visualRef = React.useRef(null)

        React.useEffect(() => {
          draftRef.current = (input && input.draft) || ''
        }, [input && input.draft])

        React.useEffect(() => {
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

        function writeTranscript() {
          const spoken = carriedFinalRef.current + sessionFinalRef.current + interimRef.current
          const current = baseDraftRef.current || ''
          const next = current
            ? (spoken ? current + spoken : current)
            : spoken
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
          if (meter.stream) {
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

        async function startMeter() {
          const g = getGlobal()
          const mediaDevices = g && g.navigator && g.navigator.mediaDevices
          const AudioCtor = g && (g.AudioContext || g.webkitAudioContext)
          if (!mediaDevices || !AudioCtor || meterRef.current) return
          try {
            const stream = await mediaDevices.getUserMedia({ audio: true })
            if (!activeRef.current) {
              stream.getTracks().forEach((track) => track.stop())
              return
            }
            const audioContext = new AudioCtor()
            const source = audioContext.createMediaStreamSource(stream)
            const analyser = audioContext.createAnalyser()
            analyser.fftSize = 256
            source.connect(analyser)
            const data = new Uint8Array(analyser.frequencyBinCount)
            const meter = { stream, audioContext, analyser, data, raf: null }
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

        function toggle() {
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

        function switchLanguage() {
          const next = lang === 'zh-CN' ? 'en-US' : 'zh-CN'
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

        // 插件卸载时中止进行中的识别
        React.useEffect(() => () => {
          activeRef.current = false
          clearRestartTimer()
          stopMeter()
          stopVisualPulse()
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
        const langLabel = lang === 'zh-CN' ? '中' : 'EN'
        const nextLangLabel = lang === 'zh-CN' ? 'English' : '中文'

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
                : unsupported
                  ? '当前浏览器不支持语音识别（需 Chrome / Edge）'
                  : `语音输入（${lang === 'zh-CN' ? '中文' : 'English'}）`,
              onClick: toggle,
              'aria-label': listening ? '停止语音输入' : '开始语音输入',
              disabled: unsupported,
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
                cursor: unsupported ? 'not-allowed' : 'pointer',
                opacity: unsupported ? 0.5 : 1,
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
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
                lineHeight: 1,
              },
            },
            langLabel,
          ),
        )
      },
    ))
  },
}
