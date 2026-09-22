const $ = selector => document.querySelector(selector);
const kindIcon = { flight:"✈", rail:"▤", food:"♨", car:"●", play:"▲", stay:"▰" };
const modeMeta = {
  flight:{ label:"飞机", color:"#3181b9", dash:[12,8], weight:3 },
  rail:{ label:"火车", color:"#525f71", dash:[3,7], weight:3 },
  drive:{ label:"租车自驾", color:"#176747", dash:null, weight:5 },
  taxi:{ label:"打车", color:"#9b7138", dash:[7,5], weight:4 },
  walk:{ label:"步行", color:"#b47c22", dash:[2,7], weight:3 }
};

let plan, config, map, activeIndex = 3, mapItems = [], activeMapItems = [], mapRenderToken = 0, overview = true;
let routeInfoCache = new Map(), activeModalSegmentId = null, toastTimer;
let locations = new Map();
const routeIconUrls = {
  car: "/assets/route-icons/car.png",
  plane: "/assets/route-icons/plane.png",
  train: "/assets/route-icons/train.png"
};
let routePlayer = { active:false, segments:[], index:-1 };
let routePlayerMarker = null, routePlayerLine = null, routePlayerFrame = 0;
let mobileDrawerOpen = false;
let mobileSheetOffset = null;
let mobileMapFitTimer;
const mobileSheetHandlePeek = 28;
const isMobileLayout = () => window.matchMedia("(max-width: 760px)").matches;

