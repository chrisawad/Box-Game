// Isolated browser tests run on one host. Keep ICE on that host as well,
// so public STUN availability cannot decide whether local matchmaking works.
export function useLocalIce() {
  function local(config?: RTCConfiguration): RTCConfiguration {
    if (config?.iceTransportPolicy === "relay") {
      document.documentElement.dataset.relaySeat = config.iceServers?.find(server => server.username)?.username;
    }
    return { ...config, iceServers: [], iceTransportPolicy: "all" };
  }
  window.RTCPeerConnection = class extends RTCPeerConnection {
    constructor(config?: RTCConfiguration) { super(local(config)); }
    override setConfiguration(config?: RTCConfiguration) { super.setConfiguration(local(config)); }
  };
}
