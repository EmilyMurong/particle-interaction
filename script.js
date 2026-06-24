const canvas = document.getElementById("particleCanvas");
const video = document.getElementById("cameraFeed");
const cameraNotice = document.getElementById("cameraNotice");
const cameraMessage = document.getElementById("cameraMessage");
const cameraButton = document.getElementById("cameraButton");
const gestureStatus = document.getElementById("gestureStatus");
const controlPanel = document.getElementById("controlPanel");
const controlToggle = document.getElementById("controlToggle");
const modelButtons = document.getElementById("modelButtons");
const colorPicker = document.getElementById("colorPicker");
const densitySlider = document.getElementById("densitySlider");
const imageUpload = document.getElementById("imageUpload");
const uploadStatus = document.getElementById("uploadStatus");
const imageOverlay = document.getElementById("imageOverlay");
const displayedImage = document.getElementById("displayedImage");
const fullscreenButton = document.getElementById("fullscreenButton");

const artwork = new window.ParticleArtwork(canvas);
let currentGesture = "等待中";
let tracked = false;
let detectedHandCount = 0;
let handSpeed = 0;
let openness = 0;
let handX = 0;
let handY = 0;
let cameraState = "未开启";
let noHandTimer = null;
let uploadedImages = [];
let currentImageIndex = -1;
let imageRevealTimer = null;
let gestureDebug = {
  isFist: false,
  fistFrames: 0,
  handCount: 0,
  leftPinching: false,
  rightPinching: false,
  lastTriggered: "none",
};

if (window.APP_RUNTIME?.isSafari) {
  densitySlider.min = "8000";
  densitySlider.max = "15000";
  densitySlider.step = "1000";
}
densitySlider.value = String(artwork.maxCount);

function setCameraNotice(visible) {
  cameraNotice.classList.toggle("is-visible", visible);
}

function setStatus(text) {
  currentGesture = text.replace("当前手势：", "").replace("需要开启摄像头", "需要摄像头");
}

function renderStatus() {
  const stats = artwork.stats || {};
  gestureStatus.textContent = `摄像头：${cameraState}
检测到手数量：${detectedHandCount}
左手捏合：${gestureDebug.leftPinching ? "是" : "否"}
右手捏合：${gestureDebug.rightPinching ? "是" : "否"}
已上传图片数量：${uploadedImages.length}
当前图片索引：${currentImageIndex >= 0 ? currentImageIndex + 1 : "无"}
开合程度：${(stats.openness ?? openness).toFixed(2)}
手速：${(stats.handSpeed ?? handSpeed).toFixed(1)}
handX：${handX.toFixed(0)}
handY：${handY.toFixed(0)}
当前手势：${currentGesture}
mode：${stats.mode || "model"}
textTargets：${stats.textTargets || 0}
lastTriggered：${stats.lastTriggered || gestureDebug.lastTriggered}
模型：${stats.model || "星云"}
FPS：${stats.fps || 0}
粒子：${stats.particles || 0}`;
}

async function handleGesture(name, detail) {
  if (name === "pinch" && !uploadedImages.length) {
    uploadStatus.textContent = "请先上传图片";
    uploadStatus.classList.remove("is-success");
    setStatus("双指捏合");
    return;
  }
  if (name === "pinch") {
    window.clearTimeout(imageRevealTimer);
    let nextIndex = Math.floor(Math.random() * uploadedImages.length);
    if (uploadedImages.length > 1 && nextIndex === currentImageIndex) {
      nextIndex = (nextIndex + 1 + Math.floor(Math.random() * (uploadedImages.length - 1)))
        % uploadedImages.length;
    }
    currentImageIndex = nextIndex;
    displayedImage.src = uploadedImages[currentImageIndex];
    imageOverlay.classList.remove("is-visible");
    imageOverlay.setAttribute("aria-hidden", "false");
    artwork.transition(name, detail);
    imageRevealTimer = window.setTimeout(() => {
      imageOverlay.classList.add("is-visible");
      imageRevealTimer = null;
    }, 20);
    renderStatus();
    return;
  }
  if (name === "clear" || name === "open" || name === "fist") {
    window.clearTimeout(imageRevealTimer);
    imageRevealTimer = null;
    imageOverlay.classList.remove("is-visible");
    imageOverlay.setAttribute("aria-hidden", "true");
    currentImageIndex = -1;
  }
  artwork.transition(name, detail);
}

function handleHandMove(hand) {
  artwork.setHand(hand);
  tracked = Boolean(hand && hand.active);
  detectedHandCount = hand?.handCount || 0;
  if (tracked) {
    window.clearTimeout(noHandTimer);
    noHandTimer = null;
  } else if (!noHandTimer) {
    noHandTimer = window.setTimeout(() => {
      artwork.restoreSelectedModel();
      setStatus("等待手势中...");
      noHandTimer = null;
    }, 900);
  }
  handSpeed = hand ? (hand.speed || 0) * 100 : 0;
  openness = hand ? hand.openness || 0 : 0;
  handX = hand ? hand.x * window.innerWidth : 0;
  handY = hand ? hand.y * window.innerHeight : 0;
  gestureDebug = hand?.debug || gestureDebug;
}

