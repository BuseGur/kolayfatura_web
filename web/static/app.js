// ==============================
// KolayFatura - app.js (v3)
// Detay görünüm + Pager + Düzenlenebilir Alanlar + Skor + Geçmiş
// ==============================

// ---- ÜST BAR / KULLANICI ----
const logoutBtn = document.getElementById('logout');

async function whoami() {
  try {
    const r = await fetch('/api/me', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    const me = await r.json();
    const w = document.getElementById('welcome');
    if (w) w.textContent = `Hoş geldin, ${me.username}`;
    if (me.role === 'admin') {
      const a = document.getElementById('adminLink');
      if (a) a.style.display = 'inline-block';
    }
  } catch {
    if (location.pathname !== '/login') location.replace('/login');
  }
}
whoami();

logoutBtn?.addEventListener('click', async () => {
  try { await fetch('/api/logout', { method: 'POST', cache: 'no-store' }); }
  finally { location.href = '/login'; }
});

// ---- DOM REFERANSLARI ----
const fileEl       = document.getElementById('file');
const previewEl    = document.getElementById('preview');
const form         = document.getElementById('uploadForm');
const progressEl   = document.getElementById('progress');
const resultBox    = document.getElementById('result');   // <textarea> (veya <pre> desteklenir)
const errorBox     = document.getElementById('error');
const metaEl       = document.getElementById('meta');

const copyBtn      = document.getElementById('copyBtn');
const csvBtn       = document.getElementById('csvBtn');
const xlsxBtn      = document.getElementById('xlsxBtn');
const runBatchBtn  = document.getElementById('runBatchBtn'); // HTML ile aynı
const xlsxBatchBtn = document.getElementById('xlsxBatchBtn');

// Pager
const pager     = document.getElementById('pager');
const prevBtn   = document.getElementById('prevBtn');
const nextBtn   = document.getElementById('nextBtn');
const pageLabel = document.getElementById('pageLabel');
const fileLabel = document.getElementById('fileLabel');

// ---- DÜZENLENEBİLİR ALANLAR ----
// Sağ panel input’ları (veya <td contenteditable> ise de çalışır)
const cells = {
  vendor:    document.getElementById('p_vendor'),
  date:      document.getElementById('p_date'),
  receipt:   document.getElementById('p_receipt'),
  subtotal:  document.getElementById('p_subtotal'),
  vat_total: document.getElementById('p_vat_total'),
  total:     document.getElementById('p_total'),
  vatrate:   document.getElementById('p_vatrate'),
  payment:   document.getElementById('p_payment'),
};

// input/td farkını yöneten yardımcılar
const isInput = el => !!el && ('value' in el);
function setField(el, v) {
  if (!el) return;
  if (isInput(el)) el.value = v ?? '';
  else el.textContent = v ?? '';
}
function getField(el) {
  if (!el) return '';
  return (isInput(el) ? el.value : el.textContent || '').trim();
}
function clearParsed() {
  Object.values(cells).forEach(el => setField(el, ''));
}
function fillParsed(p = {}) {
  setField(cells.vendor,    p.vendor);
  setField(cells.date,      p.date);
  setField(cells.receipt,   p.receipt_no);
  setField(cells.subtotal,  p.subtotal);
  setField(cells.vat_total, p.vat_total);
  setField(cells.total,     p.total);
  setField(cells.vatrate,   p.vat_rate);
  setField(cells.payment,   p.payment_type);
}
function getParsedFromUI() {
  return {
    vendor:       getField(cells.vendor),
    date:         getField(cells.date),
    receipt_no:   getField(cells.receipt),
    subtotal:     getField(cells.subtotal),
    vat_total:    getField(cells.vat_total),
    total:        getField(cells.total),
    vat_rate:     getField(cells.vatrate),
    payment_type: getField(cells.payment),
  };
}

// contenteditable kullanıyorsan otomatik aç (input ise gerek yok)
Object.values(cells).forEach(el => {
  if (el && !isInput(el)) el.setAttribute('contenteditable', 'true');
});

// ---- ÖNİZLEME ----
if (fileEl && previewEl) {
  fileEl.addEventListener('change', () => {
    const f = fileEl.files?.[0];
    if (!f) { previewEl.style.display = 'none'; previewEl.removeAttribute('src'); return; }
    const url = URL.createObjectURL(f);
    previewEl.src = url;
    previewEl.onload = () => URL.revokeObjectURL(url);
    previewEl.style.display = 'block';
  });
}

// ---- YARDIMCILAR ----
function showError(msg) {
  if (!errorBox) return;
  errorBox.textContent = msg;
  errorBox.classList.add('show');
}
function clearError() {
  if (!errorBox) return;
  errorBox.classList.remove('show');
  errorBox.textContent = '';
}
function setResultText(txt) {
  if (!resultBox) return;
  if ('value' in resultBox) resultBox.value = txt ?? '';
  else resultBox.textContent = txt ?? '';
}
function getResultText() {
  if (!resultBox) return '';
  return ('value' in resultBox) ? (resultBox.value || '') : (resultBox.textContent || '');
}

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error(data?.detail || data?.error || `HTTP ${r.status}`);
  return data;
}

