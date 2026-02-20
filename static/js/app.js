const STATE = { files: [], activeId: null, queue: [], viewMode: 'grid' };
const $ = id => document.getElementById(id);
const THEME_KEY = 'dopeoffice-theme';

function updateThemeToggleUI(theme) {
  const icon = $('theme-toggle-icon');
  const label = $('theme-toggle-label');
  const toggle = $('theme-toggle');
  const nextTheme = theme === 'light' ? 'dark' : 'light';
  if (icon) icon.textContent = theme === 'light' ? '◐' : '☼';
  if (label) label.textContent = theme === 'light' ? 'Dark' : 'Light';
  if (toggle) {
    toggle.setAttribute('aria-label', `Switch to ${nextTheme} theme`);
    toggle.setAttribute('title', `Switch to ${nextTheme} theme`);
  }
}

function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.body.setAttribute('data-theme', next);
  updateThemeToggleUI(next);
}

function initThemeToggle() {
  const toggle = $('theme-toggle');
  if (!toggle) return;

  let storedTheme = 'dark';
  try {
    storedTheme = localStorage.getItem(THEME_KEY) || 'dark';
  } catch (_) {}

  applyTheme(storedTheme);
  toggle.onclick = () => {
    const current = document.body.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next = current === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (_) {}
  };
}

initThemeToggle();

$('upload-zone').onclick = () => $('file-input').click();
$('file-input').onchange = e => uploadFiles(e.target.files);
$('upload-zone').ondragover = e => { e.preventDefault(); $('upload-zone').classList.add('dragover'); };
$('upload-zone').ondragleave = () => $('upload-zone').classList.remove('dragover');
$('upload-zone').ondrop = e => { e.preventDefault(); uploadFiles(e.dataTransfer.files); };

async function uploadFiles(files) {
  for(let f of files) {
    let fd = new FormData(); fd.append('file', f);
    try {
      let res = await fetch('/upload', {method:'POST', body:fd});
      let data;
      try { data = await res.json(); } catch(_) { data = {}; }
      if (!res.ok) {
        throw new Error(data.error || (res.status === 413 ? 'File is too large. Maximum size is 100 MB.' : 'Upload failed.'));
      }
      if(data.error) throw new Error(data.error);
      STATE.files.push({...data, pages: data.thumbnails.map(() => ({rotation:0}))});
      data.thumbnails.forEach((_, i) => {
        STATE.queue.push({ file_id: data.file_id, page_index: i });
      });
      renderFiles();
      loadFile(data.file_id);
    } catch(e) { showToast(e.message || String(e), 'error'); }
  }
}

// --- FILE LIST & SORTING ---
function renderFiles() {
  const container = $('file-list-container');
  const { selectedByFile } = buildQueueMeta();
  container.innerHTML = STATE.files.map((f, i) => `
    <div class="file-card ${STATE.activeId===f.file_id?'active':''}" data-idx="${i}"
         onclick="loadFile('${f.file_id}')" 
         ondragenter="fileDragEnter(event, ${i})" ondragleave="fileDragLeave(event)" ondragover="allowDrop(event)" ondrop="fileDrop(event, ${i})">
      <div class="file-order-btns">
        <button class="order-btn" onclick="event.stopPropagation(); moveFileUp(${i})" title="Move up" ${i===0?'disabled':''}>↑</button>
        <button class="order-btn" onclick="event.stopPropagation(); moveFileDown(${i})" title="Move down" ${i===STATE.files.length-1?'disabled':''}>↓</button>
      </div>
      <div class="file-drag-handle" draggable="true" ondragstart="fileDragStart(event, ${i})" ondragend="fileDragEnd(event)">⋮⋮</div>
      <div class="file-icon">${f.original_name.split('.').pop().toUpperCase()}</div>
      <div class="file-info">
        <div class="file-name">${f.original_name}</div>
        <div class="file-meta">${selectedCountForFile(f.file_id, selectedByFile)}/${f.page_count} selected</div>
      </div>
      <button class="file-delete-btn" onclick="event.stopPropagation(); deleteFile('${f.file_id}')" title="Remove file">×</button>
    </div>
  `).join('');
  updateStats();
}

function deleteFile(fileId) {
  STATE.files = STATE.files.filter(f => f.file_id !== fileId);
  STATE.queue = STATE.queue.filter(q => q.file_id !== fileId);
  if (STATE.activeId === fileId) {
    STATE.activeId = STATE.files.length ? STATE.files[0].file_id : null;
    if (STATE.activeId) loadFile(STATE.activeId);
    else {
      $('ws-title').innerText = 'Select a file';
      $('pages-grid').innerHTML = '';
      $('pages-read-view').innerHTML = '';
      updateViewMode();
    }
  }
  renderFiles();
  updateStats();
  updateEmptyState();
  showToast('File removed');
}

