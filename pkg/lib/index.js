// Node half of @local/dsh-voice-input: pure UI client plugin.
// The empty apply exists only so this package appears in the host Loader and
// its browser half ships via exports["./client"] (discovered through the
// package.json `dsh.client` declaration). All behavior lives in the browser.
export function apply() {}