// Dosya boyutu kontrolü
const MAX_BYTES = 7 * 1024 * 1024;
function checkSize(file) {
  if (file.size > MAX_BYTES) throw new Error('Dosya çok büyük (7MB sınırı).');
}

// ---- PAGER STATE ----
let batchItems = []; // { filename, status, kategori, ocr_preview, parsed:{} }
let currentIndex = -1;

// Güven barları (opsiyonel)
function setConfBars(conf) {
  const map = {
    vendor:'c_vendor', date:'c_date', receipt_no:'c_receipt_no',
    subtotal:'c_subtotal', vat_total:'c_vat_total', total:'c_total',
    vat_rate:'c_vat_rate', payment_type:'c_payment_type'
  };
  Object.entries(map).forEach(([k,id])=>{
    const v = conf?.[k] ?? 0;
    const bar = document.getElementById(id);
    if (bar) bar.style.width = Math.round((v||0)*100) + '%';
  });
}

// Detay render
function renderDetail(item) {
  if (!item || item.status !== 'ok') {
    setResultText('');
    if (metaEl) metaEl.textContent = '';
    clearParsed();
    if (item?.detail) showError(item.detail);
    else showError('Bu öğe işlenemedi.');
    return;
  }
  clearError();
  setResultText(item.ocr_preview || '(metin bulunamadı)');
  if (metaEl) metaEl.textContent = `Kategori: ${item.kategori ?? '-'} · Dosya: ${item.filename ?? '-'}`;
  fillParsed(item.parsed || {});
  setConfBars(item?.parsed?.conf || {});
}

function updatePager() {
  if (!pager) return;
  const total = batchItems.length;
  pager.style.display = total > 1 ? 'flex' : 'none';
  if (!total) return;
  if (pageLabel) pageLabel.textContent = `${currentIndex + 1} / ${total}`;
  if (fileLabel) fileLabel.textContent = batchItems[currentIndex]?.filename || '';
  if (prevBtn) prevBtn.disabled = currentIndex <= 0;
  if (nextBtn) nextBtn.disabled = currentIndex >= total - 1;
}
function goTo(i) {
  if (i < 0 || i >= batchItems.length) return;
  currentIndex = i;
  renderDetail(batchItems[currentIndex]);
  updatePager();
}
prevBtn?.addEventListener('click', () => goTo(currentIndex - 1));
nextBtn?.addEventListener('click', () => goTo(currentIndex + 1));
document.addEventListener('keydown', (e) => {
  if (batchItems.length === 0) return;
  if (e.key === 'ArrowLeft')  goTo(currentIndex - 1);
  if (e.key === 'ArrowRight') goTo(currentIndex + 1);
});

// ---- PROGRESS ----
function setProgress(show) {
  if (typeof window._kf_progress === 'function') {
    window._kf_progress(show);
  } else {
    progressEl?.classList.toggle('show', !!show);
  }
}

