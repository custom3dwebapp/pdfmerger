const STATE = { files: [], activeId: null, queue: [], viewMode: 'grid' };
const $ = id => document.getElementById(id);

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
      let data = await res.json();
      if(data.error) throw data.error;
      STATE.files.push({...data, pages: data.thumbnails.map(() => ({rotation:0}))});
      renderFiles();
      loadFile(data.file_id);
    } catch(e) { showToast(e, 'error'); }
  }
}

// --- FILE LIST & SORTING ---
function renderFiles() {
  const container = $('file-list-container');
  container.innerHTML = STATE.files.map((f, i) => `
    <div class="file-card ${STATE.activeId===f.file_id?'active':''}" 
         onclick="loadFile('${f.file_id}')" 
         draggable="true" ondragstart="fileDragStart(event, ${i})" ondrop="fileDrop(event, ${i})" ondragover="allowDrop(event)">
      <div class="file-drag-handle">⋮⋮</div>
      <div class="file-icon">${f.original_name.split('.').pop().toUpperCase()}</div>
      <div class="file-info">
        <div class="file-name">${f.original_name}</div>
        <div class="file-meta">${f.page_count} pages</div>
      </div>
    </div>
  `).join('');
  updateStats();
}

let draggedFileIdx = null;
function fileDragStart(ev, idx) { draggedFileIdx = idx; ev.dataTransfer.effectAllowed = 'move'; }
function fileDrop(ev, targetIdx) {
  ev.preventDefault();
  if (draggedFileIdx === null || draggedFileIdx === targetIdx) return;
  const moved = STATE.files.splice(draggedFileIdx, 1)[0];
  STATE.files.splice(targetIdx, 0, moved);
  draggedFileIdx = null;
  renderFiles();
}

// --- WORKSPACE ---
function loadFile(id) {
  STATE.activeId = id;
  renderFiles();
  let f = STATE.files.find(x => x.file_id === id);
  $('ws-title').innerText = f.original_name;
  
  // Grid View
  $('pages-grid').innerHTML = f.thumbnails.map((src, i) => `
    <div class="page-card ${isInQueue(id,i)?'selected':''} ${f.pages[i].rotation?'rotated':''}" 
         onclick="togglePage('${id}',${i})" draggable="true" 
         ondragstart="pageDragStart(event, '${id}', ${i})" ondrop="pageDrop(event, '${id}', ${i})" ondragover="allowDrop(event)">
      <div class="thumb-wrap">
        <img class="thumb-img" src="${src}" style="transform:rotate(${f.pages[i].rotation}deg)">
        <div class="rotation-badge">${f.pages[i].rotation}°</div>
        <div class="page-controls">
          <div class="ctrl-btn" onclick="event.stopPropagation(); rotate('${id}',${i},-90)">↺</div>
          <div class="ctrl-btn" onclick="event.stopPropagation(); rotate('${id}',${i},90)">↻</div>
        </div>
      </div>
      <div class="page-num">Page ${i+1}</div>
    </div>
  `).join('');

  // Read View (High res if available, or scale up thumb)
  $('pages-read-view').innerHTML = f.thumbnails.map((src, i) => `
    <div class="read-page ${isInQueue(id,i)?'selected':''} ${f.pages[i].rotation?'rotated':''}" onclick="togglePage('${id}',${i})">
       <img src="${src}" style="transform:rotate(${f.pages[i].rotation}deg)">
       <div class="rotation-badge">${f.pages[i].rotation}°</div>
    </div>
  `).join('');
  
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
  loadFile(fid);
}

function togglePage(fid, pid) {
  let idx = STATE.queue.findIndex(x => x.file_id===fid && x.page_index===pid);
  if(idx > -1) STATE.queue.splice(idx, 1);
  else STATE.queue.push({file_id:fid, page_index:pid});
  loadFile(fid);
  updateStats();
}

function isInQueue(fid, pid) { return STATE.queue.some(x => x.file_id===fid && x.page_index===pid); }

function updateStats() {
  $('stat-files').innerText = STATE.files.length;
  $('stat-pages').innerText = STATE.files.reduce((a,b)=>a+b.page_count,0);
  $('stat-selected').innerText = STATE.queue.length;
  $('merge-btn').disabled = STATE.queue.length === 0;
}

// --- DRAG DROP PAGES ---
let draggedPageItem = null;
function pageDragStart(ev, fid, pid) { draggedPageItem = {fid, pid}; ev.dataTransfer.effectAllowed = 'move'; }
function allowDrop(ev) { ev.preventDefault(); }
function pageDrop(ev, targetFid, targetPid) {
  ev.preventDefault();
  if(!draggedPageItem) return;
  // Reorder queue logic
  let q1 = STATE.queue.findIndex(x => x.file_id===draggedPageItem.fid && x.page_index===draggedPageItem.pid);
  let q2 = STATE.queue.findIndex(x => x.file_id===targetFid && x.page_index===targetPid);
  if(q1 > -1 && q2 > -1) {
    let item = STATE.queue.splice(q1, 1)[0];
    STATE.queue.splice(q2, 0, item);
    loadFile(STATE.activeId);
  }
  draggedPageItem = null;
}

$('merge-btn').onclick = async () => {
  if (STATE.queue.length === 0) return showToast('No pages selected!', 'error');
  
  const btn = $('merge-btn');
  btn.disabled = true;
  btn.innerText = 'Processing...';

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

    console.log('Merging pages:', payload);

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
    a.download = 'foliocraft_merged.pdf'; 
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Download started!', 'success');
  } catch (e) {
    console.error(e);
    showToast('Merge failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerText = 'Merge & Download';
  }
};

$('btn-sel-all').onclick = () => {
  if (!STATE.activeId) return;
  let f = STATE.files.find(x => x.file_id===STATE.activeId);
  if(!f) return;
  f.pages.forEach((_,i) => {
    if(!isInQueue(f.file_id, i)) STATE.queue.push({file_id:f.file_id, page_index:i});
  });
  loadFile(STATE.activeId); updateStats();
};

$('btn-clear').onclick = () => { STATE.queue = []; loadFile(STATE.activeId); updateStats(); };

function showToast(msg) { 
  const t = $('toast'); t.innerText=msg; t.classList.add('show'); 
  setTimeout(()=>t.classList.remove('show'),3000); 
}