async function api(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "请求失败");
  return response.json();
}
function currentDay() { return plan.days[activeIndex]; }
function placeFor(id) { return locations.get(id); }
function coordinate(place) { return [place.lng, place.lat]; }
function closeModal() { activeModalSegmentId = null; $("#placeModal").hidden = true; }
function focusDayEvents() { closeModal(); $("#dayCard").scrollIntoView({ behavior:"smooth", block:"center" }); }
function routeIconForMode(mode) {
  if (mode === "flight") return routeIconUrls.plane;
  if (mode === "rail") return routeIconUrls.train;
  return routeIconUrls.car;
}
function routePlayerModeLabel(mode) { return modeMeta[mode]?.label || "路线"; }
function setPanelCollapsed(panel, collapsed) {
  const workspace = $(".workspace");
  workspace.classList.toggle("dates-collapsed", panel === "dates" ? collapsed : workspace.classList.contains("dates-collapsed"));
  workspace.classList.toggle("card-collapsed", panel === "card" ? collapsed : workspace.classList.contains("card-collapsed"));
  const datesCollapsed = workspace.classList.contains("dates-collapsed");
  const cardCollapsed = workspace.classList.contains("card-collapsed");
  const datesButton = $("#toggleDates"), cardButton = $("#toggleCard");
  datesButton.textContent = datesCollapsed ? "›" : "‹";
  datesButton.setAttribute("aria-label", datesCollapsed ? "展开日期栏" : "收起日期栏");
  datesButton.title = datesButton.getAttribute("aria-label");
  cardButton.textContent = cardCollapsed ? "‹" : "›";
  cardButton.setAttribute("aria-label", cardCollapsed ? "展开行程栏" : "收起行程栏");
  cardButton.title = cardButton.getAttribute("aria-label");
}
function setMobileDrawer(open) {
  const card = $("#dayCard");
  if (!card) return;
  const maxOffset = Math.max(0, card.getBoundingClientRect().height - mobileSheetHandlePeek);
  mobileSheetOffset = open ? 0 : maxOffset;
  mobileDrawerOpen = open;
  card.style.setProperty("--sheet-offset", `${mobileSheetOffset}px`);
  card.classList.toggle("drawer-open", open);
  card.classList.toggle("sheet-collapsed", !open);
  $("#mobileShowCard")?.classList.toggle("active", open);
  if (isMobileLayout()) scheduleMobileMapFit();
}
function openRoutePreview() {
  const day = currentDay();
  $("#routePreviewTitle").textContent = `${day.label} · 播放动态线路`;
  $("#routePreviewCopy").textContent = `${day.route}：${day.stops.length} 个行程节点，地图会按实际交通方式快速移动并逐站停留。`;
  $("#routePreviewModal").hidden = false;
}
function closeRoutePreview() { $("#routePreviewModal").hidden = true; }
function playerPoint(path, progress) {
  if (!path?.length) return null;
  if (path.length === 1) return path[0];
  const scaled = Math.min(0.999999, Math.max(0, progress)) * (path.length - 1);
  const index = Math.floor(scaled), fraction = scaled - index;
  const from = path[index], to = path[Math.min(index + 1, path.length - 1)];
  return [from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction];
}
function normalizeRoutePath(path) {
  return (path || []).map(point => {
    if (Array.isArray(point)) return [Number(point[0]), Number(point[1])];
    if (typeof point?.getLng === "function") return [Number(point.getLng()), Number(point.getLat())];
    return [Number(point?.lng), Number(point?.lat)];
  }).filter(point => point.every(Number.isFinite));
}
function routePlayerPath(segment, from, to) {
  const direct = [coordinate(from), coordinate(to)];
  if (!["drive","taxi","walk"].includes(segment.mode)) return Promise.resolve(direct);
  const Service = segment.mode === "walk" ? window.AMap?.Walking : window.AMap?.Driving;
  if (!Service) return Promise.resolve(direct);
  return new Promise(resolve => {
    let done = false;
    const finish = path => { if (done) return; done = true; clearTimeout(timer); const normalized = normalizeRoutePath(path); resolve(normalized.length > 1 ? normalized : direct); };
    const timer = setTimeout(() => finish(direct), 1200);
    const service = new Service(segment.mode === "walk" ? {} : { policy: AMap.DrivingPolicy?.LEAST_TIME ?? 0, extensions:"all" });
    service.search(coordinate(from), coordinate(to), (status, result) => finish(status === "complete" ? routePath(result) : direct));
  });
}
function clearRoutePlayerMap() {
  cancelAnimationFrame(routePlayerFrame);
  if (map && routePlayerMarker) map.remove(routePlayerMarker);
  if (map && routePlayerLine) map.remove(routePlayerLine);
  routePlayerMarker = null; routePlayerLine = null;
}
function updateRoutePlayerPanel(segment, index) {
  const total = routePlayer.segments.length;
  $("#routePlayerIcon").src = routeIconForMode(segment.mode);
  $("#routePlayerMode").textContent = `${routePlayerModeLabel(segment.mode)} · 第 ${index + 1}/${total} 段`;
  $("#routePlayerSegment").textContent = segment.label;
  $("#routePlayerHint").textContent = `正在沿路线前往 ${placeFor(segment.to_location_id)?.name || "下一站"}…`;
  $("#routePlayerProgress").style.width = `${Math.round((index / Math.max(1, total)) * 100)}%`;
}
function positionRouteArrival(point) {
  const card = $("#routeArrival");
  if (!map || !card || card.hidden || !point) return;
  const pixel = map.lngLatToContainer(point);
  const x = typeof pixel?.getX === "function" ? pixel.getX() : pixel?.x;
  const y = typeof pixel?.getY === "function" ? pixel.getY() : pixel?.y;
  const size = map.getSize?.();
  if (![x, y].every(Number.isFinite) || !size) return;
  const width = card.offsetWidth || 240, height = card.offsetHeight || 86, margin = 12;
  const clampedX = Math.max(width / 2 + margin, Math.min(size.width - width / 2 - margin, x));
  const above = y > height + 34;
  const top = above ? Math.max(height + margin, y - 20) : Math.min(size.height - height - margin, y + 30);
  card.style.left = `${clampedX}px`;
  card.style.top = `${Math.max(margin, top)}px`;
  card.classList.toggle("below-marker", !above);
}
function showRouteArrival(segment, index, point, arrived = true) {
  const place = placeFor(segment.to_location_id);
  const stop = currentDay().stops.find(item => item.location_id === segment.to_location_id);
  $("#routeArrivalKicker").textContent = `${currentDay().label} · ${arrived ? "已到达" : "前往"}`;
  $("#routeArrivalTitle").textContent = place?.name || segment.label;
  $("#routeArrivalDetail").textContent = arrived ? (stop?.detail || segment.detail || place?.address || "已到达下一站") : `正在前往 ${place?.name || "下一站"}…`;
  $("#nextRouteStep").textContent = index >= routePlayer.segments.length - 1 ? "完成播放" : "下一站";
  const card = $("#routeArrival"), actions = $(".route-arrival-actions");
  card.hidden = false;
  card.classList.add("follow-marker");
  card.classList.toggle("is-arrived", arrived);
  if (actions) actions.hidden = !arrived;
  if (point) requestAnimationFrame(() => positionRouteArrival(point));
  if (arrived) $("#routePlayerProgress").style.width = `${Math.round(((index + 1) / Math.max(1, routePlayer.segments.length)) * 100)}%`;
}
async function runRouteSegment(index) {
  if (!routePlayer.active) return;
  const segment = routePlayer.segments[index];
  if (!segment) { stopRoutePlayer(); return; }
  routePlayer.index = index;
  $("#routeArrival").hidden = true;
  $("#routePlayer").hidden = false;
  const from = placeFor(segment.from_location_id), to = placeFor(segment.to_location_id);
  if (!from || !to || !map) { showRouteArrival(segment, index); return; }
  updateRoutePlayerPanel(segment, index);
  clearRoutePlayerMap();
  const path = await routePlayerPath(segment, from, to);
  if (!routePlayer.active || routePlayer.index !== index) return;
  const meta = modeMeta[segment.mode] || modeMeta.drive;
  routePlayerLine = new AMap.Polyline({ path, strokeColor:meta.color, strokeOpacity:.25, strokeWeight:meta.weight + 3, strokeStyle:"solid", lineJoin:"round", zIndex:60 });
  routePlayerMarker = new AMap.Marker({ position:path[0], content:`<div class="route-player-marker"><img src="${routeIconForMode(segment.mode)}" alt=""></div>`, offset:new AMap.Pixel(-22,-22), zIndex:70 });
  map.add(routePlayerLine); map.add(routePlayerMarker);
  map.setFitView([routePlayerLine], false, [130, 130, 130, 130], segment.mode === "flight" || segment.mode === "rail" ? 8.5 : 13.5);
  showRouteArrival(segment, index, path[0], false);
  const duration = segment.mode === "flight" ? 1250 : segment.mode === "rail" ? 1500 : 1850;
  const started = performance.now();
  const tick = now => {
    if (!routePlayer.active || routePlayer.index !== index) return;
    const progress = Math.min(1, (now - started) / duration), point = playerPoint(path, progress);
    routePlayerMarker.setPosition(point); map.setCenter(point, true); positionRouteArrival(point);
    $("#routePlayerHint").textContent = `正在沿路线前往 ${to.name}…`;
    if (progress < 1) routePlayerFrame = requestAnimationFrame(tick);
    else { routePlayerMarker.setPosition(path[path.length - 1]); showRouteArrival(segment, index, path[path.length - 1], true); }
  };
  routePlayerFrame = requestAnimationFrame(tick);
}
function startRoutePlayer() {
  const segments = currentDay().segments.filter(segment => placeFor(segment.from_location_id) && placeFor(segment.to_location_id));
  if (!segments.length) { closeRoutePreview(); toast("当天没有可播放的连续线路"); return; }
  if (!map) { closeRoutePreview(); toast("地图还在加载，请稍后再试"); return; }
  routePlayer = { active:true, segments, index:-1 };
  overview = false; updateMapView(); closeRoutePreview(); setMobileDrawer(false);
  $(".map-zone").classList.add("route-playing");
  $("#routePlayer").hidden = false; $("#routeArrival").hidden = true;
  runRouteSegment(0);
}
function stopRoutePlayer() {
  routePlayer.active = false; clearRoutePlayerMap(); routePlayer.segments = []; routePlayer.index = -1;
  $(".map-zone")?.classList.remove("route-playing");
  $("#routePlayer").hidden = true; $("#routeArrival").hidden = true;
  if (map) updateMapView();
}
function nextRouteStep() {
  if (!routePlayer.active) return;
  if (routePlayer.index >= routePlayer.segments.length - 1) { stopRoutePlayer(); return; }
  runRouteSegment(routePlayer.index + 1);
}
function bindSheetDrag() {
  const handle = $("#cardDragHandle"), card = $("#dayCard");
  if (!handle || !card) return;
  if (card.dataset.swipeBound) return;
  card.dataset.swipeBound = "1";
  let startY = null, startOffset = 0, pointerId = null, didDrag = false;
  const maxOffset = () => Math.max(0, card.getBoundingClientRect().height - mobileSheetHandlePeek);
  const clampOffset = value => Math.max(0, Math.min(maxOffset(), value));
  const currentOffset = () => {
    if (Number.isFinite(mobileSheetOffset)) return mobileSheetOffset;
    return mobileDrawerOpen ? 0 : maxOffset();
  };
  const setDraggedOffset = (offset, dragging) => {
    mobileSheetOffset = clampOffset(offset);
    mobileDrawerOpen = mobileSheetOffset < maxOffset() - 1;
    card.style.setProperty("--sheet-offset", `${mobileSheetOffset}px`);
    card.classList.toggle("drawer-open", mobileDrawerOpen);
    card.classList.toggle("sheet-collapsed", !mobileDrawerOpen);
    card.classList.toggle("dragging", dragging);
    $("#mobileShowCard")?.classList.toggle("active", mobileDrawerOpen);
  };
  handle.onclick = () => {
    if (didDrag) { didDrag = false; return; }
    setMobileDrawer(!mobileDrawerOpen);
  };
  const startDrag = event => {
    if (window.matchMedia("(min-width: 761px)").matches) return;
    if (!event.target.closest(".card-drag-handle, .card-head")) return;
    startY = event.clientY; startOffset = currentOffset(); pointerId = event.pointerId; didDrag = false;
    handle.setPointerCapture?.(pointerId);
    event.preventDefault();
  };
  const moveDrag = event => {
    if (startY === null || event.pointerId !== pointerId) return;
    const delta = event.clientY - startY;
    if (Math.abs(delta) > 4) didDrag = true;
    if (didDrag) { setDraggedOffset(startOffset + delta, true); event.preventDefault(); }
  };
  const finishDrag = event => {
    if (startY === null || event.pointerId !== pointerId) return;
    const wasDragging = didDrag;
    startY = null; pointerId = null;
    if (wasDragging) {
      const max = maxOffset(), current = clampOffset(mobileSheetOffset ?? startOffset);
      const settled = current <= 26 ? 0 : current >= max - 26 ? max : current;
      setDraggedOffset(settled, false);
    } else card.classList.remove("dragging");
  };
  card.addEventListener("pointerdown", startDrag);
  card.addEventListener("pointermove", moveDrag);
  card.addEventListener("pointerup", finishDrag);
  card.addEventListener("pointercancel", finishDrag);
}
function bindMapSwipe() {
  const zone = $(".map-zone");
  if (!zone || zone.dataset.swipeBound) return;
  zone.dataset.swipeBound = "1";
  let startX = null, startY = null;
  zone.addEventListener("pointerdown", event => {
    if (window.matchMedia("(min-width: 761px)").matches) return;
    if (event.target.closest(".day-card, .map-tools, .route-player, .route-arrival, .mobile-action-bar, .modal, .route-preview-modal")) return;
    startX = event.clientX; startY = event.clientY;
  });
  zone.addEventListener("pointerup", event => {
    if (startX === null) return;
    const deltaX = event.clientX - startX, deltaY = Math.abs(event.clientY - startY); startX = null; startY = null;
    if (deltaY > 70 || Math.abs(deltaX) < 65) return;
    if (deltaX < 0) setMobileDrawer(true); else setMobileDrawer(false);
  });
}
function routeUrl(from, to, mode) {
  const navMode = mode === "walk" ? "walk" : "car";
  return `https://uri.amap.com/navigation?from=${from.lng},${from.lat},${encodeURIComponent(from.name)}&to=${to.lng},${to.lat},${encodeURIComponent(to.name)}&mode=${navMode}&callnative=1`;
}
function markerUrl(place) { return `https://uri.amap.com/marker?position=${place.lng},${place.lat}&name=${encodeURIComponent(place.name)}&callnative=1`; }
function haversineKm(from, to) {
  const rad = Math.PI / 180, dLat = (to.lat - from.lat) * rad, dLng = (to.lng - from.lng) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(from.lat * rad) * Math.cos(to.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function formatDuration(minutes) {
  const rounded = Math.max(1, Math.round(minutes));
  return rounded >= 60 ? `${Math.floor(rounded / 60)}小时${rounded % 60 ? `${rounded % 60}分` : ""}` : `${rounded}分钟`;
}
function formatRouteInfo(mode, info) {
  const label = mode === "walk" ? "步行" : "驾车";
  return `${label}约 ${info.distanceKm.toFixed(1)} 公里 · ${formatDuration(info.durationMin)}${info.estimated ? "（地图估算）" : ""}`;
}
function fallbackRouteInfo(segment, from, to) {
  const straight = haversineKm(from, to);
  const factor = segment.mode === "walk" ? 1.12 : 1.28;
  const speed = segment.mode === "walk" ? 4.5 : 55;
  return { distanceKm: straight * factor, durationMin: straight * factor / speed * 60, estimated: true };
}
function toast(message) {
  const target = $("#mapToast");
  if (!target) return;
  target.textContent = message; target.classList.add("visible");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => target.classList.remove("visible"), 2200);
}
function centerPlace(place) {
  if (!place) return;
  if (!map) { toast("地图还在加载，稍后再长按一次"); return; }
  overview = false;
  syncMapControls();
  map.setZoomAndCenter(10.5, coordinate(place));
  toast(`已定位：${place.name}`);
}
function weatherSymbol(code) {
  if (code === 0) return "☀️ 晴";
  if ([1,2,3].includes(code)) return "⛅ 多云";
  if ([45,48].includes(code)) return "🌫 雾";
  if ([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) return "🌧 有雨";
  if ([71,73,75,77,85,86].includes(code)) return "❄️ 有雪";
  return "🌦 天气待更新";
}

function openPhotoLightbox(photo, image, place) {
  const lightbox = $("#photoLightbox");
  $("#lightboxImage").src = image.currentSrc || image.src || photo.imageUrl;
  $("#lightboxImage").alt = `${place.name}图片`;
  $("#lightboxCaption").textContent = photo.caption || `${place.name}图片`;
  $("#lightboxSource").href = photo.sourceUrl || markerUrl(place);
  lightbox.hidden = false;
}
function closePhotoLightbox() { $("#photoLightbox").hidden = true; }
function renderGallery(photos, place) {
  const gallery = $("#photoGallery");
  gallery.replaceChildren();
  if (!photos?.length) {
    gallery.innerHTML = `<p class="photo-empty">这个节点暂未收录可核验的十月实拍图。</p>`;
    return;
  }
  photos.slice(0,3).forEach(photo => {
    const figure = document.createElement("button");
    figure.type = "button";
    figure.className = "photo-tile";
    const image = document.createElement("img");
    const candidates = [photo.imageUrl, ...(photo.fallbackImageUrls || [])].filter(Boolean).filter(url => {
      try { return sessionStorage.getItem(`travel-photo-failed:${url}`) !== "1"; } catch { return true; }
    });
    let attempt = 0;
    const showSourceOnly = () => {
      image.remove(); figure.classList.add("photo-source-only");
      figure.insertAdjacentHTML("afterbegin", `<span>图片源暂时不可用<br>点击查看原始报道</span>`);
    };
    const tryNextImage = () => {
      if (candidates[attempt - 1]) {
        try { sessionStorage.setItem(`travel-photo-failed:${candidates[attempt - 1]}`, "1"); } catch {}
      }
      attempt += 1;
      if (attempt < candidates.length) { image.src = candidates[attempt]; return; }
      showSourceOnly();
    };
    image.alt = `${place.name}十月实拍图`; image.loading = "lazy"; image.referrerPolicy = "no-referrer";
    image.onerror = tryNextImage;
    image.onload = () => { if (image.naturalWidth < 80 || image.naturalHeight < 60) tryNextImage(); };
    if (candidates.length) image.src = candidates[attempt]; else showSourceOnly();
    const caption = document.createElement("figcaption"); caption.textContent = photo.caption;
    figure.addEventListener("click", () => { if (image.isConnected && image.src) openPhotoLightbox(photo, image, place); });
    figure.append(image, caption); gallery.append(figure);
  });
}
function showPlace(place, label = "地点") {
  activeModalSegmentId = null;
  $(".dialog").classList.remove("route-dialog");
  $("#placeLabel").textContent = label;
  $("#placeTitle").textContent = place.name;
  $("#placeAddress").textContent = `地址：${place.address}`;
  $("#routeMetrics").textContent = "";
  $("#placeNote").textContent = "";
  $("#navigateLink").href = markerUrl(place); $("#navigateLink").textContent = "在高德地图查看";
  $("#secondaryAction").textContent = "关闭"; $("#secondaryAction").onclick = closeModal;
  $("#placeModal").hidden = false;
  $("#photoGallery").innerHTML = `<p class="photo-empty">正在核对十月实拍图…</p>`;
  api(`/api/october-photos?locationId=${place.id}`).then(result => renderGallery(result.photos, place)).catch(() => renderGallery([], place));
}
function routeInfoFromResult(result) {
  const route = result?.routes?.[0];
  if (!route || !Number(route.distance)) return null;
  const distanceKm = Number(route.distance) / 1000;
  const serviceDurationMin = Number(route.duration || 0) / 60;
  // AMap occasionally returns an implausibly short duration for long rural routes.
  // Keep its road distance, but replace only the broken time with a conservative estimate.
  const implausible = serviceDurationMin < Math.max(2, distanceKm / 120 * 60);
  return {
    distanceKm,
    durationMin: implausible ? distanceKm / 55 * 60 : serviceDurationMin,
    estimated: implausible
  };
}
function requestRouteInfo(segment, from, to) {
  const cached = routeInfoCache.get(segment.id);
  if (cached) { $("#routeMetrics").textContent = formatRouteInfo(segment.mode, cached); return; }
  const fallback = fallbackRouteInfo(segment, from, to);
  $("#routeMetrics").textContent = `正在计算${segment.mode === "walk" ? "步行" : "驾车"}距离…`;
  const Service = segment.mode === "walk" ? window.AMap?.Walking : window.AMap?.Driving;
  if (!Service) { routeInfoCache.set(segment.id, fallback); $("#routeMetrics").textContent = formatRouteInfo(segment.mode, fallback); return; }
  const service = new Service(segment.mode === "walk" ? {} : { policy: AMap.DrivingPolicy?.LEAST_TIME ?? 0, extensions:"all" });
  service.search(coordinate(from), coordinate(to), (status, result) => {
    if (activeModalSegmentId !== segment.id) return;
    const info = status === "complete" ? routeInfoFromResult(result) : null;
    routeInfoCache.set(segment.id, info || fallback);
    $("#routeMetrics").textContent = formatRouteInfo(segment.mode, info || fallback);
  });
}
function showSegment(segment) {
  const from = placeFor(segment.from_location_id), to = placeFor(segment.to_location_id), mode = modeMeta[segment.mode];
  activeModalSegmentId = segment.id;
  $(".dialog").classList.add("route-dialog");
  $("#placeLabel").textContent = `${currentDay().label} · ${mode.label}`;
  $("#placeTitle").textContent = segment.label;
  $("#placeAddress").textContent = `${from.address} → ${to.address}`;
  $("#routeMetrics").textContent = "";
  $("#placeNote").textContent = segment.detail;
  $("#photoGallery").replaceChildren();
  $("#navigateLink").href = ["drive","taxi","walk"].includes(segment.mode) ? routeUrl(from,to,segment.mode) : markerUrl(to);
  $("#navigateLink").textContent = ["drive","taxi","walk"].includes(segment.mode) ? "高德导航这段路" : "查看终点位置";
  $("#secondaryAction").textContent = "查看当天安排"; $("#secondaryAction").onclick = focusDayEvents;
  $("#placeModal").hidden = false;
  if (["drive","taxi","walk"].includes(segment.mode)) requestRouteInfo(segment, from, to);
}

function renderDates() {
  $("#dateNav").replaceChildren(...plan.days.map((day, index) => {
    const button = document.createElement("button");
    button.className = `date-button${index === activeIndex ? " active" : ""}`;
    button.setAttribute("aria-pressed", index === activeIndex ? "true" : "false");
    button.innerHTML = `<strong>${day.label}</strong><span>${day.route}</span>`;
    button.onclick = () => {
      activeIndex = index;
      if (isMobileLayout()) {
        overview = false;
        mobileDrawerOpen = false;
        mobileSheetOffset = null;
      }
      render();
      if (isMobileLayout()) requestMapFitAfterMobileLayout();
    };
    return button;
  }));
}
function dayNote(day) {
  const notes = {
    2: "齐齐哈尔取车后长途自驾到海拉尔，建议吃完饭立刻出发。",
    3: "北线第一天：莫日格勒河和额尔古纳湿地都保留，天气不好先保湿地。",
    4: "白桦林短停，黑山头看河湾；瑞士卷只在安全停车点顺路拍。",
    5: "本日会直接南下阿尔山：186彩带河是条件项，时间紧就删掉，不能夜间赶路。",
    6: "整天留给阿尔山森林公园，天池、驼峰岭、石塘林按开放和体力安排。",
    7: "上午回齐齐哈尔，中午吃饭、下午游玩，玩够后还车，再打车去齐齐哈尔站坐火车。"
  };
  return notes[day.day_number] || "";
}
function renderCard() {
  const day = currentDay();
  const modes = [...new Set(day.segments.map(segment => segment.mode))];
  const events = day.stops.map((stop, index) => `<button class="event${stop.location_id ? "" : " no-location"}${stop.status === "条件项" ? " condition" : ""}" data-stop="${stop.id}" aria-label="${stop.title}${stop.status === "条件项" ? "，条件项" : ""}" title="${stop.location_id ? "点击查看详情，长按定位地图" : "沿途条件项，无固定地图点"}">
    <span class="event-icon ${stop.kind}"><strong>${index + 1}</strong><small>${kindIcon[stop.kind] || "•"}</small></span>
    <span class="event-copy"><span class="event-time">${stop.time_label}${stop.status === "条件项" ? ` <em class="status-tag">条件项</em>` : ""}</span><span class="event-title">${stop.title}</span><span class="event-detail">${stop.detail}</span></span>
  </button>`).join("");
  $("#dayCard").innerHTML = `<div class="card-head"><button class="card-drag-handle" id="cardDragHandle" type="button" aria-label="拖动收起或展开行程"><span></span></button><p class="date-label">${day.label}</p><h1>${day.route}</h1><p class="summary">${day.summary}</p><p class="day-note">${dayNote(day)}</p><p class="mode-chips">${modes.map(mode => `<span class="mode-chip ${mode}">${modeMeta[mode].label}</span>`).join("")}</p><p class="weather-line" id="weatherLine"></p></div><div class="events">${events}</div><div class="card-actions"><button id="showFirst">查看首个地点</button><button id="playRoute">动态线路</button><button class="primary" id="fitDay">聚焦当天线路</button></div>`;
  document.querySelectorAll(".event").forEach(button => {
    const stop = day.stops.find(item => item.id === Number(button.dataset.stop));
    let longPressed = false, timer;
    const cancelLongPress = () => { clearTimeout(timer); };
    button.addEventListener("pointerdown", event => {
      if (!stop.location_id || (event.pointerType === "mouse" && event.button !== 0)) return;
      longPressed = false;
      timer = setTimeout(() => { longPressed = true; button.classList.add("long-pressed"); centerPlace(placeFor(stop.location_id)); setTimeout(() => button.classList.remove("long-pressed"), 450); }, 600);
    });
    ["pointerup","pointerleave","pointercancel"].forEach(type => button.addEventListener(type, cancelLongPress));
    button.onclick = event => {
      if (longPressed) { event.preventDefault(); event.stopPropagation(); longPressed = false; return; }
      if (stop.location_id) showPlace(placeFor(stop.location_id), stop.time_label);
    };
  });
  const first = day.stops.find(stop => stop.location_id);
  $("#showFirst").onclick = () => first && showPlace(placeFor(first.location_id), day.label);
  $("#playRoute").onclick = openRoutePreview;
  $("#fitDay").onclick = () => { overview = false; updateMapView(); };
  bindSheetDrag(); setMobileDrawer(mobileDrawerOpen); bindMapSwipe();
  if (first) loadWeather(placeFor(first.location_id), day);
}
async function loadWeather(place, day) {
  const target = $("#weatherLine"); target.textContent = "天气预报加载中";
  try {
    const result = await api(`/api/weather?lat=${place.lat}&lng=${place.lng}&date=${day.date}`);
    if (currentDay().id !== day.id) return;
    if (!result.weather) { target.textContent = "该日期暂无可用天气预报"; return; }
    const weather = result.weather;
    target.innerHTML = `<span>${weatherSymbol(weather.weatherCode)}</span><span>${weather.min}–${weather.max}°C · 降水 ${weather.precipitationProbability ?? "—"}%</span>`;
  } catch { target.textContent = "天气服务暂不可用"; }
}

function clearMap() { mapItems.forEach(item => map.remove(item)); mapItems = []; activeMapItems = []; }
function addMapItem(item, active = false) { map.add(item); mapItems.push(item); if (active) activeMapItems.push(item); return item; }
function segmentStyle(segment, active) {
  if (!active) return { strokeColor:"#9ca7a0", strokeOpacity:.42, strokeWeight:2, strokeStyle:"dashed", strokeDasharray:[5,7], zIndex:5 };
  const meta = modeMeta[segment.mode];
  return { strokeColor:meta.color, strokeOpacity:.95, strokeWeight:meta.weight, strokeStyle:meta.dash ? "dashed" : "solid", strokeDasharray:meta.dash, zIndex:12 };
}
function addSegmentLine(segment, from, to, active, path = [coordinate(from),coordinate(to)]) {
  const line = new AMap.Polyline({ path, lineJoin:"round", cursor:"pointer", ...segmentStyle(segment, active) });
  line.on("click", () => showSegment(segment));
  return addMapItem(line, active);
}
function routePath(result) {
  const route = result?.routes?.[0];
  if (!route?.steps?.length) return null;
  return route.steps.flatMap(step => step.path || []);
}
function enhanceActiveGroundRoute(segment, from, to, fallback, token) {
  const isWalk = segment.mode === "walk";
  const Service = isWalk ? AMap.Walking : AMap.Driving;
  if (!Service) return;
  const service = new Service(isWalk ? {} : { policy: AMap.DrivingPolicy?.LEAST_TIME ?? 0, extensions:"all" });
  service.search(coordinate(from), coordinate(to), (status, result) => {
    if (token !== mapRenderToken || status !== "complete") return;
    const info = routeInfoFromResult(result); if (info) routeInfoCache.set(segment.id, info);
    const path = routePath(result); if (!path?.length) return;
    map.remove(fallback); mapItems = mapItems.filter(item => item !== fallback); activeMapItems = activeMapItems.filter(item => item !== fallback);
    addSegmentLine(segment, from, to, true, path);
  });
}
function markerContent(active, index) { return `<div class="pin ${active ? "active" : "muted"}"><span>${index}</span></div>`; }
function activeMarkerLabel(place) {
  const stop = currentDay().stops.find(item => item.location_id === place.id);
  return stop?.sort_order || place.id;
}
function allRelevantLocations() {
  const ids = new Set(plan.days.flatMap(day => [...day.stops.map(stop => stop.location_id), ...day.segments.flatMap(segment => [segment.from_location_id,segment.to_location_id])]).filter(Boolean));
  return [...ids].map(placeFor);
}
function fitMap() {
  const targets = overview ? mapItems : activeMapItems;
  if (!targets.length || !map) return;
  const avoid = isMobileLayout() ? mobileMapAvoid() : overview ? [72, 360, 70, 40] : [72, 380, 72, 48];
  map.setFitView(targets, false, avoid);
}
function mobileMapAvoid() {
  const mapBounds = $("#map")?.getBoundingClientRect();
  if (!mapBounds) return [18, 16, 132, 16];
  const overlayTop = [$("#dayCard"), $("#mobileActionBar"), $(".map-legend")]
    .map(element => element?.getBoundingClientRect())
    .filter(rect => rect && rect.width > 0 && rect.height > 0 && rect.bottom > mapBounds.top && rect.top < mapBounds.bottom)
    .map(rect => Math.max(mapBounds.top, rect.top));
  const bottom = overlayTop.length
    ? Math.max(96, Math.ceil(mapBounds.bottom - Math.min(...overlayTop) + 14))
    : 96;
  return [18, 16, bottom, 16];
}
function scheduleMobileMapFit() {
  if (!map || !isMobileLayout() || overview) return;
  clearTimeout(mobileMapFitTimer);
  mobileMapFitTimer = setTimeout(() => { if (map && !overview) fitMap(); }, 270);
}
function syncMapControls() {
  const focused = !overview;
  $("#mapScope").textContent = overview ? "全程总览" : `${currentDay().label} 聚焦`;
  $("#toggleMapFocus").textContent = overview ? "聚焦当天" : "查看全程";
  const mobileButton = $("#mobileFitDay");
  if (mobileButton) {
    mobileButton.textContent = overview ? "聚焦当天" : "查看全程";
    mobileButton.classList.toggle("active", focused);
    mobileButton.setAttribute("aria-pressed", String(focused));
  }
}
function requestMapFitAfterMobileLayout() {
  requestAnimationFrame(() => {
    setMobileDrawer(false);
    scheduleMobileMapFit();
  });
}
function updateMapView() {
  fitMap();
  syncMapControls();
}
function drawMap() {
  if (!map) return;
  const token = ++mapRenderToken; clearMap();
  const currentSegments = new Set(currentDay().segments.map(segment => segment.id));
  plan.days.flatMap(day => day.segments).forEach(segment => {
    const from = placeFor(segment.from_location_id), to = placeFor(segment.to_location_id), active = currentSegments.has(segment.id);
    const line = addSegmentLine(segment, from, to, active);
    if (active && ["drive","taxi","walk"].includes(segment.mode)) enhanceActiveGroundRoute(segment, from, to, line, token);
  });
  const activeLocationIds = new Set(currentDay().segments.flatMap(segment => [segment.from_location_id,segment.to_location_id]));
  allRelevantLocations().forEach((place,index) => {
    const active = activeLocationIds.has(place.id);
    const marker = new AMap.Marker({ position:coordinate(place), content:markerContent(active,active ? activeMarkerLabel(place) : index + 1), offset:new AMap.Pixel(-13,-13), zIndex:active ? 30 : 8, title:place.name });
    marker.on("click", () => showPlace(place, active ? currentDay().label : "全程节点")); addMapItem(marker, active);
  });
  updateMapView();
}
function render() { renderDates(); renderCard(); drawMap(); }
function loadAmap() {
  if (!config.mapJsKey) { $("#configPanel").hidden = false; return; }
  window._AMapSecurityConfig = { securityJsCode:config.mapSecurityCode || "" };
  const script = document.createElement("script");
  script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.mapJsKey)}&plugin=AMap.Driving,AMap.Walking`;
  script.onload = () => {
    map = new AMap.Map("map", { zoom:5, center:[121,47], mapStyle:"amap://styles/whitesmoke" });
    drawMap();
  };
  script.onerror = () => { $("#configPanel").hidden = false; toast("地图加载失败，请检查高德 Key"); };
  document.head.append(script);
}
async function init() {
  try {
    [plan,config] = await Promise.all([api("/api/trip"),api("/api/config")]);
    locations = new Map(plan.locations.map(place => [place.id,place]));
    activeIndex = Math.min(3, plan.days.length - 1); render(); loadAmap();
  } catch (error) { toast(error.message); }
}
$("#closeModal").onclick = closeModal;
$("#secondaryAction").onclick = closeModal;
$("#placeModal").onclick = event => { if (event.target === $("#placeModal")) closeModal(); };
$("#closePhotoLightbox").onclick = closePhotoLightbox;
$("#lightboxBack").onclick = closePhotoLightbox;
$("#photoLightbox").onclick = event => { if (event.target === $("#photoLightbox")) closePhotoLightbox(); };
$("#toggleMapFocus").onclick = () => { overview = !overview; updateMapView(); };
$("#toggleDates").onclick = () => setPanelCollapsed("dates", !$(".workspace").classList.contains("dates-collapsed"));
$("#toggleCard").onclick = () => setPanelCollapsed("card", !$(".workspace").classList.contains("card-collapsed"));
$("#closeRoutePreview").onclick = closeRoutePreview;
$("#routePreviewModal").onclick = event => { if (event.target === $("#routePreviewModal")) closeRoutePreview(); };
$("#startRoutePlayer").onclick = startRoutePlayer;
$("#stopRoutePlayer").onclick = stopRoutePlayer;
$("#nextRouteStep").onclick = nextRouteStep;
$("#closeRouteArrival").onclick = stopRoutePlayer;
$("#mobileShowCard").onclick = () => setMobileDrawer(!mobileDrawerOpen);
$("#mobilePlayRoute").onclick = openRoutePreview;
$("#mobileFitDay").onclick = () => {
  overview = !overview;
  updateMapView();
  if (!overview) requestMapFitAfterMobileLayout();
};
window.addEventListener("resize", () => {
  if (!map) return;
  clearTimeout(window.travelMapResizeTimer);
  window.travelMapResizeTimer = setTimeout(() => {
    map.resize();
    if (!overview) fitMap();
    if (isMobileLayout()) setMobileDrawer(mobileDrawerOpen);
  }, 120);
});
document.addEventListener("keydown", event => { if (event.key === "Escape") closeModal(); });
init();