let draggedFileIdx = null;
function fileDragStart(ev, idx) {
  draggedFileIdx = idx;
  ev.dataTransfer.effectAllowed = 'move';
  ev.dataTransfer.setData('text/plain', String(idx));
  const card = ev.target.closest('.file-card');
  if (card) card.classList.add('dragging');
}
function fileDragEnd(ev) {
  document.querySelectorAll('.file-card.dragging, .file-card.drag-over').forEach(c => c.classList.remove('dragging', 'drag-over'));
  draggedFileIdx = null;
}
function fileDragEnter(ev, idx) {
  if (draggedFileIdx === null || draggedFileIdx === idx) return;
  ev.currentTarget.classList.add('drag-over');
}
function fileDragLeave(ev) {
  if (!ev.currentTarget.contains(ev.relatedTarget)) ev.currentTarget.classList.remove('drag-over');
}
function fileDrop(ev, targetIdx) {
  ev.preventDefault();
  ev.stopPropagation();
  ev.currentTarget.classList.remove('drag-over');
  if (draggedFileIdx === null || draggedFileIdx === targetIdx) return;
  const moved = STATE.files.splice(draggedFileIdx, 1)[0];
  STATE.files.splice(targetIdx, 0, moved);
  draggedFileIdx = null;
  renderFiles();
}

function moveFileUp(idx) {
  if (idx <= 0) return;
  [STATE.files[idx - 1], STATE.files[idx]] = [STATE.files[idx], STATE.files[idx - 1]];
  renderFiles();
}
function moveFileDown(idx) {
  if (idx >= STATE.files.length - 1) return;
  [STATE.files[idx], STATE.files[idx + 1]] = [STATE.files[idx + 1], STATE.files[idx]];
  renderFiles();
}

function fileDropOnContainer(ev) {
  ev.preventDefault();
  document.querySelectorAll('.file-card.drag-over').forEach(c => c.classList.remove('drag-over'));
  if (draggedFileIdx === null) return;
  const container = ev.currentTarget;
  const card = ev.target.closest('.file-card');
  let targetIdx = card ? Array.from(container.querySelectorAll('.file-card')).indexOf(card) : STATE.files.length;
  if (targetIdx >= 0 && targetIdx !== draggedFileIdx) {
    const moved = STATE.files.splice(draggedFileIdx, 1)[0];
    STATE.files.splice(Math.min(targetIdx, STATE.files.length), 0, moved);
    renderFiles();
  }
  draggedFileIdx = null;
}

// --- WORKSPACE ---
function loadFile(id) {
  STATE.activeId = id;
  renderFiles();
  let f = STATE.files.find(x => x.file_id === id);
  if (!f) {
    $('ws-title').innerText = 'Select a file';
    $('pages-grid').innerHTML = '';
    $('pages-read-view').innerHTML = '';
    updateViewMode();
    return;
  }
  $('ws-title').innerText = f.original_name;

  // Grid View
  $('pages-grid').innerHTML = f.thumbnails.map((src, i) => `
    <div class="page-card ${isInQueue(id,i)?'selected':''} ${f.pages[i].rotation?'rotated':''}" 
         data-file-id="${id}" data-page-index="${i}"
         style="animation-delay: ${i * 0.03}s"
         onclick="togglePage('${id}',${i})" draggable="true" 
         ondragstart="pageDragStart(event, '${id}', ${i})" ondragend="pageDragEndPage(event)"
         ondragenter="pageDragEnter(event)" ondragleave="pageDragLeavePage(event)" ondragover="allowDrop(event)" ondrop="pageDrop(event, '${id}', ${i})">
      <div class="thumb-wrap">
        <img class="thumb-img" src="${src}" style="transform:rotate(${f.pages[i].rotation}deg)">
        <div class="rotation-badge">${f.pages[i].rotation}°</div>
        <div class="page-controls">
          <div class="ctrl-btn" onclick="event.stopPropagation(); rotate('${id}',${i},-90)" title="Rotate left">↺</div>
        </div>
      </div>
      <div class="page-num">Page ${i+1}</div>
    </div>
  `).join('');

  // Read View (High res if available, or scale up thumb)
  $('pages-read-view').innerHTML = f.thumbnails.map((src, i) => `
    <div class="read-page ${isInQueue(id,i)?'selected':''} ${f.pages[i].rotation?'rotated':''}" data-file-id="${id}" data-page-index="${i}" onclick="togglePage('${id}',${i})">
       <img src="${src}" style="transform:rotate(${f.pages[i].rotation}deg)">
       <div class="rotation-badge">${f.pages[i].rotation}°</div>
    </div>
  `).join('');
  
  updatePageSelectionUI();
  updateViewMode();
}

