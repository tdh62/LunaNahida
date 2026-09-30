import workletURL from '@/lib/noise-worklet.mjs?url&no-inline';
import { playbackCoordinator, type PlaybackOwner } from '@/lib/playback-coordinator';

export type NoiseType = 'white' | 'pink' | 'brown';
export type NoiseStatus = 'stopped' | 'starting' | 'playing' | 'paused';
type Session = { context: AudioContext; node?: AudioWorkletNode; gain?: GainNode; version: number; pending?: Promise<void> };

export class NoisePlayer {
  private session: Session | null = null;
  private owner: PlaybackOwner = { stop: () => this.stop() };
  private volume = 20;
  private paused = false;

  constructor(private onStatus: (status: NoiseStatus) => void, private onError: (message: string) => void) {}

  stop() {
    const session = this.session;
    this.session = null;
    this.paused = false;
    playbackCoordinator().release(this.owner);
    if (session) {
      if (session.gain) {
        session.gain.gain.cancelScheduledValues(session.context.currentTime);
        session.gain.gain.setValueAtTime(0, session.context.currentTime);
        session.gain.disconnect();
      }
      if (session.node) {
        session.node.onprocessorerror = null;
        session.node.disconnect();
        session.node.port.close();
      }
      void session.context.close().catch(() => {});
    }
    this.onStatus('stopped');
  }

  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
    const session = this.session;
    if (session?.gain && !this.paused) {
      const parameter = session.gain.gain;
      parameter.cancelScheduledValues(session.context.currentTime);
      parameter.setTargetAtTime(this.volume / 100, session.context.currentTime, .025);
    }
  }

  pause() {
    const session = this.session;
    if (!session?.gain) { this.stop(); return; }
    this.paused = true;
    const version = ++session.version;
    session.gain.gain.cancelScheduledValues(session.context.currentTime);
    session.gain.gain.setValueAtTime(0, session.context.currentTime);
    playbackCoordinator().release(this.owner);
    this.onStatus('paused');
    session.pending = session.context.suspend().catch(error => {
      if (this.session !== session || version !== session.version) return;
      this.stop();
      this.onError(error instanceof Error ? error.message : '无法暂停噪音');
    });
  }

  async resume() {
    const session = this.session;
    if (!session?.gain) return;
    const version = ++session.version;
    playbackCoordinator().claim(this.owner);
    this.onStatus('starting');
    try {
      await session.pending;
      if (this.session !== session || version !== session.version) return;
      await session.context.resume();
      if (this.session !== session || version !== session.version || !playbackCoordinator().owns(this.owner)) return;
      if (session.context.state !== 'running') throw new Error('声音未能启动，请再次点击播放');
      this.paused = false;
      session.gain.gain.cancelScheduledValues(session.context.currentTime);
      session.gain.gain.setValueAtTime(0, session.context.currentTime);
      session.gain.gain.linearRampToValueAtTime(this.volume / 100, session.context.currentTime + .05);
      this.onStatus('playing');
    } catch (error) {
      if (this.session !== session || version !== session.version) return;
      this.stop();
      this.onError(error instanceof Error ? error.message : '无法继续播放噪音');
    }
  }

  async start(type: NoiseType) {
    this.stop();
    let session: Session | null = null;
    try {
      if (!['white', 'pink', 'brown'].includes(type)) throw new Error('未知噪音类型');
      const context = new AudioContext();
      session = { context, version: 0 };
      this.session = session;
      if (!context.audioWorklet) throw new Error('当前环境不支持噪音发生器，请使用桌面应用或安全的本地浏览器页面');
      playbackCoordinator().claim(this.owner);
      this.onStatus('starting');
      await Promise.all([context.resume(), context.audioWorklet.addModule(workletURL)]);
      if (this.session !== session || !playbackCoordinator().owns(this.owner)) return;
      if (context.state !== 'running') throw new Error('声音未能启动，请再次点击播放');
      const node = new AudioWorkletNode(context, 'lunanahida-noise', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { type },
      });
      const gain = context.createGain();
      session.node = node;
      session.gain = gain;
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(this.volume / 100, context.currentTime + .05);
      node.connect(gain);
      gain.connect(context.destination);
      node.onprocessorerror = () => {
        if (this.session !== session) return;
        this.stop();
        this.onError('噪音生成中断，请重新播放');
      };
      this.onStatus('playing');
    } catch (error) {
      if (session && this.session !== session) return;
      this.stop();
      this.onError(error instanceof Error ? error.message : '无法启动噪音播放');
    }
  }
}