// ---- TEK FİŞ: OCR ----
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  clearParsed();
  setResultText('');
  if (metaEl) metaEl.textContent = '';
  setProgress(true);

  const t0 = performance.now();
  try {
    const first = fileEl?.files?.[0];
    if (!first) throw new Error('Lütfen bir dosya seçin.');
    checkSize(first);

    const fd = new FormData();
    fd.append('file', first);
    const kategoriSel = document.querySelector('select[name="kategori"]');
    const langSel     = document.getElementById('lang');
    if (kategoriSel) fd.append('kategori', kategoriSel.value);
    if (langSel)     fd.append('lang',      langSel.value);

    const data = await fetchJson('/api/ocr', { method: 'POST', body: fd });

    batchItems = [{
      filename: first.name || 'tek_fis',
      status: 'ok',
      kategori: data.kategori,
      ocr_preview: data.ocr_preview,
      parsed: data.parsed
    }];
    goTo(0);

    // Skor
    const p = data.parsed || {};
    const fieldsTotal = 8;
    const fieldsOk = [p.vendor, p.date, p.receipt_no, p.subtotal, p.vat_total, p.total, p.vat_rate, p.payment_type]
      .filter(Boolean).length;

    window._kf_score?.({
      overall: Math.round((fieldsOk/fieldsTotal)*100),
      confidence: p.confidence ?? p.conf?.overall ?? 0,
      fields_ok: fieldsOk,
      fields_total: fieldsTotal,
      vat_conf: p.conf?.vat_rate ?? 0,
      time_ms: performance.now() - t0,
      errors: 0,
      tag: "Tek Fiş"
    });

    // Geçmişe kaydet
    saveSession(`Tek Fiş · ${batchItems[0]?.filename || 'dosya'}`, batchItems);

  } catch (err) {
    showError(err?.message || 'Bilinmeyen hata');
  } finally {
    setProgress(false);
  }
});

// ---- ÇOKLU FİŞ: OCR-BATCH ----
runBatchBtn?.addEventListener('click', async () => {
  const files = fileEl?.files;
  if (!files || files.length === 0) { alert('Lütfen bir veya daha çok görsel seçin.'); return; }

  clearError();
  setProgress(true);
  const t0 = performance.now();

  try {
    const fd = new FormData();
    for (const f of files) { checkSize(f); fd.append('files', f); }
    const kategoriSel = document.querySelector('select[name="kategori"]');
    const langSel     = document.getElementById('lang');
    if (kategoriSel) fd.append('kategori', kategoriSel.value);
    if (langSel)     fd.append('lang',      langSel.value);

    const data = await fetchJson('/api/ocr-batch', { method: 'POST', body: fd });
    if (!data.ok) throw new Error(data?.detail || 'Toplu işleme hatası');

    batchItems = data.items || [];
    if (batchItems.length === 0) throw new Error('Sonuç yok.');
    goTo(0);

    // Skor (özet)
    const fieldsTotal = 8;
    let okSum = 0, errCount = 0;
    batchItems.forEach(it => {
      if (it.status !== 'ok') { errCount++; return; }
      const p = it.parsed || {};
      const ok = [p.vendor, p.date, p.receipt_no, p.subtotal, p.vat_total, p.total, p.vat_rate, p.payment_type]
        .filter(Boolean).length;
      okSum += ok;
    });
    const avgOk = batchItems.length ? okSum/(batchItems.length*fieldsTotal) : 0;

    window._kf_score?.({
      overall: Math.round(avgOk*100),
      confidence: 0,
      fields_ok: Math.round(avgOk*fieldsTotal),
      fields_total: fieldsTotal,
      vat_conf: 0,
      time_ms: performance.now() - t0,
      errors: errCount,
      tag: "Toplu"
    });

    // Geçmişe kaydet
    saveSession(`Toplu (${batchItems.length})`, batchItems);

  } catch (err) {
    showError(err?.message || 'Bilinmeyen hata');
  } finally {
    setProgress(false);
  }
});

// ---- KULLANICI DÜZENLEMELERİ ----
// Alanlar değiştikçe aktif öğeye yaz
Object.values(cells).forEach(el => {
  const ev = isInput(el) ? 'input' : 'keyup';
  el?.addEventListener(ev, () => {
    if (currentIndex < 0 || !batchItems[currentIndex]) return;
    batchItems[currentIndex].parsed = { ...batchItems[currentIndex].parsed, ...getParsedFromUI() };
  });
});

