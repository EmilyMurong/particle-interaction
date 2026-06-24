class GestureController {
  constructor({ video, onGesture, onHandMove, onCameraError, onCameraReady, onStatus }) {
    this.video = video;
    this.onGesture = onGesture;
    this.onHandMove = onHandMove;
    this.onCameraError = onCameraError;
    this.onCameraReady = onCameraReady;
    this.onStatus = onStatus;
    this.lastGesture = "invisible";
    this.lastTriggeredAt = 0;
    this.lastTriggeredByGesture = {};
    this.cooldown = 1500;
    this.candidateName = null;
    this.candidateFrames = 0;
    this.requiredFrames = 4;
    this.debug = false;
    this.mirror = true;
    this.lastClassificationAt = 0;
    this.classificationInterval = 70;
    this.lastGestureState = { name: null, label: "等待手势中" };
    this.debugState = {
      isFist: false,
      fistFrames: 0,
      pinchDistance: 0,
      pinchFrames: 0,
      handCount: 0,
      leftPinching: false,
      rightPinching: false,
      leftHand: null,
      rightHand: null,
      lastTriggered: "none",
    };
    this.history = [];
    this.previousPalm = null;
    this.waveSamples = [];
    this.hands = null;
    this.camera = null;
    this.stream = null;
    this.processing = false;
    this.handStates = {
      left: { frames: 0, latched: false, active: false },
      right: { frames: 0, latched: false, active: false },
    };
  }

  async start() {
    if (this.processing) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      const error = new Error("Camera API is unavailable");
      error.name = window.isSecureContext ? "NotSupportedError" : "InsecureContextError";
      this.onCameraError?.(error);
      return;
    }

    if (!this.stream?.active) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: true });
        this.video.srcObject = this.stream;
        await this.video.play();
        this.onCameraReady?.();
      } catch (error) {
        this.video.srcObject = null;
        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = null;
        this.onCameraError?.(error);
        return;
      }
    }

    try {
      if (!window.Hands) {
        const error = new Error("MediaPipe Hands is unavailable");
        error.name = "MediaPipeError";
        throw error;
      }
      this.hands = new window.Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });
      this.hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.56,
        minTrackingConfidence: 0.52,
      });
      this.hands.onResults((results) => this.handleResults(results));

      this.processing = true;
      this.processFrame();
    } catch (error) {
      this.processing = false;
      this.onCameraError?.(error);
    }
  }

  async processFrame() {
    if (!this.processing) return;
    if (this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      requestAnimationFrame(() => this.processFrame());
      return;
    }
    try {
      await this.hands.send({ image: this.video });
    } catch (error) {
      this.processing = false;
      error.name = "MediaPipeError";
      this.onCameraError?.(error);
      return;
    }
    requestAnimationFrame(() => this.processFrame());
  }

  handleResults(results) {
    const entries = this.getHandEntries(results);
    if (!entries.length) {
      this.onStatus?.("等待手势中...");
      this.onHandMove?.(null);
      this.previousPalm = null;
      this.candidateName = null;
      this.candidateFrames = 0;
      this.debugState.isFist = false;
      this.debugState.fistFrames = 0;
      this.debugState.pinchDistance = 0;
      this.debugState.pinchFrames = 0;
      this.debugState.handCount = 0;
      this.debugState.leftPinching = false;
      this.debugState.rightPinching = false;
      this.debugState.leftHand = null;
      this.debugState.rightHand = null;
      this.resetHandState("left");
      this.resetHandState("right");
      return;
    }

    const controlHand = entries.find((entry) => entry.hand === "right") || entries[0];
    const hands = [controlHand.landmarks];
    const tracking = this.getTrackingState(hands);
    const now = performance.now();
    const pinches = this.updateHandStates(entries);
    this.onHandMove?.({
      x: tracking.origin.x,
      y: tracking.origin.y,
      speed: tracking.speed,
      pixelSpeed: tracking.pixelSpeed,
      vx: tracking.vx,
      vy: tracking.vy,
      openness: tracking.openness,
      area: tracking.area,
      direction: tracking.direction,
      debug: this.debugState,
      handCount: entries.length,
      active: true,
    });

    const pinch = pinches.find((item) => item.stable && !item.latched);
    if (pinch && now - (this.lastTriggeredByGesture.pinch || 0) >= this.cooldown) {
      this.handStates[pinch.hand].latched = true;
      this.lastTriggeredByGesture.pinch = now;
      this.lastGesture = "pinch";
      this.debugState.lastTriggered = "双指捏合";
      this.onStatus?.("当前手势：双指捏合");
      this.onGesture?.("pinch", pinch);
      return;
    }
    if (pinches.some((item) => item.active)) {
      this.onStatus?.("当前手势：双指捏合");
      return;
    }

    if (now - this.lastClassificationAt < this.classificationInterval) {
      return;
    }
    this.lastClassificationAt = now;

    const gesture = this.detectGesture(hands, tracking);
    const stableGesture = this.stabilizeGesture(gesture);
    this.onStatus?.(stableGesture ? `当前手势：${stableGesture.label}` : "等待手势中...");

    if (!stableGesture) {
      return;
    }

    if (now - (this.lastTriggeredByGesture[stableGesture.name] || 0) < this.cooldown) {
      return;
    }

    this.lastGesture = stableGesture.name;
    this.lastTriggeredAt = now;
    this.lastTriggeredByGesture[stableGesture.name] = now;
    this.debugState.lastTriggered = stableGesture.label;
    if (stableGesture.name === "clear") {
      this.waveSamples = [];
    }
    this.onGesture?.(stableGesture.name, stableGesture);
  }

  getTrackingState(hands) {
    const primary = hands[0];
    const fingers = this.getFingerStates(primary);
    const palm = this.getPalm(primary);
    const motion = this.getPalmMotion(palm);
    const area = this.getPalmArea(primary);
    const wave = this.detectWave(palm.x);
    return {
      origin: palm,
      speed: motion.speed,
      pixelSpeed: motion.pixelSpeed,
      vx: motion.vx,
      vy: motion.vy,
      openness: this.getOpenness(fingers),
      direction: wave.direction || motion.direction,
      area,
      wave,
    };
  }

  detectGesture(hands, tracking = this.getTrackingState(hands)) {
    const primary = hands[0];
    const fingers = this.getFingerStates(primary);
    const base = {
      origin: tracking.origin,
      speed: tracking.speed,
      direction: tracking.direction,
      area: tracking.area,
      fingers,
    };

    if (tracking.wave.detected) {
      return { ...base, name: "clear", label: "左右挥手" };
    }

    if (this.isFist(fingers)) {
      return { ...base, name: "fist", label: "握拳" };
    }

    if (this.isOpenPalm(fingers)) {
      return { ...base, name: "open", label: "张开手掌" };
    }

    return { ...base, name: null, label: "等待手势中" };
  }

  stabilizeGesture(gesture) {
    if (!gesture.name) {
      this.candidateName = null;
      this.candidateFrames = 0;
      this.debugState.isFist = false;
      this.debugState.fistFrames = 0;
      return null;
    }

    if (gesture.name !== this.candidateName) {
      this.candidateName = gesture.name;
      this.candidateFrames = 1;
    } else {
      this.candidateFrames += 1;
    }

    this.debugState.isFist = gesture.name === "fist";
    this.debugState.fistFrames = gesture.name === "fist" ? this.candidateFrames : 0;
    const needed = gesture.name === "clear"
      ? 2
      : gesture.name === "fist"
        ? 3
        : this.requiredFrames;
    if (this.debug) {
      console.debug("gesture", gesture.name, this.candidateFrames, gesture.fingers);
    }
    return this.candidateFrames >= needed ? gesture : null;
  }

  getFingerStates(hand) {
    const wrist = hand[0];
    const middleBase = hand[9];
    const palmSize = this.distance(wrist, middleBase) || 0.1;
    const index = this.getLongFingerState(hand, 8, 6, 5, palmSize);
    const middle = this.getLongFingerState(hand, 12, 10, 9, palmSize);
    const ring = this.getLongFingerState(hand, 16, 14, 13, palmSize);
    const pinky = this.getLongFingerState(hand, 20, 18, 17, palmSize);
    const thumbOpen = this.distance(hand[4], hand[9]) > palmSize * 0.72
      && this.distance(hand[4], hand[2]) > palmSize * 0.34;
    const thumbCurled = this.distance(hand[4], hand[9]) < palmSize * 0.66;

    return {
      thumb: { open: thumbOpen, curled: thumbCurled },
      index,
      middle,
      ring,
      pinky,
    };
  }

  getLongFingerState(hand, tipId, pipId, mcpId, palmSize) {
    const tip = hand[tipId];
    const pip = hand[pipId];
    const mcp = hand[mcpId];
    const tipToWrist = this.distance(tip, hand[0]);
    const pipToWrist = this.distance(pip, hand[0]);
    const tipAbovePip = tip.y < pip.y - palmSize * 0.055;
    const extendedLength = tipToWrist > pipToWrist + palmSize * 0.08
      || this.distance(tip, mcp) > palmSize * 0.62;
    const open = tipAbovePip && extendedLength;
    const curled = tip.y > pip.y - palmSize * 0.045
      || tipToWrist < pipToWrist + palmSize * 0.1
      || this.distance(tip, mcp) < palmSize * 0.68;
    return { open, curled };
  }

  isOpenPalm(fingers) {
    const longOpen = [fingers.index, fingers.middle, fingers.ring, fingers.pinky]
      .filter((finger) => finger.open).length;
    return longOpen >= 4 || (longOpen >= 3 && fingers.thumb.open);
  }

  isFist(fingers) {
    const longCurled = [fingers.index, fingers.middle, fingers.ring, fingers.pinky]
      .filter((finger) => finger.curled).length;
    return longCurled >= 3;
  }

  getOpenness(fingers) {
    const longOpen = [fingers.index, fingers.middle, fingers.ring, fingers.pinky]
      .filter((finger) => finger.open).length;
    const thumb = fingers.thumb.open ? 1 : 0;
    return Math.max(0, Math.min(1, (longOpen + thumb) / 5));
  }

  getHandEntries(results) {
    const landmarks = results.multiHandLandmarks || [];
    const handedness = results.multiHandedness || [];
    const used = new Set();
    return landmarks.map((hand, index) => {
      const item = handedness[index];
      const rawLabel = item?.label || item?.classification?.[0]?.label || "";
      const detectedLeft = rawLabel.toLowerCase() === "left";
      let handName = this.mirror
        ? (detectedLeft ? "right" : "left")
        : (detectedLeft ? "left" : "right");
      if (used.has(handName)) handName = handName === "left" ? "right" : "left";
      used.add(handName);
      return { hand: handName, landmarks: hand };
    });
  }

  updateHandStates(entries) {
    const present = new Set(entries.map((entry) => entry.hand));
    ["left", "right"].forEach((hand) => {
      if (!present.has(hand)) this.resetHandState(hand);
    });

    const pinches = entries.map((entry) => {
      const hand = entry.landmarks;
      const state = this.handStates[entry.hand];
      const palmSize = this.distance(hand[0], hand[9]) || 0.1;
      const pinchDistance = this.distance(hand[4], hand[8]) / palmSize;
      const active = pinchDistance < 0.48;
      state.frames = active ? state.frames + 1 : 0;
      if (!active) state.latched = false;
      state.active = active;

      const thumb = hand[4];
      const index = hand[8];
      const rawX = (thumb.x + index.x) * 0.5;
      const rawY = (thumb.y + index.y) * 0.5;
      const center = this.getPalm(hand);
      const fingers = this.getFingerStates(hand);
      const detail = {
        name: "pinch",
        label: "双指捏合",
        hand: entry.hand,
        active,
        stable: state.frames >= 4,
        latched: state.latched,
        pinchDistance,
        pinchFrames: state.frames,
        center,
        fingers,
        origin: {
          x: this.mirror ? 1 - rawX : rawX,
          y: rawY,
          z: ((thumb.z || 0) + (index.z || 0)) * 0.5,
        },
      };
      this.debugState[`${entry.hand}Hand`] = detail;
      return detail;
    });

    const left = this.handStates.left;
    const right = this.handStates.right;
    this.debugState.handCount = entries.length;
    this.debugState.leftPinching = left.active;
    this.debugState.rightPinching = right.active;
    const strongest = pinches.sort((a, b) => b.pinchFrames - a.pinchFrames)[0];
    this.debugState.pinchDistance = strongest?.pinchDistance || 0;
    this.debugState.pinchFrames = strongest?.pinchFrames || 0;
    return pinches;
  }

  resetHandState(hand) {
    const state = this.handStates[hand];
    state.frames = 0;
    state.latched = false;
    state.active = false;
    this.debugState[`${hand}Hand`] = null;
  }

  getPalm(hand) {
    const ids = [0, 5, 9, 13, 17];
    const point = ids.reduce((acc, id) => {
      acc.x += hand[id].x;
      acc.y += hand[id].y;
      acc.z += hand[id].z || 0;
      return acc;
    }, { x: 0, y: 0, z: 0 });

    return {
      x: this.mirror ? 1 - point.x / ids.length : point.x / ids.length,
      y: point.y / ids.length,
      z: point.z / ids.length,
    };
  }

  getPalmArea(hand) {
    const palmWidth = this.distance(hand[5], hand[17]);
    const palmHeight = this.distance(hand[0], hand[9]);
    return palmWidth * palmHeight;
  }

  isPalmNear(hand, area = this.getPalmArea(hand)) {
    const palmWidth = this.distance(hand[5], hand[17]);
    const palmHeight = this.distance(hand[0], hand[9]);
    return palmWidth > 0.23 || palmHeight > 0.25 || area > 0.048;
  }

  getPalmMotion(palm) {
    const now = performance.now();
    if (!this.previousPalm) {
      this.previousPalm = { ...palm, time: now };
      return { speed: 0, direction: 0 };
    }

    const dt = Math.max(16, now - this.previousPalm.time);
    const dx = palm.x - this.previousPalm.x;
    const dy = palm.y - this.previousPalm.y;
    const speed = Math.min(1, Math.hypot(dx, dy) / (dt / 1000) / 1.8);
    const direction = Math.abs(dx) > 0.006 ? Math.sign(dx) : 0;
    this.previousPalm = { ...palm, time: now };
    return {
      speed,
      direction,
      vx: dx / (dt / 16.67),
      vy: dy / (dt / 16.67),
      pixelSpeed: Math.hypot(dx, dy) * 1000 / dt,
    };
  }

  detectWave(palmX) {
    const now = performance.now();
    this.waveSamples.push({ x: palmX, time: now });
    this.waveSamples = this.waveSamples.filter((sample) => now - sample.time < 800);
    if (this.waveSamples.length < 5) {
      return { detected: false, direction: 0 };
    }

    const xs = this.waveSamples.map((sample) => sample.x);
    const range = Math.max(...xs) - Math.min(...xs);
    const first = this.waveSamples[0];
    const last = this.waveSamples[this.waveSamples.length - 1];
    const dx = last.x - first.x;
    const duration = Math.max(1, last.time - first.time);
    const speed = Math.abs(dx) / (duration / 1000);
    const detected = range > 0.17 && speed > 0.27;

    return {
      detected,
      direction: Math.sign(dx || 1),
    };
  }

  distance(a, b) {
    const dx = (a.x || 0) - (b.x || 0);
    const dy = (a.y || 0) - (b.y || 0);
    const dz = (a.z || 0) - (b.z || 0);
    return Math.hypot(dx, dy, dz);
  }
}

window.GestureController = GestureController;
