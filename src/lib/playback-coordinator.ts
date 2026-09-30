export type PlaybackOwner = { stop: () => void };
type PlaybackChannel = {
  postMessage: (message: string) => void;
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
};

export function createPlaybackCoordinator(channel?: PlaybackChannel) {
  let active: PlaybackOwner | null = null;
  channel?.addEventListener('message', event => {
    if (event.data !== 'play') return;
    const previous = active;
    active = null;
    previous?.stop();
  });
  return {
    claim(owner: PlaybackOwner) {
      if (active !== owner) {
        const previous = active;
        active = owner;
        previous?.stop();
      }
      channel?.postMessage('play');
    },
    release(owner: PlaybackOwner) { if (active === owner) active = null; },
    owns(owner: PlaybackOwner) { return active === owner; },
  };
}

let sharedCoordinator: ReturnType<typeof createPlaybackCoordinator> | null = null;
export function playbackCoordinator() {
  if (!sharedCoordinator) {
    let channel: BroadcastChannel | undefined;
    try { if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel('lunanahidatune-playback'); }
    catch { channel = undefined; }
    sharedCoordinator = createPlaybackCoordinator(channel);
  }
  return sharedCoordinator;
}
