(() => {
  const videos = [...document.querySelectorAll('video[data-stream]')];
  const players = new Map();
  let hlsLibrary;
  let selectedVideo;

  // Safari/iPhone do not need this library. Other browsers fetch it only
  // after the first request to play, sharing one download across all videos.
  const loadHls = () => {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (!hlsLibrary) {
      hlsLibrary = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/vendor/hls-1.6.19.min.js';
        script.async = true;
        script.onload = () => window.Hls ? resolve(window.Hls) : reject(new Error('Player unavailable'));
        script.onerror = () => {
          script.remove();
          hlsLibrary = null;
          reject(new Error('Player download failed'));
        };
        document.head.append(script);
      });
    }
    return hlsLibrary;
  };

  for (const video of videos) {
    const state = { player: null, ready: null, requesting: false };
    players.set(video, state);
    const playButton = document.createElement('button');
    playButton.type = 'button';
    playButton.className = 'video-play';
    playButton.setAttribute('aria-label', `Reproducir: ${video.getAttribute('aria-label')}`);
    playButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z"/></svg>';
    video.parentElement.append(playButton);
    // Vídeo de bienvenida: arranca solo y en silencio; "Activar sonido" lo reinicia desde el principio con audio.
    const autoplay = video.hasAttribute('data-autoplay');
    let soundButton = null;
    if (autoplay) {
      soundButton = document.createElement('button');
      soundButton.type = 'button';
      soundButton.className = 'video-sound';
      soundButton.hidden = true;
      soundButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16 8.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Activar sonido</span>';
      video.parentElement.append(soundButton);
      soundButton.addEventListener('click', async () => {
        soundButton.hidden = true;
        video.muted = false;
        video.volume = 1;
        try { video.currentTime = 0; } catch {}
        try { await video.play(); } catch { showError(); }
      });
    }
    const errorMessage = document.getElementById(video.getAttribute('aria-describedby'));
    const showError = () => {
      if (errorMessage) errorMessage.hidden = false;
      playButton.hidden = false;
    };
    const clearError = () => { if (errorMessage) errorMessage.hidden = true; };

    const prepare = () => {
      if (state.ready) return state.ready;
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Assign inside the user's gesture so native iOS playback remains inline.
        video.src = video.dataset.stream;
        state.ready = Promise.resolve();
        return state.ready;
      }
      state.ready = loadHls().then(Hls => new Promise((resolve, reject) => {
        if (!Hls.isSupported()) { reject(new Error('Unsupported player')); return; }
        const hls = new Hls({ autoStartLoad: false, maxBufferLength: 20, maxMaxBufferLength: 30, backBufferLength: 30 });
        state.player = hls;
        let networkRetries = 0;
        let mediaRetries = 0;
        const fail = () => {
          clearTimeout(timeout);
          showError();
          hls.destroy();
          state.player = null;
          state.ready = null;
          reject(new Error('Video load failed'));
        };
        const timeout = setTimeout(fail, 20000);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          clearTimeout(timeout);
          resolve();
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < 1) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++ < 1) {
            hls.recoverMediaError();
          } else fail();
        });
        hls.loadSource(video.dataset.stream);
        hls.attachMedia(video);
      })).catch(error => { state.ready = null; throw error; });
      return state.ready;
    };

    playButton.addEventListener('click', async () => {
      if (state.requesting) return;
      selectedVideo = video;
      for (const other of videos) {
        if (other !== video) {
          other.pause();
          players.get(other)?.player?.stopLoad();
        }
      }
      state.requesting = true;
      playButton.disabled = true;
      playButton.setAttribute('aria-busy', 'true');
      clearError();
      try {
        // Native playback must start before awaiting any promise (iOS gesture).
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          prepare();
          await video.play();
        } else {
          await prepare();
          if (selectedVideo !== video) return;
          state.player.startLoad();
          await video.play();
        }
      } catch { showError(); }
      finally {
        state.requesting = false;
        playButton.disabled = false;
        playButton.removeAttribute('aria-busy');
      }
    });
    video.addEventListener('playing', () => {
      clearError();
      playButton.hidden = true;
    });
    video.addEventListener('ended', () => { playButton.hidden = false; });
    video.addEventListener('play', () => {
      selectedVideo = video;
      state.player?.startLoad();
      for (const other of videos) {
        if (other !== video) {
          other.pause();
          players.get(other)?.player?.stopLoad();
        }
      }
    });
    video.addEventListener('pause', () => { state.player?.stopLoad(); });
    video.addEventListener('error', showError);
    if (autoplay) {
      playButton.hidden = true;
      (async () => {
        try {
          video.muted = true;
          if (video.canPlayType('application/vnd.apple.mpegurl')) {
            prepare();
          } else {
            await prepare();
            state.player.startLoad();
          }
          await video.play();
          soundButton.hidden = false;
        } catch {
          // Autoplay bloqueado (p. ej. ahorro de batería): se vuelve al botón de reproducir de siempre.
          playButton.hidden = false;
        }
      })();
      video.addEventListener('volumechange', () => { if (!video.muted && soundButton) soundButton.hidden = true; });
      video.addEventListener('ended', () => { if (soundButton) soundButton.hidden = true; });
    }
  }
  window.addEventListener('pagehide', event => {
    selectedVideo = null;
    for (const [video, state] of players) {
      video.pause();
      state.player?.stopLoad();
      if (!event.persisted) state.player?.destroy();
    }
  });
})();