function getCameraErrorMessage(error) {
  if (!window.isSecureContext || error?.name === "InsecureContextError") {
    return "请使用 localhost 或 HTTPS 打开页面";
  }
  if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
    return window.APP_RUNTIME?.isSafari
      ? "请在 Safari 设置中允许摄像头，或点击地址栏允许摄像头"
      : "请点击地址栏左侧图标允许摄像头";
  }
  if (
    error?.name === "NotReadableError"
    || error?.name === "TrackStartError"
    || error?.name === "AbortError"
  ) {
    return window.APP_RUNTIME?.isSafari
      ? "请在 Mac 隐私与安全性设置中允许 Safari 使用摄像头"
      : "请检查 Chrome 是否有 Mac 摄像头权限";
  }
  if (error?.name === "MediaPipeError") {
    return "摄像头已开启，但手势识别组件加载失败，请刷新页面重试";
  }
  return "请允许浏览器使用摄像头";
}

const controller = new window.GestureController({
  video,
  onGesture: handleGesture,
  onHandMove: handleHandMove,
  onStatus: setStatus,
  onCameraReady: () => {
    cameraState = "已开启";
    setCameraNotice(false);
    setStatus("等待手势中...");
    video.classList.add("is-visible");
    cameraMessage.textContent = "摄像头已开启";
    cameraButton.disabled = false;
    cameraButton.textContent = "开启摄像头";
    renderStatus();
  },
  onCameraError: (error) => {
    cameraState = video.srcObject ? "已开启，手势识别异常" : "开启失败";
    cameraMessage.textContent = getCameraErrorMessage(error);
    setCameraNotice(true);
    setStatus(video.srcObject ? "手势识别异常" : "需要开启摄像头");
    video.classList.toggle("is-visible", Boolean(video.srcObject));
    cameraButton.disabled = false;
    cameraButton.textContent = video.srcObject ? "重试手势识别" : "重新开启摄像头";
    artwork.setHand(null);
    renderStatus();
  },
});

cameraButton.addEventListener("click", async () => {
  cameraState = "正在请求权限";
  renderStatus();
  cameraButton.disabled = true;
  cameraButton.textContent = "正在开启...";
  cameraMessage.textContent = "正在请求摄像头权限";
  await controller.start();
});

modelButtons.addEventListener("click", (event) => {
  const button = event.target.closest("[data-model]");
  if (!button) return;
  modelButtons.querySelectorAll(".model-button").forEach((item) => item.classList.remove("is-active"));
  button.classList.add("is-active");
  artwork.setModel(button.dataset.model);
});

colorPicker.addEventListener("input", () => {
  artwork.setBaseColor(colorPicker.value);
});

densitySlider.addEventListener("input", () => {
  artwork.setDensity(Number(densitySlider.value));
});

imageUpload.addEventListener("change", async () => {
  const files = Array.from(imageUpload.files || []);
  if (!files.length) return;
  const validFiles = files.filter((file) => (
    ["image/png", "image/jpeg", "image/webp"].includes(file.type)
    || /\.(png|jpe?g|webp)$/i.test(file.name)
  ));
  if (!validFiles.length) {
    uploadStatus.textContent = "请选择 png、jpg 或 webp 图片";
    uploadStatus.classList.remove("is-success");
    imageUpload.value = "";
    return;
  }

  try {
    uploadedImages = await Promise.all(validFiles.map((file) => (
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      })
    )));
    currentImageIndex = -1;
    window.clearTimeout(imageRevealTimer);
    imageRevealTimer = null;
    imageOverlay.classList.remove("is-visible");
    imageOverlay.setAttribute("aria-hidden", "true");
    artwork.transition("clear");
    uploadStatus.textContent = `已上传 ${uploadedImages.length} 张图片`;
    uploadStatus.classList.add("is-success");
    renderStatus();
  } catch (error) {
    uploadedImages = [];
    uploadStatus.textContent = "图片读取失败，请重新选择";
    uploadStatus.classList.remove("is-success");
  }
});

controlToggle.addEventListener("click", () => {
  const open = controlPanel.classList.toggle("is-open");
  controlToggle.setAttribute("aria-expanded", String(open));
});

fullscreenButton.addEventListener("click", async () => {
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen?.();
  } else {
    await document.exitFullscreen?.();
  }
});

window.addEventListener("load", () => {
  setCameraNotice(true);
  renderStatus();
  window.setInterval(renderStatus, 250);
});