// ---- Drag & Drop (drop alanı) ----
const dropZone = document.getElementById('drop');
if (dropZone && fileEl) {
  ['dragenter','dragover'].forEach(ev => dropZone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag');
  }));
  ['dragleave','drop'].forEach(ev => dropZone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag');
  }));
  dropZone.addEventListener('drop', e => {
    const files = e.dataTransfer?.files;
    if (files && files.length) {
      fileEl.files = files;
      fileEl.dispatchEvent(new Event('change'));
    }
  });
}

// ---- KOPYALA / CSV / EXCEL (tek) ----
copyBtn?.addEventListener('click', async () => {
  const txt = getResultText();
  if (!txt.trim()) return;
  await navigator.clipboard.writeText(txt);
  alert('Metin panoya kopyalandı.');
});

csvBtn?.addEventListener('click', () => {
  const p = getParsedFromUI();
  const headers = Object.keys(p);
  const values  = headers.map(k => (p[k] || '').replaceAll('"','""'));
  const csvParsed = `"${headers.join('","')}"\n"${values.join('","')}"\n\n`;

  const txt = getResultText();
  const lines = txt.split(/\r?\n/).map(s => s.replaceAll('"','""'));
  const csvText = '"OCR_TEXT"\n"' + lines.join('"\n"') + '"';

  const blob = new Blob([csvParsed + csvText], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ocr_output.csv';
  a.click();
  URL.revokeObjectURL(a.href);
});

xlsxBtn?.addEventListener('click', () => {
  try{
    if (!window.XLSX) { alert('XLSX kütüphanesi yüklenemedi.'); return; }
    const p = getParsedFromUI();
    const rows = [
      ["Alan","Değer"],
      ["Satıcı",        p.vendor],
      ["Tarih",         p.date],
      ["Fiş/Fatura No", p.receipt_no],
      ["Ara Toplam",    p.subtotal],
      ["KDV Toplam",    p.vat_total],
      ["Genel Toplam",  p.total],
      ["KDV Oranı",     p.vat_rate],
      ["Ödeme Tipi",    p.payment_type],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fiş Özeti");
    XLSX.writeFile(wb, "kolayfatura_fis.xlsx");
  }catch(e){
    alert("Excel oluşturulamadı: " + (e?.message || e));
  }
});

// ---- EXCEL (toplu) ----
xlsxBatchBtn?.addEventListener('click', () => {
  if (!window.XLSX) { alert('Excel kütüphanesi (XLSX) yüklenemedi.'); return; }
  if (batchItems.length === 0) { alert('Önce çoklu fiş çalıştırın.'); return; }

  const rows = batchItems.map(it => {
    if (it.status !== 'ok') {
      return { "Dosya": it.filename, "Hata": it.detail || 'Hata' };
    }
    const p = it.parsed || {};
    return {
      "Dosya":      it.filename || '',
      "Satıcı":     p.vendor || '',
      "Tarih":      p.date || '',
      "Fiş No":     p.receipt_no || '',
      "Ara Toplam": p.subtotal || '',
      "KDV":        p.vat_total || '',
      "Toplam":     p.total || '',
      "KDV %":      p.vat_rate || '',
      "Ödeme":      p.payment_type || ''
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "FİŞLER");
  XLSX.writeFile(wb, "kolayfatura_batch.xlsx");
});

// ==============================
// Geçmiş Sistemi (localStorage)
// ==============================
const HISTORY_KEY = 'kf_history_v1';

function histRead(){ try{ return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }catch{ return []; } }
function histWrite(list){ try{ localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); }catch{} }

function normalizeItems(items){
  const MAX_OCR = 10000;
  return (items || []).map(it=>{
    if(it.status !== 'ok'){
      return { filename: it.filename || '', status:'err', detail: it.detail || 'Hata' };
    }
    const p = it.parsed || {};
    return {
      filename: it.filename || '',
      status: 'ok',
      kategori: it.kategori || '',
      ocr_preview: (it.ocr_preview || '').slice(0, MAX_OCR),
      parsed: {
        vendor: p.vendor || '', date: p.date || '', receipt_no: p.receipt_no || '',
        subtotal: p.subtotal || '', vat_total: p.vat_total || '', total: p.total || '',
        vat_rate: p.vat_rate || '', payment_type: p.payment_type || '',
        conf: p.conf ? { ...p.conf } : undefined
      }
    };
  });
}

function saveSession(name, items){
  const list = histRead();
  const session = {
    id: Date.now(),
    ts: new Date().toISOString(),
    name: name || 'Oturum',
    count: (items || []).length,
    items: normalizeItems(items)
  };
  list.unshift(session);
  if (list.length > 50) list.length = 50;
  histWrite(list);
}

// Drawer UI
const menuBtn     = document.getElementById('menuBtn');
const histPanel   = document.getElementById('histPanel');
const histOverlay = document.getElementById('histOverlay');
const histClose   = document.getElementById('histClose');
const histClear   = document.getElementById('histClear');
const histExport  = document.getElementById('histExport');
const histList    = document.getElementById('histList');

function renderHistory(){
  if (!histList) return;
  const list = histRead();
  histList.innerHTML = '';
  if (list.length === 0) {
    const div = document.createElement('div');
    div.className = 'hist-item';
    div.innerHTML = `<div class="hist-meta">Henüz geçmiş yok. Bir OCR çalıştırdığında burada görünecek.</div>`;
    histList.appendChild(div);
    return;
  }
  list.forEach(s=>{
    const wrap = document.createElement('div');
    wrap.className = 'hist-item';
    const when = new Date(s.ts);
    const dateStr = when.toLocaleString(undefined, { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    wrap.innerHTML = `
      <div>
        <div class="hist-title">${s.name}</div>
        <div class="hist-meta">${dateStr} · ${s.count} öğe</div>
      </div>
      <div class="hist-actions">
        <button class="btn btn-ghost" data-open="${s.id}">Aç</button>
        <button class="btn" data-json="${s.id}">JSON</button>
        <button class="btn btn-danger" data-del="${s.id}">Sil</button>
      </div>`;
    histList.appendChild(wrap);
  });

  // actions
  histList.querySelectorAll('[data-open]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = Number(btn.getAttribute('data-open'));
      const s = histRead().find(x=>x.id===id);
      if (!s) return;
      batchItems = s.items || [];
      if (batchItems.length) goTo(0);
      closeHistory();
    });
  });
  histList.querySelectorAll('[data-del]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = Number(btn.getAttribute('data-del'));
      const list = histRead().filter(x=>x.id!==id);
      histWrite(list);
      renderHistory();
    });
  });
  histList.querySelectorAll('[data-json]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = Number(btn.getAttribute('data-json'));
      const s = histRead().find(x=>x.id===id);
      if(!s) return;
      const blob = new Blob([JSON.stringify(s,null,2)], {type:'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `kolayfatura_session_${s.id}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  });
}

function openHistory(){
  if (!histPanel || !histOverlay) return;
  renderHistory();
  histPanel.hidden = false; histOverlay.hidden = false;
  requestAnimationFrame(()=> histPanel.classList.add('show'));
}
function closeHistory(){
  if (!histPanel || !histOverlay) return;
  histPanel.classList.remove('show');
  setTimeout(()=>{ histPanel.hidden = true; histOverlay.hidden = true; }, 200);
}

menuBtn?.addEventListener('click', openHistory);
histClose?.addEventListener('click', closeHistory);
histOverlay?.addEventListener('click', closeHistory);

histClear?.addEventListener('click', ()=>{
  if (!confirm('Tüm geçmiş silinsin mi?')) return;
  histWrite([]); renderHistory();
});
histExport?.addEventListener('click', ()=>{
  const list = histRead();
  const blob = new Blob([JSON.stringify(list,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kolayfatura_history_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// Başlangıçta son oturumu yükle (mevcut batch yoksa)
(function autoLoadLast(){
  if (batchItems.length > 0) return;
  const list = histRead();
  if (!list.length) return;
  batchItems = list[0].items || [];
  if (batchItems.length) goTo(0);
})();