// --- VIEW MODES ---
$('btn-view-grid').onclick = () => setView('grid');
$('btn-view-read').onclick = () => setView('read');

function setView(mode) {
  STATE.viewMode = mode;
  updateViewMode();
}

function updateViewMode() {
  if (STATE.viewMode === 'grid') {
    $('pages-grid').style.display = 'grid';
    $('pages-read-view').classList.remove('active');
    $('btn-view-grid').classList.add('active');
    $('btn-view-read').classList.remove('active');
  } else {
    $('pages-grid').style.display = 'none';
    $('pages-read-view').classList.add('active');
    $('btn-view-grid').classList.remove('active');
    $('btn-view-read').classList.add('active');
  }
}

// --- ACTIONS ---
function rotate(fid, pid, deg) {
  let p = STATE.files.find(x => x.file_id===fid).pages[pid];
  p.rotation = (p.rotation + deg + 360) % 360;

  document.querySelectorAll(`.page-card[data-file-id="${fid}"][data-page-index="${pid}"], .read-page[data-file-id="${fid}"][data-page-index="${pid}"]`).forEach(el => {
    const img = el.querySelector('img');
    if (img) img.style.transform = `rotate(${p.rotation}deg)`;
    const badge = el.querySelector('.rotation-badge');
    if (badge) badge.textContent = p.rotation + '\u00B0';
    el.classList.toggle('rotated', p.rotation !== 0);
  });
}

function togglePage(fid, pid) {
  let idx = STATE.queue.findIndex(x => x.file_id===fid && x.page_index===pid);
  if (idx > -1) {
    STATE.queue.splice(idx, 1);
  } else {
    const fileIdx = STATE.files.findIndex(f => f.file_id === fid);
    let insertAt = STATE.queue.length;
    for (let i = STATE.queue.length - 1; i >= 0; i--) {
      const qi = STATE.files.findIndex(f => f.file_id === STATE.queue[i].file_id);
      if (qi < fileIdx || (qi === fileIdx && STATE.queue[i].page_index < pid)) {
        insertAt = i + 1;
        break;
      }
      if (i === 0) insertAt = 0;
    }
    STATE.queue.splice(insertAt, 0, { file_id: fid, page_index: pid });
  }
  updatePageSelectionUI();
  updateStats();
}

function movePageUp(fid, pid) {
  const idx = STATE.queue.findIndex(x => x.file_id===fid && x.page_index===pid);
  if (idx <= 0) return;
  [STATE.queue[idx - 1], STATE.queue[idx]] = [STATE.queue[idx], STATE.queue[idx - 1]];
  updatePageSelectionUI();
  updateStats();
}
function movePageDown(fid, pid) {
  const idx = STATE.queue.findIndex(x => x.file_id===fid && x.page_index===pid);
  if (idx < 0 || idx >= STATE.queue.length - 1) return;
  [STATE.queue[idx], STATE.queue[idx + 1]] = [STATE.queue[idx + 1], STATE.queue[idx]];
  updatePageSelectionUI();
  updateStats();
}

function isInQueue(fid, pid) { return STATE.queue.some(x => x.file_id===fid && x.page_index===pid); }
function selectedCountForFile(fid, selectedByFile) {
  if (selectedByFile) return selectedByFile.get(fid) || 0;
  return STATE.queue.filter(x => x.file_id === fid).length;
}

function buildQueueMeta() {
  const queueIndexByKey = new Map();
  const selectedByFile = new Map();
  STATE.queue.forEach((item, idx) => {
    queueIndexByKey.set(`${item.file_id}:${item.page_index}`, idx + 1);
    selectedByFile.set(item.file_id, (selectedByFile.get(item.file_id) || 0) + 1);
  });
  return { queueIndexByKey, selectedByFile };
}

function updatePageSelectionUI() {
  const { queueIndexByKey, selectedByFile } = buildQueueMeta();
  document.querySelectorAll('.page-card, .read-page').forEach(el => {
    const fid = el.dataset.fileId;
    const pid = parseInt(el.dataset.pageIndex, 10);
    const qIdx = queueIndexByKey.get(`${fid}:${pid}`) || 0;
    const selected = qIdx > 0;
    el.classList.toggle('selected', selected);
    let badge = el.querySelector('.queue-badge');
    if (selected) {
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'queue-badge';
        el.appendChild(badge);
      }
      badge.textContent = qIdx;
    } else if (badge) {
      badge.remove();
    }
  });
  document.querySelectorAll('.file-card').forEach(card => {
    const idx = parseInt(card.dataset.idx, 10);
    const f = STATE.files[idx];
    if (!f) return;
    const meta = card.querySelector('.file-meta');
    if (meta) meta.textContent = `${selectedCountForFile(f.file_id, selectedByFile)}/${f.page_count} selected`;
  });
}

