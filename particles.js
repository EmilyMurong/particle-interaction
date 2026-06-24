class ParticleArtwork {
  constructor(canvas) {
    this.canvas = canvas;
    this.runtime = window.APP_RUNTIME || {};
    const contextOptions = {
      alpha: true,
      antialias: false,
      powerPreference: this.runtime.isSafari ? "default" : "high-performance",
      preserveDrawingBuffer: false,
    };
    const context = this.runtime.isSafari
      ? canvas.getContext("webgl", contextOptions)
        || canvas.getContext("experimental-webgl", contextOptions)
        || canvas.getContext("webgl2", contextOptions)
      : canvas.getContext("webgl2", contextOptions)
        || canvas.getContext("webgl", contextOptions)
        || canvas.getContext("experimental-webgl", contextOptions);
    if (!context) {
      throw new Error("WebGL 初始化失败");
    }
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      window.showRuntimeError?.("WebGL 连接已中断，请刷新页面；Safari 已启用低效果模式");
    });
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context,
      antialias: false,
      alpha: true,
      powerPreference: this.runtime.isSafari ? "default" : "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.runtime.isSafari ? 0.88 : 0.96;
    this.renderer.setClearColor(0x02040d, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 100);
    this.camera.position.z = 8.5;

    this.clock = new THREE.Clock();
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.modelName = "nebula";
    this.modelLabel = "星云";
    this.displayLabel = this.modelLabel;
    this.messageActive = false;
    this.loveMessageActive = false;
    this.imageVisible = false;
    this.imageFlow = 0;
    this.imageLayoutPhase = 0;
    this.imageStage = 0;
    this.imageStageTime = 0;
    this.imageHeartTargets = null;
    this.textTargetCount = 0;
    this.lastTriggered = "none";
    this.baseColor = new THREE.Color("#b46cff");
    this.hand = {
      tracked: false,
      x: 0.5,
      y: 0.5,
      openness: 0.55,
      speed: 0,
      vx: 0,
      vy: 0,
      direction: 0,
    };
    this.burst = 0;
    this.targetRotation = { x: 0, y: 0, z: 0 };
    this.stats = {
      fps: 60,
      particles: 0,
      targets: 0,
      model: this.modelLabel,
      openness: 0,
      handSpeed: 0,
      tracked: false,
    };

    this.density = this.defaultDensity();
    this.maxCount = this.density;
    this.positions = null;
    this.targets = null;
    this.colors = null;
    this.sizes = null;
    this.seeds = null;
    this.points = null;
    this.glowPoints = null;
    this.geometry = null;
    this.material = null;
    this.glowMaterial = null;
    this.backgroundPoints = null;
    this.starField = null;
    this.starLayers = [];
    this.backgroundCount = 0;
    this.composer = null;
    this.bloomPass = null;
    this.afterimagePass = null;
    this.lowFpsFrames = 0;
    this.textTargetCache = new Map();

    this.resize();
    this.createPostProcessing();
    this.createParticleSystem(this.density);
    this.createBackground();
    this.setModel("nebula");

    window.addEventListener("resize", () => this.resize());
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  defaultDensity() {
    const width = window.innerWidth;
    const dpr = window.devicePixelRatio || 1;
    const cores = navigator.hardwareConcurrency || 4;
    if (this.runtime.isSafari) {
      if (width <= 700) return 8000;
      return cores <= 4 ? 10000 : 14000;
    }
    if (width <= 700) return dpr > 2.5 || cores <= 4 ? 12000 : 18000;
    if (width <= 1100) return dpr > 2 || cores <= 4 ? 24000 : 36000;
    return cores <= 4 ? 50000 : 52000;
  }

  clampDensity(value) {
    const width = window.innerWidth;
    const requested = Number(value) || this.defaultDensity();
    if (this.runtime.isSafari) {
      return Math.max(8000, Math.min(15000, requested));
    }
    if (width <= 700) return Math.max(12000, Math.min(24000, requested));
    if (width <= 1100) return Math.max(24000, Math.min(48000, requested));
    return Math.max(50000, Math.min(70000, requested));
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dprLimit = this.runtime.isSafari ? 1 : width <= 700 ? 1.25 : 1.5;
    const dpr = Math.min(window.devicePixelRatio || 1, dprLimit);
    const postDpr = Math.min(dpr, this.runtime.isSafari ? 0.75 : 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.composer?.setPixelRatio(postDpr);
    this.composer?.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.starLayers.forEach((layer) => {
      layer.material.uniforms.uPixelRatio.value = Math.min(
        window.devicePixelRatio || 1,
        this.runtime.isSafari ? 1 : 1.5,
      );
    });
    this.updateBackgroundDistribution();
  }

  createPostProcessing() {
    if (
      !window.EffectComposer
      || !window.UnrealBloomPass
      || (this.runtime.lowEffects && !this.runtime.isSafari)
    ) return;
    try {
      const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
      this.composer = new window.EffectComposer(this.renderer);
      this.composer.addPass(new window.RenderPass(this.scene, this.camera));
      const bloomStrength = this.runtime.isSafari ? 0.48 : 0.68;
      const bloomRadius = this.runtime.isSafari ? 0.3 : 0.4;
      const bloomThreshold = this.runtime.isSafari ? 0.42 : 0.32;
      this.bloomPass = new window.UnrealBloomPass(
        resolution,
        bloomStrength,
        bloomRadius,
        bloomThreshold,
      );
      this.composer.addPass(this.bloomPass);
      if (window.AfterimagePass && !this.runtime.isSafari && !this.runtime.lowEffects) {
        this.afterimagePass = new window.AfterimagePass(0.76);
        this.composer.addPass(this.afterimagePass);
      }
    } catch (error) {
      this.composer?.dispose?.();
      this.composer = null;
      this.bloomPass = null;
      this.afterimagePass = null;
      window.showRuntimeError?.("Safari 后期渲染不可用，已自动关闭 bloom");
    }
  }

  createMaterial({ glow = false } = {}) {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: true,
      uniforms: {
        uPixelRatio: {
          value: Math.min(window.devicePixelRatio || 1, this.runtime.isSafari ? 1 : 1.5),
        },
        uTime: { value: 0 },
        uPointScale: { value: glow ? 2.05 : 1.02 },
        uOpacity: { value: glow ? 0.14 : 0.74 },
        uBrightness: { value: glow ? 0.92 : 1.2 },
        uGlow: { value: glow ? 1 : 0 },
      },
      vertexShader: `
        attribute float aSize;
        attribute vec3 aColor;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uPixelRatio;
        uniform float uTime;
        uniform float uPointScale;
        void main() {
          vColor = aColor;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float depthScale = 300.0 / max(1.0, -mvPosition.z);
          float pulse = 0.92 + 0.16 * sin(uTime * 2.25 + aSize * 13.0);
          gl_PointSize = aSize * uPointScale * uPixelRatio * depthScale * pulse;
          gl_Position = projectionMatrix * mvPosition;
          vAlpha = clamp(depthScale / 42.0, 0.58, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uOpacity;
        uniform float uBrightness;
        uniform float uGlow;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);
          if (d > 0.5) discard;
          float core = smoothstep(0.26, 0.0, d);
          float halo = smoothstep(0.5, 0.16, d);
          float mainShape = core * 0.94 + halo * 0.12;
          float glowShape = core * 0.18 + halo * 0.52;
          float alpha = mix(mainShape, glowShape, uGlow) * vAlpha * uOpacity;
          vec3 radiantColor = vColor * uBrightness * (1.0 + core * 0.12);
          gl_FragColor = vec4(radiantColor, alpha);
        }
      `,
    });
  }

  createParticleSystem(count) {
    this.maxCount = this.clampDensity(count);
    this.positions = new Float32Array(this.maxCount * 3);
    this.targets = new Float32Array(this.maxCount * 3);
    this.colors = new Float32Array(this.maxCount * 3);
    this.sizes = new Float32Array(this.maxCount);
    this.seeds = new Float32Array(this.maxCount);
    this.imageHeartTargets = new Float32Array(this.maxCount * 3);

    for (let i = 0; i < this.maxCount; i += 1) {
      const i3 = i * 3;
      this.positions[i3] = (Math.random() - 0.5) * 8;
      this.positions[i3 + 1] = (Math.random() - 0.5) * 5;
      this.positions[i3 + 2] = (Math.random() - 0.5) * 5;
      this.seeds[i] = Math.random() * Math.PI * 2;
      const highlight = Math.random() < 0.07;
      this.sizes[i] = highlight
        ? 0.034 + Math.random() * 0.018
        : 0.018 + Math.random() * 0.016;
    }

    this.geometry?.dispose();
    this.material?.dispose();
    this.glowMaterial?.dispose();
    if (this.points) this.group.remove(this.points);
    if (this.glowPoints) this.group.remove(this.glowPoints);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("aColor", new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));
    this.material = this.createMaterial({ glow: false });
    this.glowMaterial = this.createMaterial({ glow: true });
    this.points = new THREE.Points(this.geometry, this.material);
    this.glowPoints = new THREE.Points(this.geometry, this.glowMaterial);
    this.glowPoints.renderOrder = 0;
    this.points.renderOrder = 1;
    this.group.add(this.glowPoints);
    this.group.add(this.points);
    this.stats.particles = this.maxCount;
  }

  createBackground() {
    const baseCount = window.innerWidth <= 700 ? 720 : window.innerWidth <= 1100 ? 1120 : 1480;
    const layerConfigs = [
      {
        count: Math.round(baseCount * 250),
        size: 1,
        opacity: 0.045,
        depth: [30, 76],
        drift: 1.05,
        speed: 0.16,
        flow: [0.55, 0.24],
      },
      {
        count: Math.round(baseCount * 65),
        size: 1.35,
        opacity: 0.105,
        depth: [19, 52],
        drift: 1.55,
        speed: 0.25,
        flow: [1.05, 0.46],
      },
      {
        count: Math.round(baseCount * 18),
        size: 2,
        opacity: 0.21,
        depth: [12, 36],
        drift: 2.15,
        speed: 0.36,
        flow: [1.65, 0.72],
      },
    ];

    this.starLayers = layerConfigs.map((config, layerIndex) => {
      const positions = new Float32Array(config.count * 3);
      const colors = new Float32Array(config.count * 3);
      const seeds = new Float32Array(config.count);
      for (let i = 0; i < config.count; i += 1) {
        const i3 = i * 3;
        const tint = 0.58 + Math.random() * 0.38;
        const brightness = layerIndex === 2 ? 0.9 : layerIndex === 1 ? 0.72 : 0.52;
        colors[i3] = 0.35 * tint * brightness;
        colors[i3 + 1] = 0.46 * tint * brightness;
        colors[i3 + 2] = 0.9 * tint * brightness;
        seeds[i] = Math.random() * Math.PI * 2;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        toneMapped: true,
        uniforms: {
          uTime: { value: 0 },
          uPointSize: { value: config.size },
          uOpacity: { value: config.opacity },
          uDrift: { value: config.drift },
          uSpeed: { value: config.speed },
          uFlow: { value: new THREE.Vector2(config.flow[0], config.flow[1]) },
          uPixelRatio: {
            value: Math.min(window.devicePixelRatio || 1, this.runtime.isSafari ? 1 : 1.5),
          },
        },
        vertexShader: `
          attribute vec3 color;
          attribute float aSeed;
          varying vec3 vColor;
          varying float vTwinkle;
          uniform float uTime;
          uniform float uPointSize;
          uniform float uDrift;
          uniform float uSpeed;
          uniform vec2 uFlow;
          uniform float uPixelRatio;
          void main() {
            vec3 animatedPosition = position;
            float motion = uTime * uSpeed;
            animatedPosition.x += (
              sin(motion + aSeed) * 0.68
              + sin(motion * 0.43 + aSeed * 0.37) * 0.32
            ) * uDrift;
            animatedPosition.y += (
              cos(motion * 0.83 + aSeed * 1.37) * 0.7
              + sin(motion * 0.36 + aSeed * 0.51) * 0.3
            ) * uDrift * 0.62;
            animatedPosition.x += sin(motion * 0.58 + aSeed * 0.12) * uFlow.x;
            animatedPosition.y += cos(motion * 0.47 + aSeed * 0.16) * uFlow.y;
            animatedPosition.z += sin(motion * 0.46 + aSeed * 2.1) * uDrift * 0.24;
            vec4 mvPosition = modelViewMatrix * vec4(animatedPosition, 1.0);
            float depthFade = clamp(28.0 / max(12.0, -mvPosition.z), 0.65, 1.2);
            gl_PointSize = max(1.0, uPointSize * uPixelRatio * depthFade);
            gl_Position = projectionMatrix * mvPosition;
            vColor = color;
            vTwinkle = 0.74 + 0.26 * sin(uTime * (0.8 + uSpeed) + aSeed * 2.7);
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          varying float vTwinkle;
          uniform float uOpacity;
          void main() {
            vec2 uv = gl_PointCoord - vec2(0.5);
            float distanceToCenter = length(uv);
            if (distanceToCenter > 0.5) discard;
            float alpha = smoothstep(0.5, 0.08, distanceToCenter) * uOpacity * vTwinkle;
            gl_FragColor = vec4(vColor, alpha);
          }
        `,
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      points.renderOrder = -3 + layerIndex;
      points.userData = {
        baseOpacity: config.opacity,
        depthMin: config.depth[0],
        depthMax: config.depth[1],
        phase: layerIndex * 2.1,
      };
      return points;
    });

    this.backgroundPoints = this.starLayers[0];
    this.backgroundCount = this.starLayers.reduce(
      (sum, layer) => sum + layer.geometry.attributes.position.count,
      0,
    );
    this.starField = new THREE.Group();
    this.starLayers.forEach((layer) => this.starField.add(layer));
    this.starField.renderOrder = -3;
    this.scene.add(this.starField);
    this.updateBackgroundDistribution();
  }

  updateBackgroundDistribution() {
    if (!this.starLayers.length) return;
    const aspect = this.camera.aspect || window.innerWidth / window.innerHeight;
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const tanHalfFov = Math.tan(halfFov);
    const overscan = 1.16;
    const fract = (value) => value - Math.floor(value);

    this.starLayers.forEach((layer, layerIndex) => {
      const attribute = layer.geometry.attributes.position;
      const positions = attribute.array;
      const count = attribute.count;
      const { depthMin, depthMax } = layer.userData;
      for (let i = 0; i < count; i += 1) {
        const i3 = i * 3;
        const sampleIndex = i + 1 + layerIndex * 7919;
        const normalizedX = fract(sampleIndex * 0.7548776662466927) * 2 - 1;
        const normalizedY = fract(sampleIndex * 0.5698402909980532) * 2 - 1;
        const depthRatio = fract(sampleIndex * 0.438579021);
        const distance = depthMin + depthRatio * (depthMax - depthMin);
        const halfHeight = tanHalfFov * distance * overscan;
        const halfWidth = halfHeight * aspect;

        positions[i3] = normalizedX * halfWidth;
        positions[i3 + 1] = normalizedY * halfHeight;
        positions[i3 + 2] = this.camera.position.z - distance;
      }
      attribute.needsUpdate = true;
    });
  }

  setDensity(value) {
    const next = this.clampDensity(value);
    if (next === this.maxCount) return;
    this.density = next;
    this.createParticleSystem(next);
    this.setModel(this.modelName);
  }

  setBaseColor(hex) {
    this.baseColor.set(hex);
    this.refreshColors();
  }

  setModel(name) {
    const labels = {
      nebula: "星云",
      firework: "烟花",
      saturn: "土星",
      flower: "花朵",
      heart: "爱心",
    };
    this.modelName = name;
    this.modelLabel = labels[name] || "星云";
    this.displayLabel = this.modelLabel;
    this.messageActive = false;
    this.loveMessageActive = false;
    this.hideImage();
    this.generateTargets(name);
    this.refreshColors();
    this.stats.model = this.modelLabel;
    this.stats.targets = this.maxCount;
  }

  restoreSelectedModel() {
    if (!this.messageActive) return;
    this.lastTriggered = "无手势";
    this.displayLabel = this.modelLabel;
    this.messageActive = false;
    this.loveMessageActive = false;
    this.textTargetCount = 0;
    this.burst = 0;
    this.generateTargets(this.modelName);
    this.refreshColors();
  }

  setHand(hand) {
    if (!hand || !hand.active) {
      this.hand.tracked = false;
      this.hand.speed *= 0.88;
      return;
    }
    this.hand.tracked = true;
    this.hand.x = hand.x;
    this.hand.y = hand.y;
    this.hand.openness = hand.openness ?? 0.55;
    this.hand.speed = Math.min(1, Math.max(hand.speed || 0, (hand.pixelSpeed || 0) / 1200));
    this.hand.vx = hand.vx || 0;
    this.hand.vy = hand.vy || 0;
    this.hand.direction = hand.direction || 0;
    if (this.hand.speed > 0.72) {
      this.burst = Math.min(1, this.burst + 0.22);
    }
  }

  transition(name, detail) {
    if (name === "open") {
      this.hideImage();
      this.lastTriggered = "陈宝宝";
      this.gatherNearHand();
      window.setTimeout(() => {
        if (this.lastTriggered === "陈宝宝") this.applyTextMessage("陈宝宝", "陈宝宝");
      }, 120);
      this.burst = Math.min(1, this.burst + 0.16);
    }
    if (name === "fist") {
      this.hideImage();
      this.lastTriggered = "I Love You";
      this.gatherNearHand();
      this.burst = 1;
      window.setTimeout(() => {
        if (this.lastTriggered === "I Love You") this.applyLoveMessage();
      }, 150);
    }
    if (name === "clear") {
      this.hideImage();
      this.messageActive = false;
      this.loveMessageActive = false;
      this.displayLabel = this.modelLabel;
      this.textTargetCount = 0;
      this.lastTriggered = "清空";
      this.generateTargets(this.modelName);
      this.burst = 1;
      this.hand.vx += this.hand.direction * 0.45;
    }
    if (name === "pinch") {
      this.showSelectedImage(detail);
    }
  }

  showSelectedImage(detail) {
    this.lastTriggered = "双指捏合";
    this.displayLabel = this.modelLabel;
    this.messageActive = false;
    this.loveMessageActive = false;
    this.textTargetCount = 0;
    this.imageVisible = true;
    this.imageFlow = 1.15;
    this.imageLayoutPhase += 1.37;
    this.imageStage = 1;
    this.imageStageTime = 0;

    for (let i = 0; i < this.maxCount; i += 1) {
      const i3 = i * 3;
      const seed = this.seeds[i];
      const angle = seed + i * 0.021 + this.imageLayoutPhase;
      const layer = (i % 37) / 36;

      const edge = i % 4;
      const horizontalExtent = 5.6 + layer * 2.25;
      const verticalExtent = 3.45 + layer * 1.55;
      if (edge === 0) {
        this.targets[i3] = -horizontalExtent;
        this.targets[i3 + 1] = Math.sin(angle) * verticalExtent;
      } else if (edge === 1) {
        this.targets[i3] = horizontalExtent;
        this.targets[i3 + 1] = Math.sin(angle) * verticalExtent;
      } else if (edge === 2) {
        this.targets[i3] = Math.cos(angle) * horizontalExtent;
        this.targets[i3 + 1] = verticalExtent;
      } else {
        this.targets[i3] = Math.cos(angle) * horizontalExtent;
        this.targets[i3 + 1] = -verticalExtent;
      }
      this.targets[i3 + 2] = -0.3 + Math.sin(seed * 2.4) * 0.48;

      const heartT = (i / this.maxCount) * Math.PI * 2 + this.imageLayoutPhase * 0.13;
      const heartX = 16 * Math.sin(heartT) ** 3;
      const heartY = 13 * Math.cos(heartT)
        - 5 * Math.cos(heartT * 2)
        - 2 * Math.cos(heartT * 3)
        - Math.cos(heartT * 4);
      const thickness = ((i % 23) / 22 - 0.5) * 0.2;
      const heartScale = 0.245 + thickness * 0.11;
      this.imageHeartTargets[i3] = heartX * heartScale;
      this.imageHeartTargets[i3 + 1] = heartY * heartScale - 0.35;
      this.imageHeartTargets[i3 + 2] = -0.05 + Math.sin(seed * 2.4) * 0.18;
    }
    this.burst = 0.18;
  }

  hideImage() {
    this.imageVisible = false;
    this.imageFlow = 0;
    this.imageStage = 0;
    this.imageStageTime = 0;
  }

  generateTargets(name) {
    for (let i = 0; i < this.maxCount; i += 1) {
      const i3 = i * 3;
      let p;
      if (name === "firework") p = this.fireworkPoint(i);
      else if (name === "saturn") p = this.saturnPoint(i);
      else if (name === "flower") p = this.flowerPoint(i);
      else if (name === "heart") p = this.heartPoint(i);
      else p = this.nebulaPoint(i);
      this.targets[i3] = p.x;
      this.targets[i3 + 1] = p.y;
      this.targets[i3 + 2] = p.z;
    }
  }

  nebulaPoint(i) {
    const arm = i % 4;
    const t = Math.random() * Math.PI * 2 + arm * Math.PI * 0.5;
    const r = Math.pow(Math.random(), 0.55) * 2.25;
    const twist = t + r * 1.8;
    return {
      x: Math.cos(twist) * r + (Math.random() - 0.5) * 0.75,
      y: (Math.random() - 0.5) * 1.35 + Math.sin(r * 2.2) * 0.15,
      z: Math.sin(twist) * r * 0.72 + (Math.random() - 0.5) * 0.95,
    };
  }

  fireworkPoint() {
    const u = Math.random();
    const v = Math.random();
    const theta = Math.PI * 2 * u;
    const phi = Math.acos(2 * v - 1);
    const inner = Math.random() < 0.32;
    const r = inner
      ? Math.pow(Math.random(), 0.72) * 1.5
      : 0.45 + Math.pow(Math.random(), 0.42) * 2.4;
    return {
      x: Math.sin(phi) * Math.cos(theta) * r,
      y: Math.cos(phi) * r,
      z: Math.sin(phi) * Math.sin(theta) * r,
    };
  }

  saturnPoint(i) {
    if (i < this.maxCount * 0.44) {
      const u = Math.random();
      const v = Math.random();
      const theta = Math.PI * 2 * u;
      const phi = Math.acos(2 * v - 1);
      const r = Math.cbrt(Math.random()) * 1.08;
      return {
        x: Math.sin(phi) * Math.cos(theta) * r,
        y: Math.cos(phi) * r,
        z: Math.sin(phi) * Math.sin(theta) * r,
      };
    }
    const angle = Math.random() * Math.PI * 2;
    const r = 1.35 + Math.random() * 1.6;
    return {
      x: Math.cos(angle) * r,
      y: (Math.random() - 0.5) * 0.12,
      z: Math.sin(angle) * r * 0.36,
    };
  }

  flowerPoint() {
    const angle = Math.random() * Math.PI * 2;
    const petal = 0.9 + 0.9 * Math.abs(Math.sin(angle * 5));
    const r = Math.pow(Math.random(), 0.62) * petal;
    return {
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r * 0.95,
      z: Math.cos(angle * 5) * 0.34 + (Math.random() - 0.5) * 0.18,
    };
  }

  heartPoint() {
    const t = Math.random() * Math.PI * 2;
    const scale = 0.088 + Math.random() * 0.042;
    const fill = Math.random() < 0.72 ? Math.pow(Math.random(), 0.48) : 0.92 + Math.random() * 0.08;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    return {
      x: x * scale * fill,
      y: y * scale * fill - 0.12,
      z: (Math.random() - 0.5) * 0.72,
    };
  }

  applyTextMessage(text, label) {
    this.messageActive = true;
    this.loveMessageActive = false;
    this.displayLabel = label;
    const points = this.generateTextTargets(text, this.maxCount);
    this.textTargetCount = points.length;
    this.assignCustomTargets(points);
    this.refreshColors();
  }

  applyLoveMessage() {
    this.messageActive = true;
    this.loveMessageActive = true;
    this.displayLabel = "I Love You !";
    const textPoints = this.generateTextTargets(
      "I Love You !",
      this.maxCount,
      0,
      -0.38,
      0.0108,
    );
    this.textTargetCount = textPoints.length;
    const textParticleCount = Math.floor(this.maxCount * 0.88);
    for (let i = 0; i < this.maxCount; i += 1) {
      const i3 = i * 3;
      if (i < textParticleCount) {
        const point = textPoints[i % textPoints.length];
        const seed = this.seeds[i];
        this.targets[i3] = point.x + Math.sin(seed * 1.7) * 0.012;
        this.targets[i3 + 1] = point.y + Math.cos(seed * 1.3) * 0.012;
        this.targets[i3 + 2] = Math.sin(seed * 2.1) * 0.025;
      } else {
        const heart = this.heartPoint();
        this.targets[i3] = heart.x * 0.48;
        this.targets[i3 + 1] = heart.y * 0.48 + 1.08;
        this.targets[i3 + 2] = heart.z * 0.16;
      }
    }
    this.refreshColors();
  }

  gatherNearHand() {
    const hx = (this.hand.x - 0.5) * 5.2;
    const hy = (0.5 - this.hand.y) * 3.2;
    for (let i = 0; i < this.maxCount; i += 1) {
      const i3 = i * 3;
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 0.55;
      this.targets[i3] = hx + Math.cos(angle) * radius;
      this.targets[i3 + 1] = hy + Math.sin(angle) * radius;
      this.targets[i3 + 2] = (Math.random() - 0.5) * 0.35;
    }
  }

  assignCustomTargets(points) {
    if (!points.length) return;
    for (let i = 0; i < this.maxCount; i += 1) {
      const p = points[i % points.length];
      const i3 = i * 3;
      this.targets[i3] = p.x;
      this.targets[i3 + 1] = p.y;
      this.targets[i3 + 2] = p.z || 0;
    }
    this.stats.targets = Math.min(points.length, this.maxCount);
  }

  generateTextTargets(text, maxPoints, xOffset = 0, yOffset = 0, scale = 0.018) {
    const cacheKey = `${text}|${maxPoints}|${xOffset}|${yOffset}|${scale}`;
    const cached = this.textTargetCache.get(cacheKey);
    if (cached) return cached;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const isChinese = /[\u3400-\u9fff]/.test(text);
    let fontSize = isChinese ? 156 : 118;
    const family = `"PingFang SC", "Microsoft YaHei", "Noto Sans SC", Arial, sans-serif`;
    ctx.font = `700 ${fontSize}px ${family}`;
    const maxWidth = 760;
    while (ctx.measureText(text).width > maxWidth && fontSize > 48) {
      fontSize -= 4;
      ctx.font = `700 ${fontSize}px ${family}`;
    }
    canvas.width = Math.ceil(ctx.measureText(text).width + fontSize * 0.7);
    canvas.height = Math.ceil(fontSize * 1.45);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `700 ${fontSize}px ${family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const step = isChinese ? 4 : 3;
    const points = [];
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        const alpha = image[(y * canvas.width + x) * 4 + 3];
        if (alpha > 80) {
          points.push({
            x: (x - canvas.width / 2) * scale + xOffset,
            y: -(y - canvas.height / 2) * scale + yOffset,
            z: (Math.random() - 0.5) * 0.12,
          });
        }
      }
    }
    if (points.length <= maxPoints) {
      this.textTargetCache.set(cacheKey, points);
      return points;
    }
    const sampled = [];
    const stride = points.length / maxPoints;
    for (let i = 0; i < maxPoints; i += 1) sampled.push(points[Math.floor(i * stride)]);
    this.textTargetCache.set(cacheKey, sampled);
    return sampled;
  }

  refreshColors() {
    const c = this.baseColor;
    const hotPink = new THREE.Color("#ff3eae");
    const violet = new THREE.Color("#b88aff");
    const electricBlue = new THREE.Color("#69cfff");
    const whiteHighlight = new THREE.Color("#fff2ff");
    const customColor = c.clone().offsetHSL(0, 0.2, 0.16);
    for (let i = 0; i < this.maxCount; i += 1) {
      const i3 = i * 3;
      const colorBand = i % 12;
      let color;
      if (colorBand < 1) {
        color = whiteHighlight;
      } else if (colorBand < 6) {
        color = hotPink;
      } else if (colorBand < 8) {
        color = violet;
      } else if (colorBand < 10) {
        color = electricBlue;
      } else {
        color = customColor;
      }
      const highlight = this.sizes[i] > 0.045 ? 1.08 : 0.96 + Math.random() * 0.12;
      this.colors[i3] = color.r * highlight;
      this.colors[i3 + 1] = color.g * highlight;
      this.colors[i3 + 2] = color.b * highlight;
    }
    if (this.geometry?.attributes?.aColor) {
      this.geometry.attributes.aColor.needsUpdate = true;
    }
  }

  animate(now) {
    const rawDelta = this.clock.getDelta();
    const dt = Math.min(rawDelta * 60, 2);
    const time = now * 0.001;
    const openness = this.hand.tracked ? this.hand.openness : 0.55;
    const visualOpenness = this.messageActive ? 0.55 : openness;
    const spread = this.messageActive || this.imageVisible
      ? 1
      : 0.72 + visualOpenness * 0.84 + this.burst * 0.65;
    const handX = (this.hand.x - 0.5) * 2;
    const handY = (0.5 - this.hand.y) * 2;
    const handSceneX = handX * 2.65;
    const handSceneY = handY * 1.75;
    const influenceRadius = 1.45 + this.hand.speed * 0.85;
    const influenceRadiusSq = influenceRadius * influenceRadius;
    const velocityX = this.hand.vx * (0.5 + this.hand.speed * 1.5);
    const velocityY = -this.hand.vy * (0.5 + this.hand.speed * 1.5);

    this.targetRotation.y = this.loveMessageActive || this.imageVisible
      ? 0
      : handX * 1.05 + this.hand.vx * 0.026;
    this.targetRotation.x = this.loveMessageActive || this.imageVisible
      ? 0
      : handY * 0.68 - this.hand.vy * 0.018;
    if (this.loveMessageActive || this.imageVisible) {
      this.targetRotation.z *= 0.9 ** dt;
    } else {
      this.targetRotation.z += (this.modelName === "saturn" ? 0.008 : 0.003) * dt + this.hand.speed * 0.018;
    }
    this.group.rotation.x += (this.targetRotation.x - this.group.rotation.x) * 0.06 * dt;
    this.group.rotation.y += (this.targetRotation.y - this.group.rotation.y) * 0.06 * dt;
    this.group.rotation.z += (this.targetRotation.z - this.group.rotation.z) * 0.035 * dt;
    const targetGroupY = this.loveMessageActive || this.imageVisible ? 0 : handY * 0.55;
    this.group.position.y += (targetGroupY - this.group.position.y) * 0.05 * dt;
    if (this.imageVisible) {
      this.imageStageTime += dt;
      if (this.imageStage === 1 && this.imageStageTime > 28) {
        this.imageStage = 2;
        this.imageStageTime = 0;
        this.imageFlow = 1.05;
      }
    }

    for (let i = 0; i < this.maxCount; i += 1) {
      const i3 = i * 3;
      const seed = this.seeds[i];
      const flickerAmount = this.loveMessageActive || this.imageVisible ? 0.004 : 0.025;
      const flicker = 1 + Math.sin(time * 1.5 + seed) * flickerAmount;
      const speedPush = this.loveMessageActive || this.imageVisible
        ? 0
        : this.hand.speed * 0.22 + this.burst * 0.7;
      const imageTarget = this.imageVisible && this.imageStage === 2
        ? this.imageHeartTargets
        : this.targets;
      let tx = imageTarget[i3] * spread * flicker
        + this.hand.vx * speedPush * (0.05 + (i % 5) * 0.005);
      let ty = imageTarget[i3 + 1] * spread * flicker - this.hand.vy * speedPush * 0.045;
      let tz = imageTarget[i3 + 2] * spread + speedPush * ((i % 3) - 1) * 0.08;
      if (this.imageVisible) {
        const drift = this.imageStage === 2
          ? 0.028 + (i % 11) * 0.0015
          : 0.055 + (i % 11) * 0.003;
        tx += Math.sin(time * 0.62 + seed) * drift;
        ty += Math.cos(time * 0.54 + seed * 1.4) * drift * 0.72;
        tz += Math.sin(time * 0.48 + seed * 2.1) * 0.045;
      }
      let handInfluence = 0;

      if (this.hand.tracked && !this.loveMessageActive && !this.imageVisible) {
        const dx = handSceneX - this.positions[i3];
        const dy = handSceneY - this.positions[i3 + 1];
        const distSq = dx * dx + dy * dy;
        if (distSq < influenceRadiusSq) {
          handInfluence = 1 - distSq / influenceRadiusSq;
          const attraction = handInfluence * (this.messageActive ? 0.12 : 0.3);
          tx += dx * attraction + velocityX * handInfluence * 0.22;
          ty += dy * attraction + velocityY * handInfluence * 0.22;
        }
      }

      const ease = (
        (this.loveMessageActive ? 0.13 : 0.068)
        + visualOpenness * 0.018
        + handInfluence * 0.055
      ) * dt * (
        this.imageVisible
          ? (this.imageStage === 1 ? 0.62 : 0.3) + this.imageFlow * 2.65
          : 1
      );
      this.positions[i3] += (tx - this.positions[i3]) * ease;
      this.positions[i3 + 1] += (ty - this.positions[i3 + 1]) * ease;
      this.positions[i3 + 2] += (tz - this.positions[i3 + 2]) * ease;
      const sizeLayer = i % 19 === 0 ? 0.017 : i % 7 === 0 ? 0.008 : 0;
      const messageSize = this.messageActive ? 0.004 : 0;
      const imageSizeOffset = this.imageVisible ? -0.004 : 0;
      const targetSize = 0.018 + imageSizeOffset + messageSize + sizeLayer + visualOpenness * 0.011
        + this.hand.speed * 0.014 + handInfluence * 0.012;
      this.sizes[i] += (targetSize - this.sizes[i]) * 0.08 * dt;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.material.uniforms.uTime.value = time;
    const particlePixelRatio = Math.min(
      window.devicePixelRatio || 1,
      this.runtime.isSafari ? 1 : 1.5,
    );
    this.material.uniforms.uPixelRatio.value = particlePixelRatio;
    this.material.uniforms.uOpacity.value = Math.min(
      0.86,
      (this.messageActive ? 0.84 : 0.76) - (this.imageVisible ? 0.14 : 0),
    );
    this.glowMaterial.uniforms.uTime.value = time;
    this.glowMaterial.uniforms.uPixelRatio.value = particlePixelRatio;
    this.glowMaterial.uniforms.uOpacity.value = Math.min(
      this.runtime.isSafari ? 0.14 : 0.2,
      (this.messageActive ? 0.17 : 0.14)
        - (this.imageVisible ? 0.035 : 0)
        + this.hand.speed * (this.runtime.isSafari ? 0.02 : 0.045)
        + this.burst * (this.runtime.isSafari ? 0.01 : 0.025),
    );
    this.glowMaterial.uniforms.uPointScale.value = Math.min(
      2.3,
      2.0 + this.hand.speed * 0.18 + this.burst * 0.1,
    );
    if (this.bloomPass) {
      if (this.runtime.isSafari) {
        this.bloomPass.strength = Math.min(
          0.62,
          0.46 + this.hand.speed * 0.06 + this.burst * 0.035,
        );
        this.bloomPass.radius = Math.min(0.4, 0.3 + this.hand.speed * 0.03);
      } else {
        this.bloomPass.strength = Math.min(
          0.9,
          0.66 + this.hand.speed * 0.1 + this.burst * 0.055,
        );
        this.bloomPass.radius = Math.min(0.5, 0.4 + this.hand.speed * 0.04);
      }
    }
    if (this.afterimagePass) {
      this.afterimagePass.uniforms.damp.value = Math.min(
        0.86,
        0.74 + this.hand.speed * 0.08 + (this.imageVisible ? 0.025 : 0),
      );
    }

    if (this.starField) {
      this.starField.position.x = Math.sin(time * 0.11) * 0.22;
      this.starField.position.y = Math.cos(time * 0.085) * 0.14;
      this.starLayers.forEach((layer) => {
        const { baseOpacity, phase } = layer.userData;
        layer.material.uniforms.uTime.value = time;
        layer.material.uniforms.uOpacity.value = baseOpacity * (
          0.88 + Math.sin(time * 0.58 + phase) * 0.12
        );
      });
    }

    this.burst *= 0.92 ** dt;
    this.imageFlow *= 0.9 ** dt;
    if (this.composer) {
      try {
        this.composer.render();
      } catch (error) {
        this.composer?.dispose?.();
        this.composer = null;
        this.bloomPass = null;
        this.afterimagePass = null;
        window.showRuntimeError?.("后期渲染发生错误，已切换为基础粒子模式");
        this.renderer.render(this.scene, this.camera);
      }
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    const fps = Math.round(1 / Math.max(0.001, rawDelta));
    this.stats = {
      fps: Number.isFinite(fps) ? fps : 60,
      particles: this.maxCount,
      targets: this.maxCount,
      model: this.displayLabel,
      openness,
      handSpeed: this.hand.speed * 100,
      tracked: this.hand.tracked,
      mode: this.imageVisible ? "image" : this.messageActive ? "text" : "model",
      textTargets: this.textTargetCount,
      imageVisible: this.imageVisible,
      lastTriggered: this.lastTriggered,
    };
    const minimumDensity = this.runtime.isSafari
      ? 8000
      : window.innerWidth <= 700 ? 12000 : window.innerWidth <= 1100 ? 24000 : 50000;
    if (!this.messageActive && fps < 43 && this.maxCount > minimumDensity) {
      this.lowFpsFrames += 1;
      if (this.lowFpsFrames > 240) {
        this.lowFpsFrames = 0;
        this.setDensity(Math.max(minimumDensity, Math.floor(this.maxCount * 0.92 / 100) * 100));
      }
    } else if (fps > 50) {
      this.lowFpsFrames = Math.max(0, this.lowFpsFrames - 2);
    }
    requestAnimationFrame(this.animate);
  }
}

window.ParticleArtwork = ParticleArtwork;
