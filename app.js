(() => {
  'use strict';

  // Configure FormSubmit for native multipart uploads or a CORS-enabled JSON endpoint.
  // JSON endpoints receive { name, contact, note, product, designs: { front, back } }.
  const SUBMISSION_ENDPOINT = window.CUSTOMIZER_CONFIG?.submissionEndpoint || '';
  const W = 900;
  const H = 1350;
  const SAFE = { x: 74, y: 74, w: 752, h: 1197 };
  const FINISHES = {
    classic: { label: 'Classic vàng xước', left: '#bd8c52', mid: '#f2d9a8', right: '#d2a36a', edge: '#704822' },
    black: { label: 'Đen matte', left: '#101418', mid: '#303a41', right: '#151c22', edge: '#050709' },
    silver: { label: 'Bạc xước', left: '#636c72', mid: '#d1d5d6', right: '#777f83', edge: '#343b40' }
  };
  const PALETTE = ['#111111', '#929292', '#ffffff', '#4598de', '#55bf61', '#f0d94a', '#f28c2e', '#e94132'];
  const FONT_OPTIONS = [
    ['Dancing Script', "'Dancing Script', cursive"], ['Great Vibes', "'Great Vibes', cursive"],
    ['Pacifico', "'Pacifico', cursive"], ['Lobster', "'Lobster', cursive"],
    ['Patrick Hand', "'Patrick Hand', cursive"], ['Playfair Display', "'Playfair Display', Georgia, serif"],
    ['Roboto', "'Roboto', Arial, sans-serif"], ['Montserrat', "'Montserrat', Arial, sans-serif"],
    ['Oswald', "'Oswald', Arial, sans-serif"], ['Anton', "'Anton', Impact, sans-serif"]
  ];
  const TEXT_ART = [
    ['normal', 'Chữ thường'], ['outline', 'Viền nét'], ['shadow', 'Đổ bóng'],
    ['spacing', 'Giãn rộng'], ['bold', 'Đậm nét'], ['italic', 'Nghiêng']
  ];
  const state = {
    face: 'front', tab: 'design', finish: 'classic', zoom: 1, addMenuOpen: false,
    textFont: 'Dancing Script', textEffect: 'normal', textColor: PALETTE[0],
    textSize: 110, textSpacing: 0, textAlign: 'center', textBold: false,
    textItalic: false, textUnderline: false,
    selectedId: null, dragging: null,
    faces: { front: [], back: [] },
    undo: [], redo: []
  };
  const canvas = document.querySelector('#productCanvas');
  const ctx = canvas.getContext('2d');
  const imageCache = new Map();
  const dbPromise = openDraftDb();
  let toastTimer;

  function openDraftDb() {
    return new Promise((resolve) => {
      if (!('indexedDB' in window)) return resolve(null);
      const request = indexedDB.open('khac-rieng-drafts', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('drafts')) request.result.createObjectStore('drafts');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }

  async function readDraft() {
    const db = await dbPromise;
    if (!db) return null;
    return new Promise((resolve) => {
      const request = db.transaction('drafts', 'readonly').objectStore('drafts').get('current');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }

  let persistTimer;
  function saveDraft() {
    clearTimeout(persistTimer);
    const note = document.querySelector('.autosave');
    if (note) note.innerHTML = '<i></i> Đang lưu thiết kế';
    persistTimer = setTimeout(async () => {
      const db = await dbPromise;
      if (!db) {
        if (note) note.innerHTML = '<i></i> Đang làm việc';
        return;
      }
      const draft = { faces: state.faces, finish: state.finish, version: 1, savedAt: Date.now() };
      const request = db.transaction('drafts', 'readwrite').objectStore('drafts').put(draft, 'current');
      request.onsuccess = () => { if (note) note.innerHTML = '<i></i> Đã lưu trên thiết bị'; };
      request.onerror = () => { if (note) note.innerHTML = '<i></i> Chưa lưu được'; };
    }, 350);
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function pushHistory() {
    state.undo.push(JSON.stringify({ faces: state.faces, finish: state.finish }));
    if (state.undo.length > 30) state.undo.shift();
    state.redo.length = 0;
    updateHistoryButtons();
  }
  function restoreSnapshot(serialized) {
    const snapshot = JSON.parse(serialized);
    state.faces = snapshot.faces;
    state.finish = snapshot.finish === 'navy' ? 'classic' : (snapshot.finish || 'classic');
    const current = state.faces[state.face];
    state.selectedId = current.length ? current[current.length - 1].id : null;
    renderAll();
  }
  function undo() {
    if (!state.undo.length) return;
    state.redo.push(JSON.stringify({ faces: state.faces, finish: state.finish }));
    restoreSnapshot(state.undo.pop());
    updateHistoryButtons(); saveDraft();
  }
  function redo() {
    if (!state.redo.length) return;
    state.undo.push(JSON.stringify({ faces: state.faces, finish: state.finish }));
    restoreSnapshot(state.redo.pop());
    updateHistoryButtons(); saveDraft();
  }
  function updateHistoryButtons() {
    const undoButton = document.querySelector('#undoButton');
    const redoButton = document.querySelector('#redoButton');
    undoButton.disabled = !state.undo.length;
    redoButton.disabled = !state.redo.length;
    undoButton.classList.toggle('is-muted', !state.undo.length);
    redoButton.classList.toggle('is-muted', !state.redo.length);
  }
  function activeItems() { return state.faces[state.face]; }
  function makeId() { return `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
  function addItem(item) {
    if (item.type === 'image' && activeItems().filter((layer) => layer.type === 'image').length >= 10) {
      showToast('Mỗi mặt sản phẩm có thể dùng tối đa 10 hình ảnh.'); return;
    }
    pushHistory();
    const complete = { id: makeId(), x: 50, y: 50, width: item.type === 'text' ? 78 : 32, height: item.type === 'text' ? 12 : 25, ...item };
    activeItems().push(complete);
    state.selectedId = complete.id;
    state.tab = item.type === 'text' ? 'text' : state.tab;
    renderAll(); saveDraft();
  }
  function selectedItem() { return activeItems().find((item) => item.id === state.selectedId) || null; }
  function changeSelected(change) {
    const item = selectedItem();
    if (!item) return;
    Object.assign(item, change);
    draw(); renderPanel(); saveDraft();
  }
  function deleteItem(id) {
    const index = activeItems().findIndex((item) => item.id === id);
    if (index < 0) return;
    pushHistory(); activeItems().splice(index, 1);
    state.selectedId = activeItems().length ? activeItems()[Math.max(0, index - 1)].id : null;
    renderAll(); saveDraft();
  }

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    if (context.roundRect) context.roundRect(x, y, width, height, r);
    else {
      context.moveTo(x + r, y); context.arcTo(x + width, y, x + width, y + height, r);
      context.arcTo(x + width, y + height, x, y + height, r); context.arcTo(x, y + height, x, y, r);
      context.arcTo(x, y, x + width, y, r);
    }
    context.closePath();
  }

  function productBase(context, face, withGuides) {
    const finish = FINISHES[state.finish] || FINISHES.classic;
    context.clearRect(0, 0, W, H);
    context.save();
    context.shadowColor = 'rgba(42, 28, 12, .25)'; context.shadowBlur = 42; context.shadowOffsetX = 0; context.shadowOffsetY = 22;
    roundedRect(context, 42, 30, 816, 1290, 59);
    const body = context.createLinearGradient(40, 0, 860, 0);
    body.addColorStop(0, finish.edge); body.addColorStop(.035, finish.left); body.addColorStop(.20, finish.mid);
    body.addColorStop(.53, finish.mid); body.addColorStop(.83, finish.right); body.addColorStop(.97, finish.left); body.addColorStop(1, finish.edge);
    context.fillStyle = body; context.fill(); context.restore();
    context.save(); roundedRect(context, 51, 38, 798, 1275, 53); context.clip();
    const sheen = context.createLinearGradient(48, 0, 854, 0);
    sheen.addColorStop(0, 'rgba(255,255,255,.22)'); sheen.addColorStop(.05, 'rgba(255,255,255,.08)');
    sheen.addColorStop(.23, 'rgba(255,255,255,.015)'); sheen.addColorStop(.78, 'rgba(255,255,255,0)'); sheen.addColorStop(.96, 'rgba(255,255,255,.18)'); sheen.addColorStop(1, 'rgba(80,48,20,.12)');
    context.fillStyle = sheen; context.fillRect(48, 35, 806, 1280);
    const topTint = context.createLinearGradient(0, 40, 0, 560);
    topTint.addColorStop(0, 'rgba(255,255,255,.17)'); topTint.addColorStop(.45, 'rgba(255,255,255,.035)'); topTint.addColorStop(1, 'rgba(80,48,20,.11)');
    context.fillStyle = topTint; context.fillRect(48, 35, 806, 520);
    if (state.finish === 'classic') {
      for (let i = 0; i < 308; i++) {
        const y = 45 + i * 4.1;
        const start = 55 + ((i * 53) % 155);
        const length = 360 + ((i * 79) % 405);
        context.beginPath(); context.moveTo(start, y); context.lineTo(Math.min(844, start + length), y + ((i % 5) - 2) * .16);
        context.strokeStyle = i % 4 === 0 ? 'rgba(255,255,255,.16)' : i % 3 === 0 ? 'rgba(115,74,35,.11)' : 'rgba(255,246,220,.12)';
        context.lineWidth = i % 7 === 0 ? 1.4 : .7; context.stroke();
      }
    }
    context.restore();
    context.save();
    context.strokeStyle = 'rgba(255,248,224,.72)'; context.lineWidth = 2;
    roundedRect(context, 51, 38, 798, 1275, 53); context.stroke();
    context.strokeStyle = 'rgba(54,36,19,.78)'; context.lineWidth = 4;
    roundedRect(context, 63, 50, 774, 1251, 47); context.stroke();
    context.strokeStyle = 'rgba(255,238,202,.38)'; context.lineWidth = 1.5;
    roundedRect(context, 69, 56, 762, 1239, 42); context.stroke();
    context.strokeStyle = 'rgba(32,23,13,.95)'; context.lineWidth = 8; context.beginPath(); context.moveTo(47, 529); context.lineTo(853, 529); context.stroke();
    context.strokeStyle = 'rgba(255,243,215,.72)'; context.lineWidth = 2; context.beginPath(); context.moveTo(50, 534); context.lineTo(850, 534); context.stroke();
    context.strokeStyle = 'rgba(116,78,39,.45)'; context.lineWidth = 1; context.beginPath(); context.moveTo(55, 543); context.lineTo(845, 543); context.stroke();
    const hingeX = face === 'front' ? 13 : 842;
    const hinge = context.createLinearGradient(hingeX, 0, hingeX + 45, 0);
    hinge.addColorStop(0, '#76542f'); hinge.addColorStop(.28, '#f1d59c'); hinge.addColorStop(.55, '#9e7543'); hinge.addColorStop(1, '#56391e');
    roundedRect(context, hingeX, 503, 45, 52, 16); context.fillStyle = hinge; context.fill();
    context.strokeStyle = 'rgba(56,39,22,.85)'; context.lineWidth = 2; roundedRect(context, hingeX + 8, 509, 26, 39, 11); context.stroke();
    context.fillStyle = '#785a34'; context.beginPath(); context.arc(hingeX + 21, 517, 4, 0, Math.PI * 2); context.fill();
    context.beginPath(); context.arc(hingeX + 21, 540, 4, 0, Math.PI * 2); context.fill();
    context.restore();
    if (withGuides) {
      context.save(); context.setLineDash([8, 8]); context.strokeStyle = 'rgba(255,255,255,.86)'; context.lineWidth = 2;
      roundedRect(context, SAFE.x, SAFE.y, SAFE.w, SAFE.h, 26); context.stroke(); context.restore();
    }
  }

  function getImage(src) {
    if (imageCache.has(src)) return imageCache.get(src);
    const image = new Image(); imageCache.set(src, image);
    image.onload = () => draw(); image.onerror = () => imageCache.delete(src); image.src = src;
    return image;
  }
  function fontStack(name) { return FONT_OPTIONS.find(([font]) => font === name)?.[1] || "'DM Sans', Arial, sans-serif"; }
  function textMetrics(context, item) {
    const size = item.size || state.textSize;
    const weight = item.bold || item.effect === 'bold' ? 700 : 500;
    const italic = item.italic || item.effect === 'italic';
    context.save(); context.font = `${weight} ${size}px ${fontStack(item.font || state.textFont)}`;
    const lines = String(item.text || '').split('\n');
    const spacing = Number(item.letterSpacing || 0) + (item.effect === 'spacing' ? 5 : 0);
    const width = Math.min(SAFE.w * .92, Math.max(...lines.map((line) => context.measureText(line || ' ').width + Math.max(0, [...line].length - 1) * spacing + (italic ? size * .22 : 0)), size));
    context.restore();
    return { width, height: Math.max(1, lines.length) * size * 1.34 };
  }  function itemBounds(context, item) {
    const centerX = SAFE.x + SAFE.w * item.x / 100;
    const centerY = SAFE.y + SAFE.h * item.y / 100;
    let width, height;
    if (item.type === 'text') ({ width, height } = textMetrics(context, item));
    else { width = SAFE.w * (item.width || 30) / 100; height = SAFE.h * (item.height || 20) / 100; }
    return { x: centerX - width / 2, y: centerY - height / 2, width, height, centerX, centerY };
  }
  function drawTextLine(context, item, line, centerX, y, maxWidth, mode) {
    const spacing = Number(item.letterSpacing || 0) + (item.effect === 'spacing' ? 5 : 0);
    if (spacing <= 0) {
      context.save(); context.textAlign = item.align || 'center';
      context[mode](line, centerX, y, maxWidth);
      context.restore();
      return;
    }
    const characters = [...line];
    const widths = characters.map((character) => context.measureText(character).width);
    const naturalWidth = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, characters.length - 1) * spacing;
    const scale = naturalWidth > maxWidth ? maxWidth / naturalWidth : 1;
    const renderedWidth = naturalWidth * scale;
    const align = item.align || 'center';
    let cursor = align === 'left' ? centerX : align === 'right' ? centerX - renderedWidth : centerX - renderedWidth / 2;
    context.save(); context.translate(cursor, y); context.scale(scale, 1); cursor = 0;
    characters.forEach((character, index) => { context[mode](character, cursor, 0); cursor += widths[index] + spacing; });
    context.restore();
  }
  function drawItems(context, face, selected) {
    for (const item of state.faces[face]) {
      const box = itemBounds(context, item);
      if (item.type === 'text') {
        const size = item.size || state.textSize;
        const weight = item.bold || item.effect === 'bold' ? 700 : 500;
        const italic = item.italic || item.effect === 'italic';
        const lines = String(item.text || '').split('\n');
        context.save(); context.fillStyle = item.color || PALETTE[0]; context.strokeStyle = item.color || PALETTE[0];
        context.textAlign = 'left'; context.textBaseline = 'middle'; context.font = `${weight} ${size}px ${fontStack(item.font || state.textFont)}`;
        if (item.effect === 'shadow') { context.shadowColor = 'rgba(0,0,0,.36)'; context.shadowBlur = size * .08; context.shadowOffsetY = size * .06; }
        const lineHeight = size * 1.25; const startY = box.centerY - ((lines.length - 1) * lineHeight) / 2;
        lines.forEach((line, index) => {
          const y = startY + index * lineHeight;
          context.save();
          if (italic) { context.translate(box.centerX, y); context.transform(1, 0, -.25, 1, 0, 0); context.translate(-box.centerX, -y); }
          if (item.effect === 'outline') { context.lineWidth = Math.max(2, size * .04); drawTextLine(context, item, line, box.centerX, y, SAFE.w * .91, 'strokeText'); }
          else drawTextLine(context, item, line, box.centerX, y, SAFE.w * .91, 'fillText');
          if (item.underline) {
            const width = textMetrics(context, { ...item, text:line }).width;
            const align = item.align || 'center';
            const startX = align === 'left' ? box.centerX : align === 'right' ? box.centerX - width : box.centerX - width / 2;
            context.beginPath(); context.lineWidth = Math.max(2, size * .025); context.moveTo(startX, y + size * .48); context.lineTo(startX + width, y + size * .48); context.stroke();
          }
          context.restore();
        });
        context.restore();
      } else {
        const image = getImage(item.src);
        if (image.complete && image.naturalWidth) {
          const maxW = box.width, maxH = box.height;
          const ratio = Math.min(maxW / image.naturalWidth, maxH / image.naturalHeight);
          const drawW = image.naturalWidth * ratio, drawH = image.naturalHeight * ratio;
          context.save(); context.globalAlpha = item.opacity == null ? 1 : item.opacity;
          context.drawImage(image, box.centerX - drawW / 2, box.centerY - drawH / 2, drawW, drawH); context.restore();
        }
      }
      if (selected && item.id === selected) {
        context.save(); context.setLineDash([5, 5]); context.strokeStyle = 'rgba(191,55,51,.92)'; context.lineWidth = 3;
        const pad = item.type === 'text' ? 12 : 5;
        context.strokeRect(box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2);
        context.setLineDash([]); context.fillStyle = '#fff'; context.strokeStyle = '#bf3733';
        [[box.x - pad, box.y - pad], [box.x + box.width + pad, box.y - pad], [box.x - pad, box.y + box.height + pad], [box.x + box.width + pad, box.y + box.height + pad]].forEach(([x,y]) => { context.beginPath(); context.arc(x,y,7,0,Math.PI*2); context.fill(); context.stroke(); });
        context.restore();
      }
    }
  }  function draw(face = state.face, withGuides = true, selected = state.selectedId) {
    productBase(ctx, face, withGuides);
    drawItems(ctx, face, withGuides ? selected : null);
  }
  function renderAll() {
    draw(); renderPanel(); updateHistoryButtons(); updateImageCount();
    document.querySelector('#productStage').style.transform = `scale(${state.zoom})`;
    document.querySelectorAll('.face-option').forEach((button) => button.classList.toggle('is-active', button.dataset.face === state.face));
    document.querySelectorAll('.rail-tab').forEach((button) => button.classList.toggle('is-active', button.dataset.tab === state.tab));
  }
  function updateImageCount() {
    const count = activeItems().filter((item) => item.type === 'image').length;
    document.querySelector('#imageCount').textContent = String(count);
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
  }
  function iconSvg(key, color = '#34271b') {
    const forms = {
      heart: '<path d="M50 84 15 51C-4 28 13 7 32 14c8 3 13 9 18 16 6-8 12-13 20-16 20-7 37 14 18 37Z"/>',
      star: '<path d="m50 6 12 29 31 2-24 20 8 31-27-17-27 17 8-31L7 37l31-2z"/>',
      mountain: '<path d="m8 78 25-38 12 17 17-32 30 53H8Z"/><path d="m41 56 9-12 9 15" fill="none"/>',
      flower: '<circle cx="50" cy="50" r="11"/><ellipse cx="50" cy="25" rx="11" ry="18"/><ellipse cx="50" cy="75" rx="11" ry="18"/><ellipse cx="25" cy="50" rx="18" ry="11"/><ellipse cx="75" cy="50" rx="18" ry="11"/>',
      wave: '<path d="M8 38c14-18 26-18 42 0s28 18 42 0M8 58c14-18 26-18 42 0s28 18 42 0" fill="none" stroke-width="7" stroke-linecap="round"/>',
      moon: '<path d="M75 14c-4 29-25 48-55 49 8 23 33 35 56 24 25-12 30-45 10-63-3-4-7-7-11-10Z"/>'
    };
    const fill = key === 'wave' || key === 'mountain' ? 'none' : color;
    const stroke = key === 'wave' || key === 'mountain' ? color : 'none';
    return `<svg viewBox="0 0 100 100" aria-hidden="true" fill="${fill}" stroke="${stroke}" stroke-linejoin="round" stroke-linecap="round">${forms[key] || forms.star}</svg>`;
  }
  const gallery = [
    { key:'heart', name:'Trái tim' }, { key:'star', name:'Ngôi sao' }, { key:'mountain', name:'Núi' },
    { key:'flower', name:'Hoa' }, { key:'wave', name:'Sóng' }, { key:'moon', name:'Trăng khuyết' }
  ];

  function renderPanel() {
    const body = document.querySelector('#editorBody');
    const title = document.querySelector('#panelTitle');
    const tabTitles = { design:'Thiết kế', upload:'Tải ảnh', gallery:'Hình ảnh', text:'Chữ', shapes:'Hình khối' };
    title.textContent = tabTitles[state.tab] || 'Thiết kế';
    if (state.tab === 'design') renderDesignPanel(body);
    if (state.tab === 'upload') renderUploadPanel(body);
    if (state.tab === 'gallery') renderGalleryPanel(body);
    if (state.tab === 'text') renderTextPanel(body);
    if (state.tab === 'shapes') renderShapesPanel(body);
    updateImageCount();
  }
  function addOptionsMarkup() {
    const options = [
      ['upload','↑','Tải ảnh'], ['gallery','▧','Hình ảnh'],
      ['text','Tt','Chữ'], ['shapes','◇','Hình khối']
    ];
    const tiles = options.map(([key, icon, label]) => `<button class="add-option" data-add-option="${key}" type="button"><span class="add-option-icon">${icon}</span><span>${label}</span></button>`).join('');
    return `<div class="add-control"><button class="add-menu-toggle" id="addMenuToggle" type="button" aria-label="Thêm thành phần thiết kế" aria-expanded="${state.addMenuOpen}" aria-controls="addOptions">+</button><div class="add-menu-rule"></div>${state.addMenuOpen ? `<div class="add-options-grid" id="addOptions">${tiles}</div>` : ''}</div>`;
  }
  function bindAddOptions(body) {
    body.querySelector('#addMenuToggle')?.addEventListener('click', () => { state.addMenuOpen = !state.addMenuOpen; renderPanel(); });
    body.querySelectorAll('[data-add-option]').forEach((button) => button.addEventListener('click', () => {
      state.tab = button.dataset.addOption; state.addMenuOpen = false; renderAll();
      if (state.tab === 'upload') document.querySelector('#imageInput')?.click();
      if (state.tab === 'text') document.querySelector('#textInput')?.focus();
    }));
  }
  function renderDesignPanel(body) {
    const items = activeItems();
    if (!items.length) {
      body.innerHTML = `<div class="panel-section-title"><h3>Các thành phần thiết kế</h3></div><p class="panel-description">Chưa có thành phần nào trên mặt ${state.face === 'front' ? 'trước' : 'sau'}. Bấm + để thêm chữ, hình ảnh hoặc hình khối.</p>${addOptionsMarkup()}<div class="tip-box"><strong>Mẹo:</strong> Kéo thành phần trên sản phẩm để điều chỉnh vị trí.</div>`;
      bindAddOptions(body);
      return;
    }
    const rows = items.map((item) => {
      const label = item.type === 'text' ? item.text.replace(/\n/g, ' ') : item.name;
      const thumb = item.type === 'text' ? escapeHtml((item.text || 'T').slice(0, 2)) : `<img src="${item.src}" alt="" />`;
      return `<div class="layer-row ${item.id === state.selectedId ? 'is-selected' : ''}" data-select="${item.id}" role="button" tabindex="0"><span class="layer-thumb">${thumb}</span><span class="layer-name">${escapeHtml(label || 'Hình ảnh')}<small class="layer-kind">${item.type === 'text' ? 'Văn bản' : 'Hình ảnh'}</small></span><button class="layer-delete" data-delete="${item.id}" type="button" aria-label="Xóa ${escapeHtml(label || 'thành phần')}">×</button></div>`;
    }).join('');
    const finishButtons = Object.entries(FINISHES).map(([key, finish]) => `<button class="finish-chip ${state.finish === key ? 'is-current' : ''}" data-finish="${key}" type="button" title="${finish.label}" aria-label="${finish.label}" style="background:linear-gradient(110deg,${finish.left},${finish.mid},${finish.right})"></button>`).join('');
    body.innerHTML = `<div class="panel-section-title"><h3>Các thành phần thiết kế</h3><span>${items.length} thành phần</span></div><div class="layer-list">${rows}</div>${addOptionsMarkup()}<div class="finish-picker"><span class="section-label">Màu sản phẩm</span><div class="color-line">${finishButtons}<span class="finish-name">${FINISHES[state.finish].label}</span></div></div>${selectedItem() ? renderSelectedEditor(selectedItem()) : ''}`;
    body.querySelectorAll('[data-select]').forEach((row) => {
      const choose = () => { state.selectedId = row.dataset.select; renderAll(); };
      row.addEventListener('click', (event) => { if (!event.target.closest('[data-delete]')) choose(); });
      row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } });
    });
    body.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); deleteItem(button.dataset.delete); }));
    body.querySelectorAll('[data-finish]').forEach((button) => button.addEventListener('click', () => { pushHistory(); state.finish = button.dataset.finish; renderAll(); saveDraft(); }));
    bindAddOptions(body); bindSelectedEditor(body);
  }  function renderSelectedEditor(item) {
    if (item.type === 'text') {
      const colors = PALETTE.map((color) => `<button class="color-chip ${item.color === color ? 'is-current' : ''}" data-color="${color}" style="background:${color}" type="button" title="${color}" aria-label="Chọn màu ${color}"></button>`).join('');
      return `<div class="selected-editor"><div class="panel-section-title"><h3>Chỉnh sửa chữ</h3></div><label class="field-label">Nội dung<input id="editText" value="${escapeHtml(item.text)}" maxlength="80" /></label><div class="field-label"><span>Cỡ chữ</span><div class="range-line"><input id="editSize" type="range" min="34" max="126" value="${item.size || 72}" /><output>${item.size || 72}</output></div></div><div class="field-label"><span>Màu chữ</span><div class="color-line">${colors}</div></div></div>`;
    }
    return `<div class="selected-editor"><div class="panel-section-title"><h3>Chỉnh sửa hình</h3></div><label class="field-label">Kích thước<div class="range-line"><input id="editWidth" type="range" min="12" max="75" value="${item.width || 32}" /><output>${item.width || 32}%</output></div></label><label class="field-label">Độ mờ<div class="range-line"><input id="editOpacity" type="range" min="25" max="100" value="${Math.round((item.opacity == null ? 1 : item.opacity) * 100)}" /><output>${Math.round((item.opacity == null ? 1 : item.opacity) * 100)}%</output></div></label></div>`;
  }
  function bindSelectedEditor(body) {
    const item = selectedItem(); if (!item) return;
    const text = body.querySelector('#editText');
    if (text) text.addEventListener('input', () => { item.text = text.value; draw(); saveDraft(); });
    const size = body.querySelector('#editSize');
    if (size) size.addEventListener('input', () => { item.size = Number(size.value); size.nextElementSibling.value = size.value; draw(); saveDraft(); });
    body.querySelectorAll('[data-color]').forEach((button) => button.addEventListener('click', () => { item.color = button.dataset.color; renderAll(); saveDraft(); }));
    const width = body.querySelector('#editWidth');
    if (width) width.addEventListener('input', () => { item.width = Number(width.value); width.nextElementSibling.value = `${width.value}%`; draw(); saveDraft(); });
    const opacity = body.querySelector('#editOpacity');
    if (opacity) opacity.addEventListener('input', () => { item.opacity = Number(opacity.value) / 100; opacity.nextElementSibling.value = `${opacity.value}%`; draw(); saveDraft(); });
  }
  function renderTextPanel(body) {
    const selected = selectedItem();
    let targetItem = selected?.type === 'text' ? selected : null;
    const current = {
      font:targetItem?.font || state.textFont, effect:targetItem?.effect || state.textEffect,
      color:targetItem?.color || state.textColor, size:targetItem?.size || state.textSize,
      letterSpacing:targetItem?.letterSpacing ?? state.textSpacing,
      align:targetItem?.align || state.textAlign, bold:targetItem ? Boolean(targetItem.bold) : state.textBold,
      italic:targetItem ? Boolean(targetItem.italic) : state.textItalic,
      underline:targetItem ? Boolean(targetItem.underline) : state.textUnderline
    };
    const artButtons = TEXT_ART.map(([key, label]) => `<button class="text-art-option ${current.effect === key ? 'is-active' : ''}" data-effect="${key}" type="button" aria-pressed="${current.effect === key}"><span class="art-sample ${key}">TEXT ART</span></button>`).join('');
    const fontButtons = FONT_OPTIONS.map(([font]) => `<button class="font-option ${current.font === font ? 'is-active' : ''}" data-font="${escapeHtml(font)}" type="button" style="font-family:${fontStack(font)}" aria-pressed="${current.font === font}">${escapeHtml(font)}</button>`).join('');
    const colorButtons = PALETTE.map((color) => `<button class="text-color-chip ${current.color.toLowerCase() === color.toLowerCase() ? 'is-current' : ''}" data-text-color="${color}" style="--chip:${color}" type="button" aria-label="Chọn màu ${color}" aria-pressed="${current.color.toLowerCase() === color.toLowerCase()}"></button>`).join('');
    body.innerHTML = `<div class="text-panel">
      <textarea id="textInput" class="text-entry text-area" maxlength="120" placeholder="Nhập chữ của bạn" aria-label="Nhập chữ để khắc">${escapeHtml(targetItem?.text || '')}</textarea>
      <div class="text-art-grid" role="group" aria-label="Kiểu chữ nghệ thuật">${artButtons}</div>
      <div class="text-heading-row"><span>Phông chữ</span><span id="currentFontName">${escapeHtml(current.font)}</span></div>
      <div class="font-list" id="fontList" role="listbox" aria-label="Chọn phông chữ">${fontButtons}</div>
      <div class="text-setting-row format-row"><span>Kiểu</span><div class="format-buttons">
        <button class="format-button ${current.bold ? 'is-active' : ''}" data-format="bold" type="button" aria-label="Đậm" aria-pressed="${current.bold}"><b>B</b></button>
        <button class="format-button ${current.italic ? 'is-active' : ''}" data-format="italic" type="button" aria-label="Nghiêng" aria-pressed="${current.italic}"><i>I</i></button>
        <button class="format-button ${current.underline ? 'is-active' : ''}" data-format="underline" type="button" aria-label="Gạch chân" aria-pressed="${current.underline}"><u>U</u></button>
      </div></div>
      <div class="text-setting-row color-row"><span>Màu</span><div class="text-color-controls"><div class="text-palette">${colorButtons}</div><label class="custom-color-wrap" title="Màu tùy chỉnh"><input id="customTextColor" type="color" value="${current.color}" aria-label="Chọn màu tùy chỉnh" /></label></div></div>
      <div class="text-setting-row range-setting"><label for="textSize">Cỡ chữ</label><input id="textSize" type="range" min="24" max="150" value="${current.size}" /><output id="textSizeValue">${current.size}</output></div>
      <div class="text-setting-row range-setting"><label for="textSpacing">Giãn chữ</label><input id="textSpacing" type="range" min="0" max="20" value="${current.letterSpacing}" /><output id="textSpacingValue">${current.letterSpacing}</output></div>
      <div class="text-setting-row align-row"><span>Căn lề</span><div class="align-buttons">
        <button class="align-button ${current.align === 'left' ? 'is-active' : ''}" data-align="left" type="button" aria-label="Căn trái" aria-pressed="${current.align === 'left'}">☰</button>
        <button class="align-button ${current.align === 'center' ? 'is-active' : ''}" data-align="center" type="button" aria-label="Căn giữa" aria-pressed="${current.align === 'center'}">☰</button>
        <button class="align-button ${current.align === 'right' ? 'is-active' : ''}" data-align="right" type="button" aria-label="Căn phải" aria-pressed="${current.align === 'right'}">☰</button>
      </div></div>
      <p class="text-live-note">Chữ hiển thị ngay trên sản phẩm. Kéo chữ trên khung xem trước để đổi vị trí.</p>
    </div>`;
    const input = body.querySelector('#textInput');
    function createTextLayerIfNeeded() {
      if (targetItem || !input.value.trim()) return;
      pushHistory();
      targetItem = { id:makeId(), type:'text', x:50, y:50, width:78, height:12, text:'', font:current.font, effect:current.effect, color:current.color, size:current.size, letterSpacing:current.letterSpacing, align:current.align, bold:current.bold, italic:current.italic, underline:current.underline };
      activeItems().push(targetItem); state.selectedId = targetItem.id;
    }
    function applySetting(key, value) {
      current[key] = value;
      const stateKey = { font:'textFont', effect:'textEffect', color:'textColor', size:'textSize', letterSpacing:'textSpacing', align:'textAlign', bold:'textBold', italic:'textItalic', underline:'textUnderline' }[key];
      if (stateKey) state[stateKey] = value;
      createTextLayerIfNeeded();
      if (targetItem) { targetItem[key] = value; targetItem.text = input.value; }
      draw(); saveDraft();
    }
    input.addEventListener('input', () => { createTextLayerIfNeeded(); if (targetItem) targetItem.text = input.value; draw(); saveDraft(); });
    body.querySelectorAll('[data-effect]').forEach((button) => button.addEventListener('click', () => {
      applySetting('effect', button.dataset.effect);
      body.querySelectorAll('[data-effect]').forEach((option) => { option.classList.toggle('is-active', option === button); option.setAttribute('aria-pressed', String(option === button)); });
    }));
    body.querySelectorAll('[data-font]').forEach((button) => button.addEventListener('click', () => {
      applySetting('font', button.dataset.font); body.querySelector('#currentFontName').textContent = button.dataset.font;
      body.querySelectorAll('[data-font]').forEach((option) => { option.classList.toggle('is-active', option === button); option.setAttribute('aria-pressed', String(option === button)); });
    }));
    body.querySelectorAll('[data-text-color]').forEach((button) => button.addEventListener('click', () => {
      applySetting('color', button.dataset.textColor);
      body.querySelectorAll('[data-text-color]').forEach((option) => { option.classList.toggle('is-current', option === button); option.setAttribute('aria-pressed', String(option === button)); });
      body.querySelector('#customTextColor').value = button.dataset.textColor;
    }));
    body.querySelector('#customTextColor').addEventListener('input', (event) => {
      applySetting('color', event.target.value);
      body.querySelectorAll('[data-text-color]').forEach((option) => { option.classList.toggle('is-current', option.dataset.textColor.toLowerCase() === event.target.value.toLowerCase()); option.setAttribute('aria-pressed', String(option.dataset.textColor.toLowerCase() === event.target.value.toLowerCase())); });
    });
    body.querySelector('#textSize').addEventListener('input', (event) => { applySetting('size', Number(event.target.value)); body.querySelector('#textSizeValue').value = event.target.value; });
    body.querySelector('#textSpacing').addEventListener('input', (event) => { applySetting('letterSpacing', Number(event.target.value)); body.querySelector('#textSpacingValue').value = event.target.value; });
    body.querySelectorAll('[data-format]').forEach((button) => button.addEventListener('click', () => {
      const key = button.dataset.format; applySetting(key, !current[key]);
      button.classList.toggle('is-active', current[key]); button.setAttribute('aria-pressed', String(current[key]));
    }));
    body.querySelectorAll('[data-align]').forEach((button) => button.addEventListener('click', () => {
      applySetting('align', button.dataset.align);
      body.querySelectorAll('[data-align]').forEach((option) => { option.classList.toggle('is-active', option === button); option.setAttribute('aria-pressed', String(option === button)); });
    }));
  }  function renderUploadPanel(body) {
    body.innerHTML = `<div class="upload-panel"><h3>Tải hình ảnh của bạn</h3><p class="panel-description">Thêm logo, hình kỷ niệm hoặc nét vẽ riêng để tạo thiết kế độc đáo.</p><input id="imageInput" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple hidden /><div class="dropzone" id="dropzone"><div class="upload-symbol" aria-hidden="true">↑</div><strong>Kéo thả hình ảnh vào đây</strong><span>PNG, JPG, WEBP hoặc SVG · tối đa 4 MB mỗi ảnh</span><button id="chooseImages" type="button">Chọn tệp từ thiết bị</button></div><div class="upload-tip">Dùng ảnh rõ nét, nền trong suốt sẽ cho kết quả khắc đẹp hơn. Tối đa 10 hình trên mỗi mặt sản phẩm.</div></div>`;
    const input = body.querySelector('#imageInput'); const zone = body.querySelector('#dropzone');
    body.querySelector('#chooseImages').addEventListener('click', () => input.click());
    input.addEventListener('change', () => { Array.from(input.files || []).forEach(addUploadedFile); input.value = ''; });
    zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (event) => { event.preventDefault(); zone.classList.remove('drag-over'); Array.from(event.dataTransfer.files || []).forEach(addUploadedFile); });
  }
  function addUploadedFile(file) {
    if (!file.type.startsWith('image/')) { showToast('Tệp này không phải hình ảnh.'); return; }
    if (file.size > 4 * 1024 * 1024) { showToast('Mỗi hình ảnh cần nhỏ hơn 4 MB.'); return; }
    if (activeItems().filter((item) => item.type === 'image').length >= 10) { showToast('Mỗi mặt sản phẩm có thể dùng tối đa 10 hình ảnh.'); return; }
    const reader = new FileReader();
    reader.onload = () => addItem({ type:'image', name:file.name.replace(/\.[^.]+$/, '') || 'Hình tải lên', src:String(reader.result), width:34, height:26 });
    reader.onerror = () => showToast('Không đọc được tệp hình ảnh này.');
    reader.readAsDataURL(file);
  }
  function renderGalleryPanel(body) {
    body.innerHTML = `<div class="gallery-panel"><h3>Chọn hình trang trí</h3><p class="panel-description">Thêm một biểu tượng đơn giản rồi tùy chỉnh kích thước và vị trí.</p><div class="gallery-grid">${gallery.map((item) => `<button class="gallery-card" data-symbol="${item.key}" type="button" aria-label="Thêm hình ${item.name}">${iconSvg(item.key)}</button>`).join('')}</div><div class="gallery-grid-labels">${gallery.map((item) => `<p class="gallery-name">${item.name}</p>`).join('')}</div><div class="tip-box">Hình trang trí được tạo dạng vector để giữ nét rõ khi phóng to.</div></div>`;
    body.querySelectorAll('[data-symbol]').forEach((button) => button.addEventListener('click', () => {
      const selected = gallery.find((item) => item.key === button.dataset.symbol);
      const svg = iconSvg(selected.key, '#34271b').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
      addItem({ type:'image', name:selected.name, src:`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, width:28, height:22 });
    }));
  }

  const geometricShapes = [
    { key:'circle', name:'Hình tròn', markup:'<circle cx="50" cy="50" r="35"/>' },
    { key:'square', name:'Hình vuông', markup:'<rect x="16" y="16" width="68" height="68" rx="5"/>' },
    { key:'diamond', name:'Hình thoi', markup:'<path d="M50 8 91 50 50 92 9 50Z"/>' },
    { key:'triangle', name:'Tam giác', markup:'<path d="M50 9 94 88H6Z"/>' }
  ];
  function renderShapesPanel(body) {
    body.innerHTML = `<div class="gallery-panel"><h3>Chọn hình khối</h3><p class="panel-description">Thêm hình cơ bản vào vùng khắc rồi kéo để đặt vị trí.</p><div class="shape-grid">${geometricShapes.map((shape) => `<button class="shape-card" data-shape="${shape.key}" type="button" aria-label="Thêm ${shape.name}"><svg viewBox="0 0 100 100" aria-hidden="true" fill="#34271b" stroke="#be9a65" stroke-width="2">${shape.markup}</svg></button>`).join('')}</div><div class="shape-labels">${geometricShapes.map((shape) => `<p class="shape-label">${shape.name}</p>`).join('')}</div></div>`;
    body.querySelectorAll('[data-shape]').forEach((button) => button.addEventListener('click', () => {
      const shape = geometricShapes.find((item) => item.key === button.dataset.shape);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="#34271b">${shape.markup}</svg>`;
      addItem({ type:'image', name:shape.name, src:`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, width:24, height:20 });
    }));
  }

  function pointerPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x:(event.clientX - rect.left) * W / rect.width, y:(event.clientY - rect.top) * H / rect.height };
  }
  function hitTest(point) {
    for (let index = activeItems().length - 1; index >= 0; index--) {
      const item = activeItems()[index]; const box = itemBounds(ctx, item); const padding = item.type === 'text' ? 16 : 8;
      if (point.x >= box.x - padding && point.x <= box.x + box.width + padding && point.y >= box.y - padding && point.y <= box.y + box.height + padding) return item;
    }
    return null;
  }
  canvas.addEventListener('pointerdown', (event) => {
    const point = pointerPoint(event); const item = hitTest(point);
    if (item) {
      state.selectedId = item.id;
      const box = itemBounds(ctx, item);
      state.dragging = { id:item.id, dx:box.centerX - point.x, dy:box.centerY - point.y };
      canvas.setPointerCapture(event.pointerId); canvas.style.cursor = 'grabbing'; renderPanel(); draw(); event.preventDefault();
    } else {
      state.selectedId = null; renderPanel(); draw();
    }
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!state.dragging) { canvas.style.cursor = hitTest(pointerPoint(event)) ? 'grab' : 'crosshair'; return; }
    const item = activeItems().find((layer) => layer.id === state.dragging.id); if (!item) return;
    const point = pointerPoint(event);
    item.x = Math.max(2, Math.min(98, ((point.x + state.dragging.dx - SAFE.x) / SAFE.w) * 100));
    item.y = Math.max(2, Math.min(98, ((point.y + state.dragging.dy - SAFE.y) / SAFE.h) * 100));
    draw();
  });
  const stopDrag = () => { if (state.dragging) { state.dragging = null; canvas.style.cursor = 'grab'; renderPanel(); saveDraft(); } };
  canvas.addEventListener('pointerup', stopDrag); canvas.addEventListener('pointercancel', stopDrag); canvas.addEventListener('lostpointercapture', stopDrag);

  function showToast(message) {
    const toast = document.querySelector('#toast'); toast.textContent = message; toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }
  function setFace(face) { state.face = face; state.selectedId = state.faces[face].length ? state.faces[face][state.faces[face].length - 1].id : null; renderAll(); }
  function setTab(tab) { state.tab = tab; state.addMenuOpen = false; renderAll(); }

  function ensureImages(face) {
    return Promise.all(state.faces[face].filter((item) => item.type === 'image').map((item) => new Promise((resolve) => {
      const image = getImage(item.src);
      if (image.complete && image.naturalWidth) return resolve();
      image.onload = () => resolve(); image.onerror = () => resolve();
    })));
  }
  async function exportFace(face) {
    await ensureImages(face);
    const exportCanvas = document.createElement('canvas'); exportCanvas.width = W; exportCanvas.height = H;
    const exportContext = exportCanvas.getContext('2d');
    productBase(exportContext, face, false); drawItems(exportContext, face, null);
    return new Promise((resolve) => exportCanvas.toBlob((blob) => resolve({ blob, dataUrl:exportCanvas.toDataURL('image/png') }), 'image/png'));
  }
  function downloadBlob(blob, name) {
    if (!blob) return;
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  function submitFormSubmitRequest(payload, frontBlob, backBlob) {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const targetName = `design-submit-${requestId.replace(/[^a-z0-9]/gi, '')}`;
      const frame = document.createElement('iframe');
      frame.name = targetName; frame.hidden = true; frame.title = 'Gửi yêu cầu thiết kế'; frame.tabIndex = -1;
      const emailForm = document.createElement('form');
      emailForm.action = SUBMISSION_ENDPOINT; emailForm.method = 'POST'; emailForm.enctype = 'multipart/form-data';
      emailForm.target = targetName; emailForm.hidden = true;

      const addField = (name, value) => {
        const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value;
        emailForm.append(input);
      };
      const addFile = (name, blob, filename) => {
        if (!blob || typeof DataTransfer === 'undefined') throw new Error('This browser cannot attach the exported PNG images.');
        const input = document.createElement('input'); input.type = 'file'; input.name = name; input.hidden = true;
        const transfer = new DataTransfer(); transfer.items.add(new File([blob], filename, { type: 'image/png' }));
        input.files = transfer.files; emailForm.append(input);
      };

      addField('name', payload.name);
      addField('contact', payload.contact);
      addField('product', payload.product);
      addField('note', payload.note || 'Không có lời nhắn');
      addField('_subject', `Yêu cầu thiết kế Classic - ${payload.name}`);
      addField('_template', 'table');
      addField('_url', window.location.href);
      const nextUrl = new URL('/submit-complete.html', window.location.origin);
      nextUrl.searchParams.set('request', requestId);
      addField('_next', nextUrl.href);
      addFile('front_design', frontBlob, 'thiet-ke-mat-truoc.png');
      addFile('back_design', backBlob, 'thiet-ke-mat-sau.png');

      let timeoutId;
      const finish = (error) => {
        window.removeEventListener('message', onMessage);
        clearTimeout(timeoutId);
        emailForm.remove(); frame.remove();
        error ? reject(error) : resolve();
      };
      const onMessage = (event) => {
        if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
        if (event.data?.type === 'classic-design-submitted' && event.data.request === requestId) finish();
      };
      window.addEventListener('message', onMessage);
      document.body.append(frame, emailForm);
      timeoutId = setTimeout(() => finish(new Error('FormSubmit did not confirm the submission redirect.')), 45000);
      emailForm.submit();
    });
  }
  async function openPreview() {
    const modal = document.querySelector('#previewModal'); const area = document.querySelector('#previewExports');
    area.innerHTML = '<p class="panel-description">Đang tạo ảnh xem trước…</p>'; modal.hidden = false;
    const [front, back] = await Promise.all([exportFace('front'), exportFace('back')]);
    area.innerHTML = `<div class="preview-face"><img alt="Thiết kế mặt trước" src="${front.dataUrl}" /><strong>Mặt trước</strong></div><div class="preview-face"><img alt="Thiết kế mặt sau" src="${back.dataUrl}" /><strong>Mặt sau</strong></div>`;
    document.querySelector('#downloadDesign').onclick = () => { downloadBlob(front.blob, 'thiet-ke-mat-truoc.png'); setTimeout(() => downloadBlob(back.blob, 'thiet-ke-mat-sau.png'), 250); showToast('Đang tải ảnh thiết kế PNG.'); };
  }
  function openSubmit() {
    document.querySelector('#submitModal').hidden = false;
    document.querySelector('#formFeedback').textContent = '';
    document.querySelector('#manualExport').hidden = Boolean(SUBMISSION_ENDPOINT);
  }
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => { document.getElementById(button.dataset.close).hidden = true; }));
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => { if (event.target === backdrop) backdrop.hidden = true; }));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') document.querySelectorAll('.modal-backdrop').forEach((modal) => { modal.hidden = true; }); });
  document.querySelector('#openPreview').addEventListener('click', openPreview);
  document.querySelector('#openSubmit').addEventListener('click', openSubmit);
  document.querySelector('#previewSubmit').addEventListener('click', () => { document.querySelector('#previewModal').hidden = true; openSubmit(); });
  document.querySelector('#manualExport').addEventListener('click', async () => {
    const [front, back] = await Promise.all([exportFace('front'), exportFace('back')]);
    downloadBlob(front.blob, 'thiet-ke-mat-truoc.png');
    setTimeout(() => downloadBlob(back.blob, 'thiet-ke-mat-sau.png'), 250);
    showToast('Đang tải ảnh PNG của hai mặt sản phẩm.');
  });
  document.querySelector('#undoButton').addEventListener('click', undo);
  document.querySelector('#redoButton').addEventListener('click', redo);
  document.querySelector('#zoomIn').addEventListener('click', () => { state.zoom = Math.min(1.18, state.zoom + .06); renderAll(); });
  document.querySelector('#zoomOut').addEventListener('click', () => { state.zoom = Math.max(.82, state.zoom - .06); renderAll(); });
  document.querySelector('#resetDesign').addEventListener('click', () => {
    if (!activeItems().length) { showToast('Mặt này chưa có thành phần nào.'); return; }
    pushHistory(); state.faces[state.face] = []; state.selectedId = null; renderAll(); saveDraft(); showToast('Đã xóa thiết kế trên mặt này.');
  });
  document.querySelector('#moreOptions').addEventListener('click', () => showToast('Chọn thành phần trên sản phẩm để chỉnh sửa.'));
  document.querySelectorAll('.face-option').forEach((button) => button.addEventListener('click', () => setFace(button.dataset.face)));
  document.querySelectorAll('.rail-tab').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));

  document.querySelector('#submitForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget; if (!form.reportValidity()) return;
    const button = document.querySelector('#submitFormButton'); const feedback = document.querySelector('#formFeedback');
    button.disabled = true; button.textContent = 'Đang gửi…'; feedback.classList.remove('is-success');
    try {
      const formData = new FormData(form);
      const [frontDesign, backDesign] = await Promise.all([exportFace('front'), exportFace('back')]);
      const payload = {
        name:String(formData.get('name') || '').trim(), contact:String(formData.get('contact') || '').trim(),
        note:String(formData.get('note') || '').trim(), product:'Classic',
        designs:{ front:frontDesign.dataUrl, back:backDesign.dataUrl }
      };
      if (!SUBMISSION_ENDPOINT) {
        feedback.textContent = 'Email/Drive nhận đơn chưa được kết nối. Thiết kế chưa được gửi; hãy dùng “Tải ảnh PNG” để lưu bản thiết kế.';
        feedback.classList.remove('is-success');
        return;
      }
      if (/^https:\/\/formsubmit\.co\//i.test(SUBMISSION_ENDPOINT)) {
        if (!frontDesign.blob || !backDesign.blob) throw new Error('Could not export design images');
        if (frontDesign.blob.size + backDesign.blob.size > 10 * 1024 * 1024) throw new Error('Design images exceed the 10 MB attachment limit');
        await submitFormSubmitRequest(payload, frontDesign.blob, backDesign.blob);
      } else {
        const response = await fetch(SUBMISSION_ENDPOINT, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(payload) });
        const responseData = await response.json().catch(() => null);
        if (!response.ok || responseData?.success === false || responseData?.success === 'false') throw new Error(`Submission failed (${response.status})`);
      }
      feedback.textContent = 'Đã gửi thiết kế thành công. Cửa hàng sẽ liên hệ lại với bạn.';
      feedback.classList.add('is-success'); document.querySelector('#manualExport').hidden = true;
      form.reset(); showToast('Đã gửi thiết kế thành công.');
    } catch (error) {
      feedback.textContent = error.message.includes('10 MB')
        ? 'Ảnh thiết kế vượt giới hạn đính kèm 10 MB. Vui lòng chỉnh sửa rồi thử gửi lại.'
        : 'Chưa nhận được xác nhận gửi. Nếu đây là lần đầu, chủ cửa hàng cần xác minh email FormSubmit. Bạn có thể tải PNG hai mặt để gửi thủ công.';
      document.querySelector('#manualExport').hidden = false;
      console.error('Design submission failed', error);
    } finally {
      button.disabled = false; button.textContent = 'Gửi yêu cầu thiết kế';
    }
  });

  (async () => {
    const saved = await readDraft();
    if (saved?.faces?.front && saved?.faces?.back) { state.faces = saved.faces; state.finish = saved.finish === 'navy' ? 'classic' : (saved.finish || 'classic'); }
    const allImages = [...state.faces.front, ...state.faces.back].filter((item) => item.type === 'image');
    allImages.forEach((item) => getImage(item.src));
    state.selectedId = activeItems().length ? activeItems()[activeItems().length - 1].id : null;
    renderAll();
  })();
})();