function updateStats() {
  $('stat-files').innerText = STATE.files.length;
  $('stat-pages').innerText = STATE.files.reduce((a,b)=>a+b.page_count,0);
  $('stat-selected').innerText = STATE.queue.length;
  $('merge-btn').disabled = STATE.queue.length === 0;
  updateEmptyState();
}

function updateEmptyState() {
  const empty = STATE.files.length === 0;
  document.body.classList.toggle('empty-state', empty);
}

// --- DRAG DROP PAGES ---
let draggedPageItem = null;
function pageDragStart(ev, fid, pid) {
  draggedPageItem = {fid, pid};
  ev.dataTransfer.effectAllowed = 'move';
  ev.dataTransfer.setData('text/plain', `${fid}:${pid}`);
  const card = ev.target.closest('.page-card');
  if (card) card.classList.add('dragging');
}
function pageDragEndPage(ev) {
  document.querySelectorAll('.page-card.dragging, .page-card.drag-over').forEach(c => c.classList.remove('dragging', 'drag-over'));
  draggedPageItem = null;
}
function pageDragEnter(ev) {
  if (!draggedPageItem) return;
  const card = ev.currentTarget;
  if (draggedPageItem.fid === card.dataset.fileId && String(draggedPageItem.pid) === card.dataset.pageIndex) return;
  card.classList.add('drag-over');
}
function pageDragLeave(ev) {
  if (!ev.currentTarget.contains(ev.relatedTarget)) ev.currentTarget.classList.remove('drag-over');
}
function pageDragLeavePage(ev) {
  const card = ev.currentTarget;
  if (!card.contains(ev.relatedTarget)) card.classList.remove('drag-over');
}
function allowDrop(ev) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; }
function pageDrop(ev, targetFid, targetPid) {
  const card = ev.target.closest('.page-card');
  if (card) card.classList.remove('drag-over');
  ev.preventDefault();
  if(!draggedPageItem) return;
  // Reorder queue logic
  let q1 = STATE.queue.findIndex(x => x.file_id===draggedPageItem.fid && x.page_index===draggedPageItem.pid);
  let q2 = STATE.queue.findIndex(x => x.file_id===targetFid && x.page_index===targetPid);
  if(q1 > -1 && q2 > -1) {
    let item = STATE.queue.splice(q1, 1)[0];
    STATE.queue.splice(q2, 0, item);
    updatePageSelectionUI();
  }
  draggedPageItem = null;
}

$('merge-btn').onclick = async () => {
  if (STATE.queue.length === 0) return showToast('No pages selected!', 'error');
  
  const btn = $('merge-btn');
  const btnText = $('merge-btn-text');
  btn.disabled = true;
  if (btnText) btnText.textContent = 'Processing...';

  try {
    const payload = {
      pages: STATE.queue.map(q => {
        const file = STATE.files.find(x => x.file_id === q.file_id);
        if (!file) return null;
        const page = file.pages[q.page_index];
        return {
          file_id: q.file_id,
          page_index: q.page_index,
          rotation: page ? page.rotation : 0
        };
      }).filter(p => p !== null)
    };

    let res = await fetch('/merge', { 
      method:'POST', 
      headers:{'Content-Type':'application/json'}, 
      body:JSON.stringify(payload)
    });
    
    if (!res.ok) throw new Error(await res.text());
    
    let blob = await res.blob();
    let url = URL.createObjectURL(blob);
    let a = document.createElement('a'); 
    a.href = url; 
    a.download = 'dopeoffice_merged.pdf'; 
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Download started!', 'success');
  } catch (e) {
    console.error(e);
    showToast('Merge failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    if (btnText) btnText.textContent = 'Merge & Download';
  }
};

$('btn-sel-all').onclick = () => {
  if (!STATE.activeId) return;
  let f = STATE.files.find(x => x.file_id===STATE.activeId);
  if(!f) return;
  f.pages.forEach((_,i) => {
    if(!isInQueue(f.file_id, i)) STATE.queue.push({file_id:f.file_id, page_index:i});
  });
  updatePageSelectionUI();
  updateStats();
};

$('btn-clear').onclick = () => {
  STATE.queue = [];
  updatePageSelectionUI();
  updateStats();
};

function showToast(msg, _type) { 
  const t = $('toast'); t.innerText=msg; t.classList.add('show'); 
  setTimeout(()=>t.classList.remove('show'),3000); 
}